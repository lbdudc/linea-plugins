import { Container } from 'typedi';
import { parseFeatureModel, normalizeProductSpec } from '../../linea/featureModel.js';
import { registerAgent } from '../core/AgentRegistry.js';
import { loadFeatureModel, loadFeatureModelFromBranch, invalidateFmCache, normalizeFeatureSelection } from '../tools/splContext.js';
import FamilyImpactPlanner from '../changeset/FamilyImpactPlanner.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import AgentPolicyRepository from '../models/AgentPolicyRepository.js';
import { normMode } from '../models/AgentPolicy.js';
import LineService from '../../model/services/LineService.js';
import PlaygroundService from '../playground/PlaygroundService.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import ProductSpecService from '../../model/services/ProductSpecService.js';
import ProductService from '../../model/services/ProductService.js';
import TestResultRepository from '../models/TestResultRepository.js';
import TestResult from '../models/TestResult.js';

const TERMINAL = ['done', 'failed', 'cancelled'];

const mergeFeaturesInto = (existing, newFeatures) => {
  if (existing == null || Array.isArray(existing)) {
    const set = new Set(existing ?? []);
    const added = [];
    for (const feat of newFeatures) {
      if (!set.has(feat)) { set.add(feat); added.push(feat); }
    }
    return { features: [...set], added };
  }
  if (typeof existing === 'object') {
    const merged = { ...existing };
    const added = [];
    for (const feat of newFeatures) {
      if (!merged[feat]) { merged[feat] = true; added.push(feat); }
    }
    return { features: merged, added };
  }
  return { features: existing, added: [] };
};

const PROPAGATE_CHUNK_SIZE = 5;
const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ── Autonomy helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the effective autonomy mode for a specific product override,
 * falling back to the plan default and then to 'semi'.
 */
const resolveProductMode = (productId, planAutonomy) => {
  const perProduct = planAutonomy?.perProduct ?? {};
  const def = normMode(planAutonomy?.default ?? 'semi');
  const override = perProduct[productId];
  return override ? normMode(override) : def;
};

// ── Plan narrative helpers ────────────────────────────────────────────────────

const EDIT_CLASS_META = {
  refactoring:    { label: 'Refactoring',    color: 'green',      icon: '♻️',  detail: 'Config set unchanged — no product will break.' },
  generalization: { label: 'Generalization', color: 'blue',       icon: '📐', detail: 'Only adds valid configurations — no existing product breaks.' },
  specialization: { label: 'Specialization', color: 'orange',     icon: '🔧', detail: 'Removes some valid configs — some products will break.' },
  arbitrary:      { label: 'Arbitrary',      color: 'deep-orange', icon: '⚠️',  detail: 'Both adds and removes valid configs.' },
};

const ACTION_LABEL = {
  migrate: 'Spec migration needed',
  regen:   'Regenerate',
  skip:    'No action needed',
};

const AUTONOMY_LABEL = {
  manual:    'Manual',
  semi:      'Semi-automatic',
  automatic: 'Automatic',
};

const buildPlanSummary = (plan) => {
  const { stats } = plan;
  const parts = [];
  if (stats.migrate)        parts.push(`${stats.migrate} migration${stats.migrate > 1 ? 's' : ''}`);
  if (stats.regen)          parts.push(`${stats.regen} regen${stats.regen > 1 ? 's' : ''}`);
  if (stats.likelyConflict) parts.push(`${stats.likelyConflict} likely conflict${stats.likelyConflict > 1 ? 's' : ''}`);
  if (stats.skip)           parts.push(`${stats.skip} unaffected`);
  return parts.length ? parts.join(', ') : 'No product action needed';
};

const buildPlanMarkdown = (plan, autonomyDefault = 'semi') => {
  const { editClass, stats, cascade } = plan;
  const meta = EDIT_CLASS_META[editClass] ?? { label: editClass, detail: '' };
  const modeLabel = AUTONOMY_LABEL[autonomyDefault] ?? autonomyDefault;

  const headerSection =
    `## Phase 2 · Consolidation Plan\n\n` +
    `**Edit class:** ${meta.icon} ${meta.label} — ${meta.detail}\n\n` +
    `**Autonomy mode:** ${modeLabel} (applies to cascade and test review)\n\n` +
    `**Portfolio:** ${stats.total} product${stats.total !== 1 ? 's' : ''} · ` +
    `${stats.migrate} spec migration${stats.migrate !== 1 ? 's' : ''} · ` +
    `${stats.regen} regen${stats.regen !== 1 ? 's' : ''} · ` +
    (stats.likelyConflict ? `⚠️ ${stats.likelyConflict} likely conflict${stats.likelyConflict !== 1 ? 's' : ''} · ` : '') +
    `${stats.skip} unaffected`;

  const approvalNote =
    `\n\n> **Approving this plan will:**\n` +
    `> 1. Merge the plan branch into the line repository\n` +
    `> 2. Start the cascade (migrations → regens) in the planned order\n` +
    `> Critical products always pause for review regardless of autonomy settings.`;

  if (cascade.length === 0) return headerSection + approvalNote;

  const tableHeader = `\n\n| Product | Action | Drift | Critical |\n|---|---|---|---|\n`;
  const tableRows = cascade
    .filter((c) => c.action !== 'skip')
    .map((c) => {
      const action   = `${ACTION_LABEL[c.action]}${c.likely_conflict ? ' ⚠️' : ''}`;
      const drift    = c.likely_conflict ? '⚠️ manual edits' : '—';
      const critical = c.isCritical ? '🔴 Critical' : '—';
      return `| **${c.name}** (v${c.version}) | ${action} | ${drift} | ${critical} |`;
    })
    .join('\n');

  const skipped = cascade.filter((c) => c.action === 'skip');
  const skipNote = skipped.length
    ? `\n\n_${skipped.length} product${skipped.length !== 1 ? 's' : ''} unaffected (skip): ${skipped.map((c) => c.name).join(', ')}_`
    : '';

  return headerSection + tableHeader + tableRows + skipNote + approvalNote;
};

const buildVerificationSummary = (children) => {
  let clean = 0, conflicted = 0, migrated = 0, failed = 0;
  const failedProducts     = [];
  const failedProductIds   = [];
  const pendingConflicts   = [];
  const pendingProductIds  = [];

  for (const child of children) {
    if (!child) continue;
    const productId = child.scope?.productId ? String(child.scope.productId) : null;
    const name = child.input?.productName ?? productId ?? '?';
    if (child.status === 'failed' || child.status === 'cancelled') {
      failed += 1;
      failedProducts.push(name);
      if (productId) failedProductIds.push(productId);
    } else if (child.status === 'done') {
      if (child.agentType === 'evolution') migrated += 1;
      else if (child.result?.conflicts) conflicted += 1;
      else clean += 1;
    } else if (child.status === 'awaiting_approval') {
      pendingConflicts.push(name);
      if (productId) pendingProductIds.push(productId);
    }
  }

  const total   = children.length;
  const done    = clean + conflicted + migrated + failed;
  const pending = total - done;

  return {
    total, clean, migrated, conflicted, failed, pending,
    failedProducts, failedProductIds, pendingConflicts, pendingProductIds,
    allPassed: failed === 0 && pending === 0,
    summary:
      `${clean} clean · ${migrated} migrated · ${conflicted} conflict-resolved · ` +
      `${pendingConflicts.length} awaiting review · ${failed} failed`,
  };
};

// ── Agent definition ──────────────────────────────────────────────────────────

const definition = {
  type:  'changeset',
  title: 'Consolidation Agent',
  description:
    'Plans, approves, and executes a family-wide consolidation cascade from a single FM/platform ' +
    'change — providing foresight (family impact plan with Thüm edit class + conflict prediction) ' +
    'before merging and a verification summary after the cascade completes. Supports three autonomy ' +
    'modes (manual / semi / automatic) per plan and per product. Triggered from the FM editor ' +
    '(branch-based Save), from a user-selected branch, or automatically after a Harvest is accepted.',
  scope: 'line',

  steps: [
    /**
     * Phase 1 — Family Impact Plan.
     *
     * Loads the proposed FM from the working branch (preferred) or from
     * `input.proposedContent` (legacy fm-edit one-shot). Runs FamilyImpactPlanner:
     * Thüm edit classification, product partition (migrate|regen|skip), lightweight
     * conflict prediction via branch-SHA drift, criticality policy.
     *
     * No LLM; fully deterministic. Branch reads go through LINEA.
     */
    {
      name: 'plan',
      kind: 'git',
      run: async (ctx) => {
        if (!ctx.lineId) throw new Error('changeset agent requires scope.lineId');

        const origin      = ctx.input?.origin ?? 'manual';
        const planBranch  = ctx.input?.branch ?? null;

        // Load the current committed FM from the repository (cached, 5 min TTL).
        const { line, model: currentModel } = await loadFeatureModel({ lineId: ctx.lineId, userId: ctx.userId });

        let proposedModel, proposedModelStr;

        if (planBranch) {
          // Branch-based plan (fm-edit with working branch, or harvest-accepted).
          // Load the proposed FM from the working branch.
          const branchData = await loadFeatureModelFromBranch({
            lineId: ctx.lineId, userId: ctx.userId, branch: planBranch,
          });
          proposedModel    = branchData.model;
          proposedModelStr = branchData.modelStr;
        } else if (origin === 'harvest-accepted') {
          // Legacy: harvest-accepted without a branch — treat current FM as proposed.
          // (Old flow where harvest committed directly to main.)
          proposedModel    = currentModel;
          proposedModelStr = null;
        } else {
          // Legacy fm-edit one-shot: proposed content in input.
          const proposedContent = ctx.input?.proposedContent;
          if (!proposedContent) {
            proposedModel    = currentModel;
            proposedModelStr = null;
          } else {
            proposedModelStr = proposedContent;
            let parsed = null;
            try { parsed = parseFeatureModel({ content: proposedModelStr, type: 'UVL' }); } catch { /* fallthrough */ }
            if (!parsed) {
              try { parsed = parseFeatureModel({ content: proposedModelStr, type: 'XML' }); } catch (err) {
                throw new Error(`Proposed model is not valid UVL or XML: ${err?.message ?? err}`);
              }
            }
            proposedModel = parsed;
          }
        }

        const plan = await Container.get(FamilyImpactPlanner).plan({
          lineId: ctx.lineId, userId: ctx.userId, line,
          currentModel, proposedModel, proposedModelStr, origin,
        });

        // Also load the current saved autonomy default for seeding the approval card.
        let savedAutonomyDefault = 'semi';
        try {
          const policy = await Container.get(AgentPolicyRepository).resolveEffective({
            lineId: ctx.lineId, productId: null,
          });
          savedAutonomyDefault = normMode(policy?.modes?.changeset ?? 'semi');
        } catch { /* best-effort */ }

        return { output: { ...plan, savedAutonomyDefault, planBranch } };
      },
    },

    /**
     * Phase 2 — Plan approval.
     *
     * Presents the plan for human review. The proposal body carries the full plan
     * plus the current autonomy default (seeded from policy) so the client can
     * render the mode selector pre-filled.
     *
     * The user picks the autonomy mode (+ per-product overrides) on this card and
     * sends it back as decisionMeta.autonomy = { default, perProduct: {} }.
     * The runner stamps run.autonomyMode from autonomy.default after the decision.
     *
     * blastRadius is 'line' (merges the plan branch into main — irreversible).
     * Gate: requires human except when run.autonomyMode === 'automatic'.
     */
    {
      name: 'approve-plan',
      kind: 'approval',
      run: async (ctx) => {
        const plan = ctx.getStepOutput('plan');
        if (!plan) throw new Error('plan step output is missing');

        const summary          = buildPlanSummary(plan);
        const autonomyDefault  = plan.savedAutonomyDefault ?? 'semi';
        const markdown         = buildPlanMarkdown(plan, autonomyDefault);

        return {
          output: { proposed: true, editClass: plan.editClass, summary },
          proposal: {
            kind:        'plan_approval',
            blastRadius: 'line',    // always a gate in manual/semi (irreversible)
            unambiguous: false,     // FM commit is irreversible even for a refactoring
            target:      { lineId: ctx.lineId },
            body: {
              title:             `Consolidation: ${plan.editClass} — ${summary}`,
              phase:             'Phase 2 · Plan approval',
              editClass:         plan.editClass,
              plan,
              markdown,
              // Seed the client's autonomy selector from the saved policy.
              autonomyDefault,
              autonomyPerProduct: {},  // starts empty; client fills per-product overrides
            },
          },
        };
      },
    },

    /**
     * Phase 3 — Sandbox iteration (preprod).
     *
     * Optional gate that lets the user iterate on the plan/ branch BEFORE merging
     * into main: edit the FM and/or annotated code, commit each iteration as a
     * new commit on the same plan/ branch, and re-run product tests against the
     * branch state through the playground.
     *
     * Only active when:
     *   - the run has a working branch (branch-based plans), and
     *   - the run's autonomy mode is not 'automatic'.
     * In 'automatic' mode the step skips itself so the cascade proceeds without
     * a human gate. In manual/semi the user must explicitly approve to proceed.
     */
    {
      name: 'sandbox',
      kind: 'approval',
      run: async (ctx) => {
        const planBranch = ctx.input?.branch ?? (ctx.getStepOutput('plan')?.planBranch ?? null);
        const mode = ctx.run.autonomyMode ?? 'semi';

        if (!planBranch || mode === 'automatic') {
          return {
            output: {
              skipped: true,
              reason: !planBranch ? 'no plan branch (legacy fm-edit)' : 'automatic mode',
            },
          };
        }

        return {
          output: { proposed: true, planBranch },
          proposal: {
            kind:        'sandbox_iteration',
            blastRadius: 'line',
            unambiguous: false,
            target:      { lineId: ctx.lineId },
            body: {
              phase:      'Phase 3 · Sandbox iteration',
              planBranch,
              title:      `Iterate on ${planBranch} before merging`,
              markdown:
                `## Phase 3 · Sandbox iteration\n\n` +
                `Iterate on the plan branch \`${planBranch}\`. ` +
                `Edit the FM or annotated code, commit each iteration, and re-run ` +
                `product tests through the playground.\n\n` +
                `Approve when you are happy with the proposed changes — the next step ` +
                `merges the branch into main.`,
            },
          },
        };
      },
    },

    /**
     * Phase 4 — Merge plan branch into main.
     *
     * For branch-based plans (fm-edit with working branch, harvest-accepted):
     *   merges the plan working branch → main via a merge request.
     * For legacy fm-edit (no branch, proposedContent in input):
     *   falls back to saveFeatureModel (direct commit to main).
     * For legacy harvest-accepted (no branch):
     *   skips (FM was already on main in the legacy flow).
     */
    {
      name: 'merge-branch',
      kind: 'git',
      // Give it 3 min so a slow MR (CI pipeline, big diff, backend latency)
      // still lands rather than dying at the default 30 s git-step timeout.
      timeoutMs: 180_000,
      run: async (ctx) => {
        const origin     = ctx.input?.origin ?? 'manual';
        const planBranch = ctx.input?.branch ?? (ctx.getStepOutput('plan')?.planBranch ?? null);

        const approvedProposal = ctx.getProposals().find(
          (p) => p.kind === 'plan_approval' && (p.decision === 'approved' || p.decision === 'auto')
        );
        if (!approvedProposal) {
          return { output: { merged: false, reason: 'plan_approval not approved' } };
        }

        if (planBranch) {
          // Merge the working branch into main — this is the irreversible commit gate.
          const result = await Container.get(LineService).mergePlanBranch({
            id:     ctx.lineId,
            userId: ctx.userId,
            branch: planBranch,
            title:  `Consolidation plan: merge ${planBranch} into main`,
          });
          if (!result.merged) {
            // Stop here. propagate-features + cascade would regenerate every
            // product against a main that does NOT yet carry the FM change,
            // which reads as "nothing happened". Fail with an actionable
            // message — the operator merges the MR on the git host, then re-runs
            // this step (rerunStep keeps the plan_approval decision).
            const mr = result.mrIid ? `MR !${result.mrIid}` : 'its merge request';
            throw new Error(
              result.conflicts
                ? `Plan branch "${planBranch}" → main has merge conflicts (${mr}). `
                  + `Resolve and merge it on the git host, then re-run the "merge-branch" step.`
                : `Plan branch "${planBranch}" → main could not be auto-merged (${mr}) — `
                  + `it likely needs approval, a green pipeline, or main is protected. `
                  + `Merge it on the git host, then re-run the "merge-branch" step.`,
            );
          }
          invalidateFmCache(ctx.lineId);
          return { output: { merged: true, branch: planBranch, ...result } };
        }

        if (origin === 'harvest-accepted') {
          // Legacy: harvest without branch, FM assumed already on main.
          return { output: { merged: false, reason: 'harvest-accepted: FM already on main (legacy flow)' } };
        }

        // Legacy fm-edit one-shot: commit proposed content directly to main.
        const proposedContent = ctx.input?.proposedContent;
        if (proposedContent) {
          await Container.get(LineService).saveFeatureModel({
            id: ctx.lineId, userId: ctx.userId, content: proposedContent,
          });
          invalidateFmCache(ctx.lineId);
          return { output: { merged: true, committed: true, branch: null } };
        }

        return { output: { merged: false, reason: 'no branch or proposed content to commit' } };
      },
    },

    /**
     * Phase 4b — Propagate new features to product specs.
     *
     * A regen only includes feature-gated code for features the product has
     * SELECTED in its spec. When the plan adds new optional features to the FM
     * but the products don't opt in, the cascade regenerates an unchanged
     * artifact (only pom bumps, no functional diff).
     *
     * This step auto-adds every `newFeatures` entry from the plan to the
     * `spec.features` of every product that the user marked as Include in the
     * matrix. Preserves whatever shape the spec used (array or {name:bool} map).
     *
     * Skipped for plans that add no features (refactoring on existing code,
     * removals, etc.).
     */
    {
      name: 'propagate-features',
      kind: 'deterministic',
      timeoutMs: 180_000,
      run: async (ctx) => {
        const plan = ctx.getStepOutput('plan');
        if (!plan) throw new Error('plan step output is missing for propagate-features');

        const newFeatures = plan.newFeatures ?? [];
        console.log(`[propagate-features] run=${ctx.run._id} plan.newFeatures=${JSON.stringify(newFeatures)}`);
        if (newFeatures.length === 0) {
          return { output: { skipped: true, reason: 'no new features in plan' } };
        }

        const approvedProposal = ctx.getProposals().find(
          (p) => p.kind === 'plan_approval' && (p.decision === 'approved' || p.decision === 'auto')
        );
        const overrides = approvedProposal?.body?.decisionMeta?.overrides ?? {};
        console.log(`[propagate-features] overrides=${JSON.stringify(overrides)}`);

        // Only propagate to products that will be regenerated. Skip products the
        // user explicitly marked skip/defer, and any product the plan itself
        // classified as skip (unaffected refactorings) — those won't regen.
        const targets = (plan.cascade ?? []).filter((c) => {
          if (c.action === 'skip') return false;
          const ov = overrides[c.productId];
          return ov !== 'skip' && ov !== 'defer';
        });

        console.log(`[propagate-features] cascade candidates=${(plan.cascade ?? []).length} targets after overrides=${targets.length}`);

        if (targets.length === 0) {
          return { output: { skipped: true, reason: 'no cascade targets' } };
        }

        const productRepo = Container.get(ProductRepository);

        const propagateToOne = async (entry) => {
          try {
            const product = await productRepo.findById(entry.productId);
            if (!product) {
              return { productId: entry.productId, name: entry.name, added: [], error: 'product not found' };
            }

            const { spec: resolvedSpec, source, reason } = await Container.get(ProductSpecService).getSpecFromHostOrCache({
              productProjectId: product.repo.id, fallbackSpec: product.spec, userId: ctx.userId,
              context: `changesetAgent.propagate-features: product ${entry.productId}`,
            });
            if (reason === 'infra') {
              return {
                productId: entry.productId, name: entry.name, added: [],
                error: 'spec del host git no disponible (fallo de infraestructura) — propagación pospuesta para este producto',
              };
            }
            const currentSpec = source === 'repo' ? normalizeProductSpec({ spec: resolvedSpec }) : resolvedSpec;

            // LINEA saves the selection (it makes the model of it, checks it against the feature model, and the spec follows).
            const { features: mergedFeatures, added } = mergeFeaturesInto(currentSpec.features, newFeatures);
            if (added.length > 0) {
              await Container.get(ProductService).saveSelection({ id: entry.productId, userId: ctx.userId, features: mergedFeatures });
            }

            return { productId: entry.productId, name: entry.name, added };
          } catch (err) {
            return {
              productId: entry.productId,
              name: entry.name,
              added: [],
              error: err?.message ?? String(err),
            };
          }
        };

        const results = [];
        for (const chunk of chunkArray(targets, PROPAGATE_CHUNK_SIZE)) {
          results.push(...(await Promise.all(chunk.map(propagateToOne))));
        }

        const touched = results.filter((r) => r.added.length > 0).length;
        const summary = `Propagated ${newFeatures.join(', ')} to ${touched}/${targets.length} product(s)`;
        return {
          output: {
            newFeatures,
            targetsCount: targets.length,
            touched,
            perProduct: results,
            summary,
          },
        };
      },
    },

    /**
     * Phase 4 — Supervised cascade.
     *
     * Fans out per-product agents in plan order, stamping each child with the
     * resolved autonomy mode (per-product override → plan default → 'semi').
     * Waits for all children to reach a terminal state via the awaitChild re-entry
     * pattern (mirrors lineSyncAgent.js).
     */
    {
      name: 'cascade',
      kind: 'deterministic',
      run: async (ctx) => {
        const plan = ctx.getStepOutput('plan');
        if (!plan) throw new Error('plan step output is missing for cascade');

        const repo = Container.get(AgentRunRepository);

        // ── Re-entry: children already exist ─────────────────────────────────
        const children = await repo.findByParentRunId(ctx.run._id);
        if (children.length > 0) {
          const pending = children.filter((c) => c && !TERMINAL.includes(c.status));
          if (pending.length > 0) {
            return {
              output: { total: children.length, pending: pending.length, done: false },
              awaitChild: true,
            };
          }
          const summary = buildVerificationSummary(children);
          return { output: { ...summary, done: true }, result: { cascade: summary } };
        }

        // ── First entry: read autonomy + overrides from approved proposal ─────
        const approvedProposal = ctx.getProposals().find(
          (p) => p.kind === 'plan_approval' && (p.decision === 'approved' || p.decision === 'auto')
        );
        const overrides    = approvedProposal?.body?.decisionMeta?.overrides    ?? {};
        const planAutonomy = approvedProposal?.body?.decisionMeta?.autonomy     ?? {};

        console.log(`[changeset:cascade] run=${ctx.run._id} plan.cascade=${JSON.stringify(plan.cascade.map(c => ({ id: c.productId, action: c.action })))}`);
        console.log(`[changeset:cascade] decisionMeta.overrides=${JSON.stringify(overrides)}`);

        const actionable = plan.cascade.filter((c) => c.action !== 'skip');
        if (actionable.length === 0) {
          console.log(`[changeset:cascade] no actionable products (all action=skip)`);
          return {
            output: { total: 0, done: true },
            result: { cascade: { total: 0, clean: plan.stats.skip, summary: 'All products unaffected (skip).' } },
          };
        }

        const deferred    = actionable.filter((c) => overrides[c.productId] === 'defer');
        const skippedUser = actionable.filter((c) => overrides[c.productId] === 'skip');
        const toSpawn     = actionable.filter((c) => (overrides[c.productId] ?? 'include') === 'include');

        console.log(`[changeset:cascade] toSpawn=${toSpawn.length} deferred=${deferred.length} skippedByUser=${skippedUser.length}`);

        for (const entry of toSpawn) {
          const childMode = resolveProductMode(entry.productId, planAutonomy);
          if (entry.action === 'migrate') {
            await ctx.spawnChild({
              agentType: 'evolution',
              scope:     { lineId: ctx.lineId, productId: entry.productId },
              input:     { mode: 'migration' },
              autonomyMode: childMode,
            });
          } else {
            await ctx.spawnChild({
              agentType: 'regen',
              scope:     { lineId: ctx.lineId, productId: entry.productId },
              input:     { force: false },
              autonomyMode: childMode,
            });
          }
        }

        if (toSpawn.length === 0) {
          return {
            output: { total: 0, done: true, deferred: deferred.map((c) => c.name), skippedByUser: skippedUser.map((c) => c.name) },
            result: { cascade: { total: 0, clean: 0, summary: 'All actionable products deferred or skipped by user.', deferred: deferred.map((c) => c.name), skippedByUser: skippedUser.map((c) => c.name) } },
          };
        }

        return {
          output: { total: toSpawn.length, pending: toSpawn.length, done: false, deferred: deferred.map((c) => c.name), skippedByUser: skippedUser.map((c) => c.name) },
          awaitChild: true,
        };
      },
    },

    /**
     * Phase 5 — Verify.
     *
     * Aggregates cascade child outcomes into a verification summary.
     * Products awaiting conflict review are listed individually for follow-up.
     */
    {
      name: 'verify',
      kind: 'deterministic',
      run: async (ctx) => {
        const repo     = Container.get(AgentRunRepository);
        const children = await repo.findByParentRunId(ctx.run._id);
        const plan     = ctx.getStepOutput('plan');

        const verification = buildVerificationSummary(children);

        const markdown =
          `## Phase 6 · Cascade complete\n\n` +
          `**${verification.summary}**\n\n` +
          (verification.pendingConflicts.length
            ? `\n⚠️ Products awaiting conflict resolution: ${verification.pendingConflicts.join(', ')}\n`
            : '') +
          (verification.failedProducts.length
            ? `\n❌ Failed: ${verification.failedProducts.join(', ')}\n`
            : '') +
          `\n_Edit class:_ **${plan?.editClass ?? '?'}** · _Products touched:_ ${verification.total}`;

        const cascadeOutput = ctx.getStepOutput('cascade') ?? {};
        const verificationWithOverrides = {
          ...verification,
          deferred:      cascadeOutput.deferred      ?? [],
          skippedByUser: cascadeOutput.skippedByUser ?? [],
        };

        return {
          output: verificationWithOverrides,
          result: {
            editClass:      plan?.editClass,
            origin:         ctx.input?.origin ?? 'manual',
            cascade:        verificationWithOverrides,
            verifyMarkdown: markdown,
          },
        };
      },
    },

    /**
     * Phase 6 — Test.
     *
     * Tests ALL non-skip products (not just top-3) at their post-cascade main branch
     * state. Results are persisted to TestResult for the board's per-product chip.
     * Processes in batches of 5 in parallel; each product gets a 90 s per-product
     * internal timeout.
     *
     * For generalization edits introducing new optional features, also performs 1-wise
     * interaction testing via testPlatformFileEdits.
     *
     * Results are stored in run.result.sandbox for the approve-tests step.
     */
    {
      name: 'test',
      kind: 'playground',
      run: async (ctx) => {
        const plan = ctx.getStepOutput('plan');
        if (!plan) return { output: { skipped: true, reason: 'no plan' } };

        const playground     = Container.get(PlaygroundService);
        const productRepo    = Container.get(ProductRepository);
        const testResultRepo = Container.get(TestResultRepository);

        const PER_PRODUCT_MS = 90_000;
        const BATCH_SIZE     = 5;

        const withTimeout = (fn) =>
          Promise.race([
            fn(),
            new Promise((resolve) =>
              setTimeout(() => resolve({ timedOut: true, passed: false, noTestCommand: false }), PER_PRODUCT_MS)
            ),
          ]);

        // Persist a TestResult for a product test outcome (best-effort).
        const persistResult = async (entry, result) => {
          if (result.timedOut || result.noTestCommand) return;
          try {
            const product = await productRepo.findById(entry.productId);
            await testResultRepo.save(
              new TestResult({
                productId: entry.productId,
                lineId:    ctx.lineId,
                version:   product?.spec?.basicData?.version ?? null,
                features:  product ? normalizeFeatureSelection({ spec: product.spec }) : [],
                passed:    Boolean(result.passed),
                exitCode:  result.exitCode ?? null,
                durationMs: null,
                status:    result.passed ? 'passed' : 'failed',
                logTail:   (result.log ?? '').slice(-2000),
                createdBy: ctx.userId,
              })
            );
          } catch { /* best-effort */ }
        };

        // ── Part A: test non-skip products in batches ─────────────────────────
        // Honour the operator's plan-approval overrides: don't test products the
        // user explicitly deferred or skipped (they were never regenerated in
        // this run so testing them adds noise and misleads the test-review gate).
        const planApproved = ctx.getProposals().find(
          (p) => p.kind === 'plan_approval' && (p.decision === 'approved' || p.decision === 'auto')
        );
        const testOverrides = planApproved?.body?.decisionMeta?.overrides ?? {};
        const candidates = (plan.cascade ?? [])
          .filter((c) => c.action !== 'skip')
          .filter((c) => {
            const ov = testOverrides[c.productId];
            return ov !== 'skip' && ov !== 'defer';
          });
        const mainResults = [];

        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
          const batch = candidates.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map((entry) =>
              withTimeout(() =>
                playground.testFileEdits({
                  userId:    ctx.userId,
                  productId: entry.productId,
                  branch:    'main',
                  fileEdits: [],
                })
              )
                .then(async (r) => {
                  const out = { ...r, productId: entry.productId, name: entry.name };
                  await persistResult(entry, r);
                  return out;
                })
                .catch((err) => ({
                  productId:     entry.productId,
                  name:          entry.name,
                  passed:        false,
                  noTestCommand: false,
                  error:         err?.message ?? String(err),
                }))
            )
          );
          mainResults.push(...batchResults);
        }

        // ── Part B: 1-wise interaction testing (generalization only) ──────────
        const twiseResults = [];
        if (plan.editClass === 'generalization' && plan.newFeatures?.length > 0) {
          const repEntry = plan.cascade.find((c) => c.action === 'regen' && !c.isCritical);
          if (repEntry) {
            for (const featureName of plan.newFeatures.slice(0, 2)) {
              try {
                const product = await productRepo.findById(repEntry.productId);
                if (!product) continue;
                const { spec: resolvedSpec, source } = await Container.get(ProductSpecService).getSpecFromHostOrCache({
                  userId: ctx.userId, productProjectId: product.repo.id, fallbackSpec: product.spec,
                  context: `changesetAgent.test(twise): product ${repEntry.productId}`,
                });
                const spec = source === 'repo' ? normalizeProductSpec({ spec: resolvedSpec }) : resolvedSpec;
                const baseSelection = normalizeFeatureSelection({ spec });
                if (baseSelection.includes(featureName)) continue;
                const r = await withTimeout(() =>
                  playground.testPlatformFileEdits({
                    userId:           ctx.userId,
                    productId:        repEntry.productId,
                    fileEdits:        [],
                    featureSelection: [...baseSelection, featureName],
                    branch:           'main',
                  })
                );
                twiseResults.push({
                  featureName, productId: repEntry.productId, productName: repEntry.name, ...r,
                });
              } catch (err) {
                twiseResults.push({
                  featureName, productId: repEntry.productId, productName: repEntry.name,
                  passed: false, error: err?.message ?? String(err),
                });
              }
            }
          }
        }

        // ── Aggregate ─────────────────────────────────────────────────────────
        const withCmd    = mainResults.filter((r) => !r.noTestCommand);
        const noCmd      = mainResults.filter((r) => r.noTestCommand);
        const timedOut   = mainResults.filter((r) => r.timedOut);
        const passed     = withCmd.filter((r) => r.passed && !r.timedOut);
        const failed     = withCmd.filter((r) => !r.passed && !r.timedOut);
        const twiseFailed        = twiseResults.filter((r) => !r.passed && !r.timedOut && !r.noTestCommand);
        const interactionFaults  = twiseFailed.map((r) => `${r.featureName} + ${r.productName}`);
        const allPassed          = failed.length === 0 && interactionFaults.length === 0 && timedOut.length === 0;

        let summary;
        if (withCmd.length === 0 && twiseResults.length === 0) {
          summary = 'No test commands configured — skipping sandbox verification.';
        } else {
          const parts = [];
          if (withCmd.length > 0) parts.push(`${passed.length}/${withCmd.length} product test${withCmd.length !== 1 ? 's' : ''} passed`);
          if (timedOut.length > 0) parts.push(`${timedOut.length} timed out`);
          if (noCmd.length > 0) parts.push(`${noCmd.length} no test command`);
          if (interactionFaults.length > 0) parts.push(`interaction faults: ${interactionFaults.join(', ')}`);
          summary = parts.join(' · ');
        }

        const sandboxOutput = {
          tested:         withCmd.length,
          passed:         passed.length,
          failed:         failed.length,
          timedOut:       timedOut.length,
          noTestCmd:      noCmd.length,
          failedProducts: failed.map((r) => r.name),
          twise:          twiseResults.length > 0 ? { tested: twiseResults.length, faults: interactionFaults } : null,
          allPassed,
          summary,
          perProduct:     mainResults.map((r) => ({
            productId: r.productId,
            name:      r.name,
            passed:    r.passed,
            timedOut:  r.timedOut,
            noTestCmd: r.noTestCommand,
            error:     r.error ?? null,
          })),
        };

        return {
          output: sandboxOutput,
          result: { ...(ctx.run.result ?? {}), sandbox: sandboxOutput },
        };
      },
    },

    /**
     * Phase 7 — Approve tests.
     *
     * Presents the test results for review. Gate behaviour depends on run.autonomyMode:
     *   manual    → always require human
     *   semi      → auto-proceed when all tests pass (unambiguous); require on any failure
     *   automatic → always auto (LLM judges pre-existing vs regression before this step
     *               in a future iteration; for now auto means accept failures as signals)
     *
     * On approval the operator confirms the cascade+test outcome and sets the set of
     * deploy-eligible products (carried in decisionMeta.deployEligible).
     */
    {
      name: 'approve-tests',
      kind: 'approval',
      run: async (ctx) => {
        const sandbox  = ctx.getStepOutput('test');
        const plan     = ctx.getStepOutput('plan');
        const verify   = ctx.getStepOutput('verify');

        const allPassed = sandbox?.allPassed ?? true;
        const summary   = sandbox?.summary   ?? 'No tests run.';

        const markdown =
          `## Phase 8 · Test review\n\n` +
          `**${summary}**\n\n` +
          (sandbox?.failedProducts?.length
            ? `\n❌ Failed products: ${sandbox.failedProducts.join(', ')}\n`
            : '') +
          (sandbox?.twise?.faults?.length
            ? `\n⚠️ Interaction faults: ${sandbox.twise.faults.join(', ')}\n`
            : '') +
          `\n_Cascade:_ ${verify?.summary ?? '?'}\n` +
          `\n_Approving advances to the Deploy step, which merges bigbang → main in each eligible product._`;

        // Deploy-eligible defaults: products that completed the cascade cleanly
        // AND that the operator didn't defer/skip in the plan-approval matrix.
        // Otherwise a "skip" override would still deploy the product's stale
        // bigbang branch, which is exactly the opposite of what "skip" means.
        // Also exclude anything the cascade itself reported as failed or still
        // awaiting conflict review — those never produced a deployable bigbang
        // branch, so defaulting them into the deploy set would either no-op or
        // publish a stale/unintended state.
        const planApproved = ctx.getProposals().find(
          (p) => p.kind === 'plan_approval' && (p.decision === 'approved' || p.decision === 'auto')
        );
        const planOverrides = planApproved?.body?.decisionMeta?.overrides ?? {};
        const notDeployable = new Set([
          ...(verify?.failedProductIds ?? []),
          ...(verify?.pendingProductIds ?? []),
        ]);
        const eligibleByDefault = (plan?.cascade ?? [])
          .filter((c) => c.action !== 'skip')
          .filter((c) => !notDeployable.has(c.productId))
          .filter((c) => {
            const ov = planOverrides[c.productId];
            return ov !== 'skip' && ov !== 'defer';
          })
          .map((c) => c.productId);

        return {
          output: { proposed: true, allPassed },
          proposal: {
            kind:        'test_review',
            blastRadius: 'product',     // reversible — just a review gate
            // unambiguous = true only when all tests pass; drives semi-auto behaviour.
            unambiguous: allPassed,
            target:      { lineId: ctx.lineId },
            body: {
              phase:         'Phase 8 · Test review',
              sandbox,
              verifyMarkdown: verify ? undefined : null,
              summary,
              allPassed,
              markdown,
              eligibleByDefault,
            },
          },
        };
      },
    },

    /**
     * Phase 9 — Deploy to products.
     *
     * For every product whose test_review approval said "deploy me" (defaulting
     * to all products that survived the cascade), attempt to merge the product's
     * bigbang branch into main — that's what "publishing" a regen change to
     * production looks like in this repo layout. Failures never abort the whole
     * step: they are collected per product and surfaced in the ledger so the
     * user can retry manually.
     */
    {
      name: 'deploy',
      kind: 'git',
      // Sequential MRs across N products can take a while (a merge may wait
      // for the host's checks). Give it 5 min instead of the 30 s default for git steps.
      timeoutMs: 300_000,
      run: async (ctx) => {
        const { Container: TypeDI } = await import('typedi');
        const { branches } = await import('../tools/git.js');
        const repo = await import('../../linea/repo.js');
        const ProductRepositoryDefault = await import('../../model/repositories/ProductRepository.js');
        const ProductRepositoryCtor = ProductRepositoryDefault.default ?? ProductRepositoryDefault;

        const approved = ctx.getProposals().find(
          (p) => p.kind === 'test_review' && (p.decision === 'approved' || p.decision === 'auto')
        );
        if (!approved) {
          return { output: { skipped: true, reason: 'test_review not approved' } };
        }

        const meta = approved.body?.decisionMeta ?? {};
        const eligible = approved.body?.eligibleByDefault ?? [];
        // decisionMeta.deployEligible wins over eligibleByDefault; if the user
        // did not narrow anything, we deploy the full eligible set.
        const requested = Array.isArray(meta.deployEligible) ? meta.deployEligible : eligible;
        const selected  = requested.filter((id) => eligible.includes(id));

        if (selected.length === 0) {
          return {
            output: { skipped: true, reason: 'no products selected for deploy', eligible: eligible.length },
            result: { ...(ctx.run.result ?? {}), deploy: { skipped: true, eligibleCount: eligible.length } },
          };
        }

        const productRepo   = TypeDI.get(ProductRepositoryCtor);

        // Per-product ceiling for the whole "create MR + merge" block, so a
        // CI-gated MR cannot hang the step forever.
        const PER_PRODUCT_MS = 90_000;
        const withDeadline = (promise, ms, label) => Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(
            () => reject(new Error(`timed out after ${ms / 1000}s waiting for the git host (${label})`)),
            ms,
          )),
        ]);

        const results = [];
        for (const productId of selected) {
          const entry = { productId, name: null, deployed: false, mock: false, error: null, mrIid: null };
          try {
            const product = await productRepo.findById(productId);
            entry.name = product?.spec?.basicData?.name ?? String(productId);

            const projectId = product.repo.id;

            let mr;
            try {
              mr = await withDeadline(repo.createMergeRequest({
                id: projectId,
                title: `Deploy: bigbang → main (changeset ${String(ctx.run._id).slice(-6)})`,
                sourceBranch: branches.base,
                targetBranch: branches.default,
              }), 15_000, 'create MR');
            } catch (mrErr) {
              // MR may already exist from a prior attempt — try to find and reuse it.
              const open = await withDeadline(
                repo.listMergeRequests({ id: projectId, state: 'opened', targetBranch: branches.default }),
                15_000, 'list open MRs',
              );
              mr = open.find((m) => m.sourceBranch === branches.base);
              if (!mr) throw mrErr;
            }
            entry.mrIid = mr.number;

            const outcome = await withDeadline(
              repo.mergeMergeRequest({ id: projectId, number: mr.number }),
              PER_PRODUCT_MS, 'merge',
            );
            entry.deployed = Boolean(outcome?.merged);
            if (!outcome?.merged) entry.error = outcome?.conflicts ? 'merge_conflicts' : 'not_merged';
          } catch (err) {
            entry.error = err?.message ?? String(err);
            // Fall back to a mock deploy so the ledger reflects intent — the user
            // can retry once the git host is reachable later.
            if (!productRepo || !ctx.userId) {
              entry.mock = true;
              entry.deployed = true;
            }
          }
          results.push(entry);
        }

        const deployed = results.filter((r) => r.deployed && !r.mock).length;
        const mocked   = results.filter((r) => r.mock).length;
        const failed   = results.filter((r) => !r.deployed && !r.mock).length;

        return {
          output: {
            total: results.length, deployed, mocked, failed,
            summary: `${deployed} deployed · ${mocked} mocked · ${failed} failed`,
            perProduct: results,
          },
          result: {
            ...(ctx.run.result ?? {}),
            deploy: {
              total: results.length, deployed, mocked, failed,
              perProduct: results,
              summary: `${deployed} deployed · ${mocked} mocked · ${failed} failed`,
            },
          },
        };
      },
    },

    /**
     * Phase 10 — Record.
     *
     * Writes the final ledger and a structured memory fact. The memory text is
     * embedded by MemoryService so future changeset plans can RAG-recall patterns
     * like "last generalization caused Billing to conflict".
     */
    {
      name: 'record',
      kind: 'deterministic',
      run: async (ctx) => {
        const plan    = ctx.getStepOutput('plan');
        const verify  = ctx.getStepOutput('verify');
        const sandbox = ctx.getStepOutput('test');

        const deploy = ctx.getStepOutput('deploy');
        const sandboxNote = sandbox && !sandbox.skipped
          ? ` Tests: ${sandbox.summary}.`
          : '';
        const deployNote = deploy && !deploy.skipped
          ? ` Deploy: ${deploy.summary}.`
          : '';

        const memoryText =
          `ChangeSet (${ctx.input?.origin ?? 'manual'}) editClass=${plan?.editClass ?? '?'} ` +
          `branch=${ctx.input?.branch ?? 'none'} ` +
          `autonomy=${ctx.run.autonomyMode ?? 'semi'} ` +
          `cascade: ${verify?.total ?? 0} products, ` +
          `${verify?.migrated ?? 0} migrated, ${verify?.clean ?? 0} clean, ` +
          `${verify?.conflicted ?? 0} conflict-resolved, ${verify?.failed ?? 0} failed.` +
          (verify?.pendingConflicts?.length
            ? ` Still pending: ${verify.pendingConflicts.join(', ')}.`
            : '') +
          sandboxNote + deployNote;

        return {
          output: { recorded: true, memoryText },
          result: {
            ...(ctx.run.result ?? {}),
            sandbox: sandbox ?? null,
            deploy: deploy ?? null,
            ledger: {
              plan,
              verify,
              sandbox,
              deploy,
              recorded:  new Date().toISOString(),
              memoryText,
            },
          },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
