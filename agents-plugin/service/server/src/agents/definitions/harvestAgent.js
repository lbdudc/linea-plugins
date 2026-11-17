import { Container } from 'typedi';
import { registerAgent } from '../core/AgentRegistry.js';
import { productAccess, lineAccess, branches } from '../tools/git.js';
import { getCommits } from '../../linea/repo.js';
import { normalizeFeatureSelection, invalidateFmCache } from '../tools/splContext.js';
import {
  detectProductChanges,
  readLineModel,
  validateModelAgainstProducts,
  openLineHarvestMr,
  classifyChangeSignals,
} from '../tools/harvest.js';
import { runHarvestProposal, buildProposalMarkdown, planToToolInput } from '../harvest/proposeHarvest.js';
import { normalizeHarvestFmResult } from '../sync/syncValidation.js';
import LineService from '../../model/services/LineService.js';
import AgentRunRepository from '../models/AgentRunRepository.js';

// The dryRun flag bypasses all git writes — useful for the first end-to-end
// test of the harvest path without actually opening a line MR.
const isDryRun = (ctx) => Boolean(ctx.input?.dryRun);

// Resolve the "harvest from" input into a concrete git ref (commit SHA or branch name).
// mode=bigbang (default): bigbang branch — full history since generation
// mode=last_harvest: first commit before the last successful harvest run
// mode=date: first commit on/before fromDate (YYYY-MM-DD)
// mode=commit: SHA passed directly by the user
const resolveFromRef = async ({ projectId, productId, input }) => {
  const mode = input?.fromMode;
  if (!mode || mode === 'bigbang') return undefined;
  if (mode === 'commit') return input.fromRef ?? undefined;

  let until;
  if (mode === 'last_harvest') {
    const lastRun = await Container.get(AgentRunRepository).findLastSuccessfulHarvest(productId);
    if (!lastRun) return undefined;
    until = lastRun.createdAt.toISOString();
  } else if (mode === 'date' && input.fromDate) {
    until = `${input.fromDate}T23:59:59Z`;
  }

  if (until) {
    // the newest commit made on or before that moment (the host answers newest first)
    const commits = await getCommits({ id: projectId, ref: branches.default, perPage: 100 });
    const found = (commits ?? []).find((c) => new Date(c.createdAt) <= new Date(until));
    if (found) return found.shortId;
    // not widening the range without saying so: the latest 100 commits are all newer than that
    throw new Error(`No commit of ${branches.default} is as old as ${until} among its latest 100: pick a commit instead`);
  }
  return undefined;
};

const MAX_FILES = 20;
const MAX_DIFF_CHARS = 3000;

const definition = {
  type: 'harvest',
  title: 'Harvest Agent',
  description:
    'Lifts a useful product-side change back into the SPL platform: opens a line-repo MR that adds a new optional feature and the concrete platform file edits to implement it.',
  scope: 'product',

  steps: [
    {
      name: 'detect-changes',
      kind: 'git',
      run: async (ctx) => {
        if (!ctx.productId) throw new Error('harvest agent requires scope.productId');

        // Merge run: no per-product diff. Resolve the line model only — the
        // unified plan is synthesized from the source proposals in propose-plan.
        if (ctx.input?.merge) {
          const n = (ctx.input.merge.sourceRunIds ?? []).length;
          const { line } = await productAccess({
            productId: ctx.productId,
            userId: ctx.userId,
            });
          const model = await readLineModel({ lineProjectId: line.repoId, lineId: String(line._id), userId: ctx.userId });
          return {
            output: {
              merge: true,
              productName: `Merged (${n} proposals)`,
              fromWhenLabel: 'merged proposals',
              features: [],
              lineProjectId: line.repoId,
              fileCount: 0,
              files: [],
              commits: [],
              model,
            },
          };
        }

        const { product, line, projectId } = await productAccess({
          productId: ctx.productId,
          userId: ctx.userId,
          });
        const fromRef = await resolveFromRef({ projectId, productId: ctx.productId, input: ctx.input });
        const changes = await detectProductChanges({ projectId, fromRef });
        const fromWhenLabel = (() => {
          const mode = ctx.input?.fromMode;
          if (!mode || mode === 'bigbang') return 'initial generation (bigbang)';
          if (mode === 'last_harvest') return 'last harvest run';
          if (mode === 'date') return ctx.input.fromDate ?? 'selected date';
          if (mode === 'commit') return `commit ${(ctx.input.fromRef ?? '').slice(0, 8)}`;
          return mode;
        })();
        if (changes.files.length === 0) {
          return { output: { empty: true, reason: `No direct changes on main beyond ${fromWhenLabel}.`, fromWhenLabel } };
        }
        const model = await readLineModel({ lineProjectId: line.repoId, lineId: String(line._id), userId: ctx.userId });
        return {
          output: {
            productName: product.spec?.basicData?.name ?? String(product._id),
            fromWhenLabel,
            features: normalizeFeatureSelection({ spec: product.spec }),
            lineProjectId: line.repoId,
            fileCount: changes.files.length,
            files: changes.files.slice(0, MAX_FILES).map((f) => ({
              path: f.path,
              added: f.added,
              deleted: f.deleted,
              renamed: f.renamed,
              diff: (f.diff ?? '').slice(0, MAX_DIFF_CHARS),
            })),
            commits: changes.commits,
            model,
          },
        };
      },
    },

    {
      // Deterministic signals (file ownership + commit hints) that ground the
      // LLM's change-type decision and let the Variant Divergence Miner cluster
      // without any LLM call. The LLM may override the suggested type.
      name: 'classify-changes',
      kind: 'deterministic',
      run: async (ctx) => {
        const detect = ctx.getStepOutput('detect-changes');
        if (detect.empty || detect.merge) return { output: { skipped: true } };
        const signals = classifyChangeSignals({ files: detect.files, commits: detect.commits });
        return { output: signals };
      },
    },

    {
      name: 'propose-plan',
      kind: 'llm',
      toolLoop: true, // durable multi-turn investigation via ctx.runToolLoop
      run: async (ctx) => {
        const detect = ctx.getStepOutput('detect-changes');
        if (detect.empty) return { output: { harvestable: false, reason: detect.reason } };

        const { line } = await productAccess({
          productId: ctx.productId,
          userId: ctx.userId,
          });

        // Merge run: synthesize ONE plan from the source runs' pending proposals,
        // steered by the operator's free-text merge directive.
        if (ctx.input?.merge) {
          const repo = Container.get(AgentRunRepository);
          const sources = [];
          for (const id of ctx.input.merge.sourceRunIds ?? []) {
            const src = await repo.findById(id);
            const p = src?.proposals?.find((x) => x.kind === 'fm_patch' && !x.decision);
            if (p) sources.push({ title: p.body?.title, plan: p.body?.plan });
          }
          if (sources.length < 2) {
            return { output: { harvestable: false, reason: 'Fewer than two source proposals are still pending; nothing to merge.' } };
          }
          const merged = await runHarvestProposal({
            lineProjectId: line.repoId,
            detect,
            merge: { sources, directive: ctx.input.merge.directive ?? '' },
            memories: ctx.memories, instructions: ctx.instructions,
            loopRunner: ctx.runToolLoop,
          });
          if (!merged) return { output: { harvestable: false, reason: 'No structured proposal returned.' } };
          return { output: { ...merged } };
        }

        const signals = ctx.getStepOutput('classify-changes');
        const steering = ctx.input?.steering ?? null;
        const proposal = await runHarvestProposal({
          lineProjectId: line.repoId,
          detect,
          signals: signals?.skipped ? null : signals,
          steering,
          memories: ctx.memories, instructions: ctx.instructions,
          loopRunner: ctx.runToolLoop,
        });
        if (!proposal) return { output: { harvestable: false, reason: 'No structured proposal returned.' } };
        return { output: { ...proposal } };
      },
    },

    {
      name: 'validate-fm',
      kind: 'deterministic',
      run: async (ctx) => {
        const detect = ctx.getStepOutput('detect-changes');
        const plan = ctx.getStepOutput('propose-plan');

        if (!plan?.harvestable || !plan.newModelUvl || detect.model?.type !== 'UVL') {
          return { output: { validated: false, reason: 'No UVL feature-model patch to validate.' } };
        }

        const products = await Container.get(LineService).findProductsByLineId({
          id: ctx.lineId, userId: ctx.userId, specFromRepo: true,
        });
        try {
          const { valid, broken } = validateModelAgainstProducts({
            modelContent: plan.newModelUvl,
            type: 'UVL',
            products,
          });
          return { output: { validated: true, valid, broken, checked: products.length } };
        } catch (err) {
          return { output: { validated: true, valid: false, broken: [], parseError: err?.message ?? String(err) } };
        }
      },
    },

    {
      name: 'propose-harvest',
      kind: 'approval',
      run: async (ctx) => {
        const detect = ctx.getStepOutput('detect-changes');
        const plan = ctx.getStepOutput('propose-plan');
        const validation = ctx.getStepOutput('validate-fm');

        const changeType = plan?.changeType ?? 'ambiguous';

        if (!plan?.harvestable) {
          return {
            output: { harvestable: false, changeType },
            result: { harvestable: false, changeType, reasoning: plan?.reason ?? plan?.reasoning ?? null },
          };
        }

        const fmUsable = Boolean(plan.newModelUvl) && detect.model?.type === 'UVL';
        const fileEdits = Array.isArray(plan.fileEdits) ? plan.fileEdits : [];

        if (fmUsable && validation?.validated && !validation.valid) {
          return {
            output: { blocked: true, changeType, broken: validation.broken, parseError: validation.parseError ?? null },
            result: {
              harvestable: true,
              changeType,
              blocked: true,
              reason: 'The proposed feature-model change would break existing products; not proposing an MR.',
              broken: validation.broken,
            },
          };
        }

        const markdown = buildProposalMarkdown({ plan, validation, model: detect.model });

        if (!fmUsable && fileEdits.length === 0) {
          return {
            output: { advisoryOnly: true, changeType },
            result: { harvestable: true, changeType, advisory: true, markdown, featureName: plan.featureName ?? null },
          };
        }

        // Type-aware MR/proposal title.
        const title =
          changeType === 'bugfix-to-generated'
            ? 'Harvest: propagate fix to the platform'
            : changeType === 'extend-existing-feature'
            ? `Harvest: extend feature ${plan.featureName ?? '(change)'}`
            : `Harvest: add optional feature ${plan.featureName ?? '(change)'}`;

        return {
          output: { proposed: true, changeType, featureName: plan.featureName, fileCount: fileEdits.length },
          proposal: {
            kind: 'fm_patch',
            blastRadius: 'line', // always propose-and-wait — affects every product
            target: { lineProjectId: detect.lineProjectId, modelPath: detect.model.path },
            body: {
              title,
              changeType,
              featureName: plan.featureName ?? null,
              markdown,
              modelPath: detect.model?.path ?? null,
              fmOld: detect.model?.content ?? '',
              newModelUvl: fmUsable ? plan.newModelUvl : null,
              fileEdits,
              plan: planToToolInput(plan), // raw plan, so /refine can revise it
              validation: fmUsable ? { fm: normalizeHarvestFmResult(validation) } : null,
            },
          },
        };
      },
    },

    {
      name: 'open-mr',
      kind: 'git',
      run: async (ctx) => {
        const proposal = ctx
          .getProposals()
          .find((p) => p.kind === 'fm_patch' && p.decision === 'approved');

        if (!proposal) return { output: { opened: false } };

        // Re-validate the FM against all products immediately before the write.
        // The proposal may have sat in awaiting_approval while the FM or products drifted.
        if (proposal.body.newModelUvl) {
          const products = await Container.get(LineService).findProductsByLineId({
            id: ctx.lineId, userId: ctx.userId, specFromRepo: true, cutOnInfra: true,
          });
          const { valid, broken } = validateModelAgainstProducts({
            modelContent: proposal.body.newModelUvl,
            type: 'UVL',
            products,
          });
          if (!valid) {
            const names = broken.map((b) => b.name).join(', ');
            throw new Error(
              `Pre-write validation failed: the approved FM patch now breaks ${broken.length} product(s): ${names}. ` +
              'Reject and re-run harvest after reviewing the feature model.'
            );
          }
        }

        const dry = isDryRun(ctx);

        const { lineProjectId } = await lineAccess({
          lineProjectId: proposal.target.lineProjectId,
          userId: ctx.userId,
        });

        const mr = await openLineHarvestMr({
          lineProjectId,
          lineId: ctx.lineId,
          userId: ctx.userId,
          modelPath: proposal.target.modelPath,
          newModelContent: proposal.body.newModelUvl,
          featureName: proposal.body.featureName,
          planMarkdown: proposal.body.markdown,
          fileEdits: proposal.body.fileEdits ?? [],
          title: proposal.body.title,
          dryRun: dry,
        });

        if (!dry) invalidateFmCache(ctx.lineId);

        return {
          output: { opened: !dry, dryRun: dry, changeType: proposal.body.changeType ?? null, mrUrl: mr.mrUrl ?? null, branch: mr.branch, filesCommitted: mr.filesCommitted },
          result: {
            harvestable: true,
            changeType: proposal.body.changeType ?? null,
            opened: !dry,
            dryRun: dry,
            featureName: proposal.body.featureName,
            mrUrl: mr.mrUrl ?? null,
            // branch is carried so the auto-triggered ChangeSet can use it as a plan
            // working branch and merge it into main (instead of the old "FM on main" assumption).
            branch: mr.branch ?? null,
            filesCommitted: mr.filesCommitted,
            ...(dry ? { dryRunPayload: mr } : {}),
          },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
