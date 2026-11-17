import { Container } from 'typedi';
import { validateFeatureSelection } from '../../linea/featureModel.js';
import { registerAgent } from '../core/AgentRegistry.js';
import { complete } from '../core/llm.js';
import { loadFeatureModel, scanProducts } from '../tools/splContext.js';
import {
  extractFeaturesFromModel,
  computeMandatoryFeatures,
  computePortfolioAnomalies,
  computePairCoverage,
} from '../tools/fmAnalysis.js';
import { productAntiPatterns } from '../tools/steward.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';

/**
 * Line Health — unified read-only health report for an SPL.
 *
 * Merges the former Steward, FM Health, Coverage Analysis, and SPL Health Snapshot
 * agents into a single run. All four concerns are now sections of one report:
 *
 *   Product validity    — which products are invalid under the current FM
 *   FM structure        — void model, non-selectable features, mandatory features
 *   Portfolio anomalies — stranded, zombie-optional, coupling smells
 *   Coverage            — 1-wise and 2-wise feature coverage + risky uncovered pairs
 *   Git anti-patterns — conflicting MRs and stale generation branches
 *
 * The scheduler (triggers/scheduler.js) can enqueue this agent periodically via
 * HEALTH_INTERVAL_MS. No writes, no approval gate.
 */

const SYSTEM_PROMPT = `You are an SPL health analyst producing a unified health report for a Software Product Line.
Given deterministic analysis results, write a concise markdown report using these sections:

## Health Summary
One sentence: overall RAG status (Healthy / Minor issues / Needs attention / Critical) and the single most important finding.

## Product Validity
Current product valid/invalid breakdown. List any invalid products with their reason.

## Feature Model Structure
Void model status, non-selectable features, mandatory features.
Mark CRITICAL for void model or non-selectable features; AMBER for other anomalies.

## Portfolio Anomalies
Stranded features (in FM but never selected), zombie optionals (always selected despite being optional),
coupling smells (always co-selected pairs). Name exact feature identifiers. Omit if none.

## Coverage
1-wise and 2-wise percentages. Top risky uncovered pairs. Suggest 1–3 new products/configs to close the gaps.

## Git Anti-patterns
Conflicting MRs or stale generation branches per product. Omit if none.

Be specific. Name exact feature identifiers and product names.`;

function probeNonMandatoryFeatures({ model, features }) {
  const nonSelectable = [];
  for (const f of features) {
    const { valid, error } = validateFeatureSelection({ model, features: [f] });
    if (!valid) nonSelectable.push({ feature: f, reason: error });
  }
  return nonSelectable;
}

const definition = {
  type: 'line-health',
  title: 'Line Health',
  description:
    'Unified health report: product validity, FM structural anomalies (void, non-selectable, stranded, zombie, coupling), 1-wise/2-wise coverage, and Git anti-patterns. Read-only. Scheduler-capable.',
  scope: 'line',

  steps: [
    {
      name: 'load-context',
      kind: 'deterministic',
      run: async (ctx) => {
        if (!ctx.lineId) throw new Error('line-health requires scope.lineId');
        const { line, modelStr, type } = await loadFeatureModel({
          lineId: ctx.lineId,
          userId: ctx.userId,
        });
        const scan = await scanProducts({ lineId: ctx.lineId, userId: ctx.userId });
        const allFmFeatures = extractFeaturesFromModel({ modelStr, type });
        return {
          output: {
            line: { id: String(line._id), name: line.name },
            allFmFeatures,
            modelStr,
            type,
            summary: scan.summary,
            verdicts: scan.verdicts,
          },
        };
      },
    },

    {
      name: 'analyse',
      kind: 'deterministic',
      run: async (ctx) => {
        const { allFmFeatures, verdicts } = ctx.getStepOutput('load-context');

        const { model } = await loadFeatureModel({ lineId: ctx.lineId, userId: ctx.userId });
        const { voidModel, mandatory } = computeMandatoryFeatures({ model });
        const mandatorySet = new Set(mandatory);

        const nonMandatory = allFmFeatures.filter((f) => !mandatorySet.has(f));
        const nonSelectable = voidModel
          ? []
          : probeNonMandatoryFeatures({ model, features: nonMandatory });

        const validVerdicts = verdicts.filter((v) => v.status === 'valid');
        const { stranded, zombieOptionals, couplingSmells, selectedFeatures } =
          computePortfolioAnomalies({ allFmFeatures, validVerdicts, mandatory });

        // 1-wise
        const covered1Wise = allFmFeatures.filter((f) => selectedFeatures.has(f)).length;
        const pct1 =
          allFmFeatures.length > 0
            ? Math.round((covered1Wise / allFmFeatures.length) * 100)
            : 100;

        // 2-wise
        const productFeatureSets = validVerdicts.map((v) => new Set(v.features));
        const { coveredPairs, totalPairs } = computePairCoverage(allFmFeatures, productFeatureSets);
        const pct2 = totalPairs > 0 ? Math.round((coveredPairs.size / totalPairs) * 100) : 100;

        // Risky uncovered pairs (both features used, never tested together), top 15
        const freq = {};
        for (const v of validVerdicts) for (const f of v.features) freq[f] = (freq[f] || 0) + 1;
        const usedFeatures = allFmFeatures.filter((f) => selectedFeatures.has(f));
        const risky = [];
        for (let i = 0; i < usedFeatures.length; i++) {
          for (let j = i + 1; j < usedFeatures.length; j++) {
            const key = [usedFeatures[i], usedFeatures[j]].sort().join('\x00');
            if (!coveredPairs.has(key)) risky.push([usedFeatures[i], usedFeatures[j]]);
          }
        }
        risky.sort(
          ([a1, b1], [a2, b2]) =>
            (freq[a2] || 0) + (freq[b2] || 0) - ((freq[a1] || 0) + (freq[b1] || 0))
        );

        return {
          output: {
            voidModel,
            mandatory,
            nonSelectable,
            stranded,
            zombieOptionals,
            couplingSmells,
            coverage1Wise: pct1,
            coverage2Wise: pct2,
            covered1Wise,
            total1Wise: allFmFeatures.length,
            coveredPairsCount: coveredPairs.size,
            totalPairsCount: totalPairs,
            riskyUncoveredPairs: risky.slice(0, 15),
          },
        };
      },
    },

    {
      name: 'scan-anti-patterns',
      kind: 'git',
      run: async (ctx) => {
        const products = await Container.get(ProductRepository).findByLineId(ctx.lineId);
        const results = [];
        for (const product of products) {
          results.push(await productAntiPatterns({ userId: ctx.userId, product }));
        }
        const flagged = results.filter((r) => r.issues.length > 0);
        return { output: { checked: results.length, flagged } };
      },
    },

    {
      name: 'narrate',
      kind: 'llm',
      run: async (ctx) => {
        const { line, allFmFeatures, summary, verdicts } = ctx.getStepOutput('load-context');
        const a = ctx.getStepOutput('analyse');
        const anti = ctx.getStepOutput('scan-anti-patterns');

        const fmt = (arr, empty = '(none)') => (arr.length > 0 ? arr.join(', ') : empty);
        const fmtPairs = (pairs) =>
          pairs.length > 0 ? pairs.map(([x, y]) => `(${x}, ${y})`).join('; ') : '(none)';

        const nsBlock =
          a.nonSelectable.length > 0
            ? a.nonSelectable.map((r) => `  - ${r.feature}: ${r.reason}`).join('\n')
            : '  (none)';

        const invalid = verdicts.filter((v) => v.status === 'invalid');
        const invalidList = invalid.length
          ? invalid.map((v) => `- ${v.name} (v${v.version}): ${v.reason}`).join('\n')
          : '(none)';

        const antiBlock = anti.flagged.length
          ? anti.flagged.map((f) => `- ${f.name}: ${f.issues.join('; ')}`).join('\n')
          : '(none)';

        const { text } = await complete({
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content:
                `## SPL: ${line.name}\n` +
                `FM features (${allFmFeatures.length}): ${fmt(allFmFeatures)}\n` +
                `Products: ${summary.total} total, ${summary.valid} valid, ${summary.invalid} invalid\n\n` +
                `## Product Validity\nInvalid products:\n${invalidList}\n\n` +
                `## FM Structure\n` +
                `Void model: ${a.voidModel ? 'YES — CRITICAL' : 'no'}\n` +
                `Mandatory features: ${fmt(a.mandatory)}\n` +
                `Non-selectable features:\n${nsBlock}\n\n` +
                `## Portfolio Anomalies\n` +
                `Stranded (in FM, no product selects): ${fmt(a.stranded)}\n` +
                `Zombie optionals (optional in FM, every product selects): ${fmt(a.zombieOptionals)}\n` +
                `Coupling smells (always co-selected pairs): ${fmtPairs(a.couplingSmells)}\n\n` +
                `## Coverage\n` +
                `1-wise: ${a.coverage1Wise}% (${a.covered1Wise}/${a.total1Wise})\n` +
                `2-wise: ${a.coverage2Wise}% (${a.coveredPairsCount}/${a.totalPairsCount} pairs)\n` +
                `Risky uncovered pairs (top 15): ${fmtPairs(a.riskyUncoveredPairs)}\n\n` +
                `## Git Anti-patterns\n${antiBlock}\n\n` +
                `Write the health report.`,
            },
          ],
          memories: ctx.memories, instructions: ctx.instructions,
        });

        const criticalCount = (a.voidModel ? 1 : 0) + a.nonSelectable.length + summary.invalid;
        const amberCount =
          a.stranded.length + a.zombieOptionals.length + a.couplingSmells.length + anti.flagged.length;

        return {
          output: { markdown: text },
          result: {
            lineName: line.name,
            summary,
            criticalIssues: criticalCount,
            amberIssues: amberCount,
            coverage1Wise: `${a.coverage1Wise}%`,
            coverage2Wise: `${a.coverage2Wise}%`,
            antiPatternsFlagged: anti.flagged.length,
            markdown: text,
          },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
