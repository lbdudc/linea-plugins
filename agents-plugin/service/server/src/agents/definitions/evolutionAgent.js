import { Container } from 'typedi';
import { parseFeatureModel } from '../../linea/featureModel.js';
import { registerAgent } from '../core/AgentRegistry.js';
import { complete } from '../core/llm.js';
import { scanProducts, loadFeatureModel } from '../tools/splContext.js';
import { validateSpecPatch, applySpecPatch, classifyImpact } from '../tools/evolution.js';
import LineService from '../../model/services/LineService.js';

/**
 * Evolution agent — feature-model change safety. Two modes:
 *
 * - migration (default): products invalid under the CURRENT model → propose +
 *   apply minimal spec fixes (turns the analyzer into a remediation tool).
 * - impact: given a PROPOSED model (input.proposedModelUvl), preview which
 *   products would break vs. be fixed, and propose fixes — read-only, run BEFORE
 *   saving the model. (Fixes aren't applied here: they'd be invalid until the new
 *   model is saved.)
 *
 * Deterministic core: completeFeatureSelection re-validates every proposed patch.
 */
const SYSTEM_PROMPT = `You are an expert Software Product Line migration assistant.
Some products have a feature selection that is not valid under the target feature model.
For each, propose the MINIMAL change to its feature selection that makes it valid.
- Only use feature names that appear exactly in the model. Never invent features.
- Return the COMPLETE intended feature list per product (not a diff).
Call propose_spec_patches with one entry per product you can fix.`;

const PROPOSE_TOOL = {
  name: 'propose_spec_patches',
  description: 'Propose corrected feature selections for the listed products.',
  input_schema: {
    type: 'object',
    properties: {
      patches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            name: { type: 'string' },
            features: { type: 'array', items: { type: 'string' } },
            rationale: { type: 'string' },
          },
          required: ['productId', 'features', 'rationale'],
        },
      },
    },
    required: ['patches'],
  },
};

const isImpact = (ctx) => ctx.input?.mode === 'impact';
const isDryRun = (ctx) => Boolean(ctx.input?.dryRun);

// The model proposed selections are validated against (current vs proposed).
const targetModel = async (ctx) => {
  if (isImpact(ctx)) {
    return parseFeatureModel({ content: ctx.getStepOutput('scan').proposedModelUvl, type: 'UVL' });
  }
  return (await loadFeatureModel({ lineId: ctx.lineId, userId: ctx.userId })).model;
};

const definition = {
  type: 'evolution',
  title: 'Evolution Agent',
  description:
    'Finds products invalidated by a feature model (current or a proposed change), and proposes (and in migration mode applies) minimal spec fixes.',
  scope: 'line',

  steps: [
    {
      name: 'scan',
      kind: 'deterministic',
      run: async (ctx) => {
        if (!ctx.lineId) throw new Error('evolution agent requires scope.lineId');

        if (!isImpact(ctx)) {
          const scan = await scanProducts({ lineId: ctx.lineId, userId: ctx.userId });
          return { output: { mode: 'migration', ...scan } };
        }

        const proposedModelUvl = ctx.input?.proposedModelUvl;
        if (!proposedModelUvl) throw new Error('impact mode requires input.proposedModelUvl');
        const { line, model: currentModel } = await loadFeatureModel({ lineId: ctx.lineId, userId: ctx.userId });
        const proposedModel = parseFeatureModel({ content: proposedModelUvl, type: 'UVL' });
        const products = await Container.get(LineService).findProductsByLineId({
          id: ctx.lineId, userId: ctx.userId, specFromRepo: true,
        });
        const verdicts = classifyImpact({ currentModel, proposedModel, products });
        const summary = {
          total: verdicts.length,
          breaking: verdicts.filter((v) => v.impact === 'breaking').length,
          fixing: verdicts.filter((v) => v.impact === 'fixing').length,
        };
        return { output: { mode: 'impact', line: { id: String(line._id), name: line.name }, summary, verdicts, proposedModelUvl } };
      },
    },

    {
      name: 'propose-fixes',
      kind: 'llm',
      run: async (ctx) => {
        const scan = ctx.getStepOutput('scan');
        const broken = isImpact(ctx)
          ? scan.verdicts.filter((v) => v.impact === 'breaking')
          : scan.verdicts.filter((v) => v.status === 'invalid');
        if (broken.length === 0) return { output: { patches: [], nothingToFix: true } };

        const model = await targetModel(ctx);
        const modelStr = model.toString();
        const list = broken
          .map(
            (v) =>
              `### ${v.name} (id ${v.productId})\n- Current features: ${v.features?.join(', ') || '(none)'}`
          )
          .join('\n\n');

        const { toolUses } = await complete({
          system: SYSTEM_PROMPT,
          tools: [PROPOSE_TOOL],
          messages: [
            {
              role: 'user',
              content: `## Target feature model\n\`\`\`\n${modelStr}\n\`\`\`\n\n## Products to fix\n${list}\n\nPropose minimal fixes.`,
            },
          ],
          memories: ctx.memories, instructions: ctx.instructions,
        });
        const call = toolUses.find((t) => t.name === 'propose_spec_patches');
        return { output: { patches: call?.input?.patches ?? [] } };
      },
    },

    {
      name: 'validate-fixes',
      kind: 'deterministic',
      run: async (ctx) => {
        const { patches } = ctx.getStepOutput('propose-fixes');
        if (!patches.length) return { output: { validated: [] } };

        const model = await targetModel(ctx);
        const validated = patches.map((p) => {
          const { valid, reason } = validateSpecPatch({ model, features: p.features });
          return {
            productId: p.productId,
            name: p.name ?? p.productId,
            features: p.features,
            rationale: p.rationale,
            valid,
            invalidReason: valid ? null : reason,
          };
        });
        return { output: { validated } };
      },
    },

    {
      name: 'propose-apply',
      kind: 'approval',
      run: async (ctx) => {
        const scan = ctx.getStepOutput('scan');
        const { validated } = ctx.getStepOutput('validate-fixes');
        const applicable = validated.filter((v) => v.valid);

        // Impact mode is a read-only preview — never applies (the proposed model
        // isn't saved yet). Emit the analysis + advisory fixes as the result.
        if (isImpact(ctx)) {
          const fixesList = applicable.length
            ? applicable.map((v) => `- **${v.name}** → ${v.features.join(', ')} (${v.rationale})`).join('\n')
            : '_No automatic fixes proposed._';
          const breaking = scan.verdicts.filter((v) => v.impact === 'breaking');
          const fixing = scan.verdicts.filter((v) => v.impact === 'fixing');
          const markdown =
            `## Impact of the proposed model\n` +
            `- Breaking: ${breaking.length}${breaking.length ? ` (${breaking.map((b) => b.name).join(', ')})` : ''}\n` +
            `- Fixing: ${fixing.length}${fixing.length ? ` (${fixing.map((f) => f.name).join(', ')})` : ''}\n\n` +
            `## Suggested fixes (apply after saving the model)\n${fixesList}`;
          return {
            output: { mode: 'impact', applicable: applicable.length },
            result: { mode: 'impact', summary: scan.summary, verdicts: scan.verdicts, fixes: applicable, markdown },
          };
        }

        if (applicable.length === 0) {
          return { output: { applicable: 0 }, result: { fixed: 0, note: 'No applicable, validated fixes.' } };
        }

        const markdown =
          `## Proposed fixes (${applicable.length})\n` +
          applicable
            .map((v) => `### ${v.name}\n- New features: ${v.features.join(', ')}\n- ${v.rationale}\n- ✅ validated`)
            .join('\n\n');

        return {
          output: { proposed: applicable.length },
          proposal: {
            kind: 'spec_patch',
            blastRadius: 'product',
            target: { productIds: applicable.map((v) => v.productId) },
            body: { title: `Apply ${applicable.length} migration fix(es)`, patches: applicable, markdown },
          },
        };
      },
    },

    {
      name: 'apply-fixes',
      kind: 'deterministic',
      run: async (ctx) => {
        if (isImpact(ctx)) return { output: { applied: 0, skipped: 'impact-preview' } };

        const proposal = ctx
          .getProposals()
          .find((p) => p.kind === 'spec_patch' && (p.decision === 'approved' || p.decision === 'auto'));
        if (!proposal) return { output: { applied: 0 } };

        // dryRun: re-validate each patch without applying.
        if (isDryRun(ctx)) {
          const { model } = await loadFeatureModel({ lineId: ctx.lineId, userId: ctx.userId });
          const dryResults = proposal.body.patches.map((p) => {
            const { valid, reason } = validateSpecPatch({ model, features: p.features });
            return { productId: p.productId, name: p.name, valid, reason: valid ? null : reason };
          });
          return {
            output: { dryRun: true, validated: dryResults.length },
            result: { dryRun: true, patches: dryResults },
          };
        }

        const results = [];
        for (const patch of proposal.body.patches) {
          try {
            await applySpecPatch({ productId: patch.productId, features: patch.features, userId: ctx.userId });
            results.push({ productId: patch.productId, name: patch.name, applied: true });
          } catch (err) {
            results.push({ productId: patch.productId, name: patch.name, applied: false, error: err?.message ?? String(err) });
          }
        }
        const applied = results.filter((r) => r.applied).length;
        return { output: { applied }, result: { fixed: applied, results } };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
