import { Container } from 'typedi';
import { registerAgent } from '../core/AgentRegistry.js';
import { complete } from '../core/llm.js';
import { loadFeatureModel, scanProducts, invalidateFmCache } from '../tools/splContext.js';
import {
  extractFeaturesFromModel,
  computeMandatoryFeatures,
  computePortfolioAnomalies,
} from '../tools/fmAnalysis.js';
import {
  validateModelAgainstProducts,
  openLineHarvestMr,
  readLineModel,
} from '../tools/harvest.js';
import { lineAccess } from '../tools/git.js';
import LineService from '../../model/services/LineService.js';

/**
 * FM Constraint Advisor — close the loop on coupling smells.
 *
 * Deterministic core: findCouplingSmells (always co-selected pairs) + mandatory/
 * zombie analysis from fmAnalysis.js. Every LLM-proposed constraint is validated
 * with validateModelAgainstProducts against every product before being included in
 * the fm_patch proposal. A proposed constraint that would break any existing product
 * is silently dropped — the LLM cannot override the deterministic guard.
 *
 * Write path: reuses openLineHarvestMr (with dryRun support and idempotent branch
 * creation) inherited from W3 hardening.
 */

const SYSTEM_PROMPT = `You are an SPL feature model constraint advisor.
You are given coupling smells from a Software Product Line — feature pairs that are
always co-selected whenever either one is selected. Your job is to propose formal UVL
constraint text that encodes these observed patterns.

For each coupling smell pair (A, B), choose the most appropriate constraint:
- "A <=> B"  — both must always be selected together (bidirectional)
- "A => B"   — selecting A requires B (unidirectional, if asymmetric usage is plausible)
- skip       — if the coupling appears coincidental or domain-specific

Use the exact feature names from the model. Only propose constraints you are confident about.
Call propose_constraints with your analysis.`;

const PROPOSE_TOOL = {
  name: 'propose_constraints',
  description: 'Propose UVL constraints for coupling smells and an advisory for other findings.',
  input_schema: {
    type: 'object',
    properties: {
      constraints: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pair: {
              type: 'array',
              items: { type: 'string' },
              description: 'The two feature names involved.',
            },
            uvlText: {
              type: 'string',
              description: 'UVL constraint expression, e.g. "A <=> B" or "A => B".',
            },
            rationale: { type: 'string' },
          },
          required: ['pair', 'uvlText', 'rationale'],
        },
      },
      advisory: {
        type: 'string',
        description: 'Short markdown advisory on zombie optionals and stranded features.',
      },
    },
    required: ['constraints', 'advisory'],
  },
};

/**
 * Extract feature names referenced in a UVL constraint expression.
 * Strips operators (<=>, =>, !, &, |, parentheses) and returns identifier tokens.
 */
function featuresInConstraint(uvlText) {
  return (uvlText ?? '')
    .replace(/<=>|=>|!|\(|\)|&|\|/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !/^(true|false)$/i.test(t));
}

/**
 * Append constraint lines to the constraints section of a UVL model string.
 * Handles both existing and absent constraints blocks.
 */
function injectConstraints(modelStr, constraintLines) {
  if (!constraintLines.length) return modelStr;
  const indented = constraintLines.map((l) => `    ${l.trim()}`).join('\n');
  if (/^constraints\b/m.test(modelStr)) {
    return modelStr.trimEnd() + '\n' + indented + '\n';
  }
  return modelStr.trimEnd() + '\n\nconstraints\n' + indented + '\n';
}

const isDryRun = (ctx) => Boolean(ctx.input?.dryRun);

const definition = {
  type: 'fm-constraint-advisor',
  title: 'FM Constraint Advisor',
  description:
    'Analyses coupling smells in the product portfolio and proposes validated UVL constraints to formalise them. Every candidate is deterministically checked against all products before inclusion. Read-only if no constraints survive validation.',
  scope: 'line',

  steps: [
    {
      name: 'detect-smells',
      kind: 'deterministic',
      run: async (ctx) => {
        if (!ctx.lineId) throw new Error('fm-constraint-advisor requires scope.lineId');

        const { line, model, modelStr, type } = await loadFeatureModel({
          lineId: ctx.lineId,
          userId: ctx.userId,
        });
        const scan = await scanProducts({ lineId: ctx.lineId, userId: ctx.userId });

        const allFmFeatures = extractFeaturesFromModel({ modelStr, type });
        const { voidModel, mandatory } = computeMandatoryFeatures({ model });

        const validVerdicts = scan.verdicts.filter((v) => v.status === 'valid');
        const { stranded, zombieOptionals, couplingSmells } = computePortfolioAnomalies({
          allFmFeatures,
          validVerdicts,
          mandatory,
        });

        return {
          output: {
            line: { id: String(line._id), name: line.name, repoId: line.repoId },
            allFmFeatures,
            modelStr,
            type,
            totalProducts: scan.summary.total,
            validProducts: scan.summary.valid,
            couplingSmells,
            stranded,
            zombieOptionals,
            voidModel,
          },
        };
      },
    },

    {
      name: 'draft-constraints',
      kind: 'llm',
      run: async (ctx) => {
        const {
          line,
          allFmFeatures,
          couplingSmells,
          stranded,
          zombieOptionals,
          totalProducts,
          validProducts,
        } = ctx.getStepOutput('detect-smells');

        if (couplingSmells.length === 0) {
          return {
            output: {
              proposed: [],
              advisory: 'No coupling smells detected. No constraints to propose.',
              nothingToPropose: true,
            },
          };
        }

        const smellsList = couplingSmells
          .map(([a, b]) => `- (${a}, ${b}): always co-selected`)
          .join('\n');

        const { toolUses } = await complete({
          system: SYSTEM_PROMPT,
          tools: [PROPOSE_TOOL],
          messages: [
            {
              role: 'user',
              content:
                `## SPL: ${line.name}\n` +
                `FM features (${allFmFeatures.length}): ${allFmFeatures.join(', ')}\n` +
                `Products: ${totalProducts} total, ${validProducts} valid\n\n` +
                `## Coupling smells (${couplingSmells.length}):\n${smellsList}\n` +
                (stranded.length
                  ? `\n## Stranded features (in FM, never selected): ${stranded.join(', ')}\n`
                  : '') +
                (zombieOptionals.length
                  ? `\n## Zombie optionals (optional in FM but every product selects): ${zombieOptionals.join(', ')}\n`
                  : '') +
                `\nPropose constraints for the coupling smells. Use exact feature names.`,
            },
          ],
          memories: ctx.memories, instructions: ctx.instructions,
        });

        const call = toolUses.find((t) => t.name === 'propose_constraints');
        return {
          output: {
            proposed: call?.input?.constraints ?? [],
            advisory: call?.input?.advisory ?? '',
          },
        };
      },
    },

    {
      name: 'validate-constraints',
      kind: 'deterministic',
      run: async (ctx) => {
        const { proposed, advisory, nothingToPropose } = ctx.getStepOutput('draft-constraints');
        if (nothingToPropose || !proposed.length) {
          return { output: { valid: [], invalid: [], advisory, nothingToPropose: true } };
        }

        const { modelStr, type } = ctx.getStepOutput('detect-smells');
        const products = await Container.get(LineService).findProductsByLineId({
          id: ctx.lineId, userId: ctx.userId, specFromRepo: true,
        });

        const valid = [];
        const invalid = [];
        for (const c of proposed) {
          if (!c.uvlText?.trim()) {
            invalid.push({ ...c, reason: 'Empty uvlText.' });
            continue;
          }
          const newModelStr = injectConstraints(modelStr, [c.uvlText]);
          try {
            const { valid: ok, broken } = validateModelAgainstProducts({
              modelContent: newModelStr,
              type,
              products,
            });
            if (ok) {
              valid.push(c);
            } else {
              const names = broken.map((b) => b.name).join(', ');
              invalid.push({ ...c, reason: `Would break: ${names}` });
            }
          } catch (err) {
            invalid.push({ ...c, reason: `Parse error: ${err?.message ?? err}` });
          }
        }

        return { output: { valid, invalid, advisory } };
      },
    },

    {
      name: 'propagation-preview',
      kind: 'deterministic',
      run: async (ctx) => {
        const { valid, nothingToPropose } = ctx.getStepOutput('validate-constraints');
        if (nothingToPropose || !valid.length) {
          return { output: { propagation: [], nothingToPropose: true } };
        }

        // Fetch current product feature selections
        const products = await Container.get(LineService).findProductsByLineId({
          id: ctx.lineId, userId: ctx.userId, specFromRepo: true,
        });

        const propagation = valid.map((c) => {
          const constraintFeatures = new Set(featuresInConstraint(c.uvlText));
          const affected = products.filter((p) => {
            const sel = new Set(
              Array.isArray(p.spec?.features)
                ? p.spec.features
                : Object.keys(p.spec?.features ?? {}).filter((k) => p.spec.features[k])
            );
            return [...constraintFeatures].some((f) => sel.has(f));
          });
          return {
            uvlText: c.uvlText,
            pair: c.pair,
            affectedCount: affected.length,
            totalProducts: products.length,
            affectedProducts: affected.map((p) => p.spec?.basicData?.name ?? String(p._id)),
          };
        });

        return { output: { propagation } };
      },
    },

    {
      name: 'propose-patch',
      kind: 'approval',
      run: async (ctx) => {
        const { valid, invalid, advisory, nothingToPropose } = ctx.getStepOutput('validate-constraints');
        const { line, modelStr, type, couplingSmells } = ctx.getStepOutput('detect-smells');

        if (nothingToPropose || valid.length === 0) {
          const markdown =
            `## FM Constraint Advisor — ${line.name}\n\n` +
            (nothingToPropose
              ? 'No coupling smells detected — the portfolio has no always-co-selected pairs.\n'
              : `All ${invalid.length} proposed constraint(s) were rejected by deterministic validation.\n\n` +
                invalid.map((c) => `- \`${c.uvlText}\`: ${c.reason}`).join('\n') + '\n') +
            (advisory ? `\n### Advisory\n${advisory}\n` : '');
          return {
            output: { proposed: 0 },
            result: {
              lineName: line.name,
              couplingSmells: couplingSmells.length,
              constraintsProposed: 0,
              markdown,
              advisory,
            },
          };
        }

        const { propagation = [] } = ctx.getStepOutput('propagation-preview') ?? {};

        const newModelStr = injectConstraints(modelStr, valid.map((c) => c.uvlText));
        const droppedNote =
          invalid.length
            ? `\n> ${invalid.length} constraint(s) dropped (would break existing products or parse errors).\n`
            : '';

        const propagationLines = propagation.length
          ? '\n### Product impact\n' +
            propagation
              .map(
                (p) =>
                  `- \`${p.uvlText}\` affects **${p.affectedCount}/${p.totalProducts}** product(s)` +
                  (p.affectedProducts.length ? `: ${p.affectedProducts.join(', ')}` : '')
              )
              .join('\n') + '\n'
          : '';

        const markdown =
          `## FM Constraint Advisor — ${line.name}\n\n` +
          `Found **${couplingSmells.length}** coupling smell(s). ` +
          `Proposing **${valid.length}** validated constraint(s):\n\n` +
          valid.map((c) => `- \`${c.uvlText}\` — ${c.rationale}`).join('\n') +
          droppedNote +
          propagationLines +
          (advisory ? `\n### Advisory\n${advisory}\n` : '');

        return {
          output: { proposed: valid.length },
          proposal: {
            kind: 'fm_patch',
            blastRadius: 'line',
            target: {
              lineProjectId: line.repoId,
              lineId: ctx.lineId,
            },
            body: {
              title: `FM constraints: encode ${valid.length} coupling pattern(s) in ${line.name}`,
              constraints: valid,
              propagation,
              newModelStr,
              type,
              markdown,
              advisory,
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

        const dry = isDryRun(ctx);

        const { lineProjectId } = await lineAccess({
          lineProjectId: proposal.target.lineProjectId,
          userId: ctx.userId,
        });

        // Read the live model from the git host to get the exact path and current content.
        const currentModel = await readLineModel({ lineProjectId, lineId: ctx.lineId, userId: ctx.userId });
        if (currentModel.type !== 'UVL') {
          throw new Error(
            `FM Constraint Advisor only supports UVL models; found ${currentModel.type}.`
          );
        }

        // Build new content by appending the validated constraints to the live model.
        const constraintLines = proposal.body.constraints.map((c) => c.uvlText);
        const newModelContent = injectConstraints(currentModel.content, constraintLines);

        // Re-validate immediately before the write — the model may have drifted since approval.
        const products = await Container.get(LineService).findProductsByLineId({
          id: proposal.target.lineId, userId: ctx.userId, specFromRepo: true, cutOnInfra: true,
        });
        const { valid, broken } = validateModelAgainstProducts({
          modelContent: newModelContent,
          type: 'UVL',
          products,
        });
        if (!valid) {
          const names = broken.map((b) => b.name).join(', ');
          throw new Error(
            `Pre-write validation failed: the approved constraint patch now breaks ` +
              `${broken.length} product(s): ${names}. ` +
              'Reject and re-run after reviewing the feature model.'
          );
        }

        const mr = await openLineHarvestMr({
          lineProjectId,
          lineId: ctx.lineId,
          userId: ctx.userId,
          modelPath: currentModel.path,
          newModelContent,
          featureName: `constraints (${constraintLines.length})`,
          planMarkdown: proposal.body.markdown,
          fileEdits: [],
          dryRun: dry,
        });

        if (!dry) invalidateFmCache(ctx.lineId);

        return {
          output: { opened: !dry, dryRun: dry, mrUrl: mr.mrUrl ?? null, branch: mr.branch },
          result: {
            opened: !dry,
            dryRun: dry,
            constraintsAdded: constraintLines.length,
            mrUrl: mr.mrUrl ?? null,
            ...(dry ? { dryRunPayload: mr } : {}),
          },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
