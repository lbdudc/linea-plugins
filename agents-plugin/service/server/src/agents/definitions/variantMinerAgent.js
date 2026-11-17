import { registerAgent } from '../core/AgentRegistry.js';
import { complete } from '../core/llm.js';
import { scanProducts } from '../tools/splContext.js';
import { productAccess } from '../tools/git.js';
import { detectProductChanges, classifyChangeSignals } from '../tools/harvest.js';
import { mineCandidates } from '../tools/variantMiner.js';

/**
 * Variant Divergence Miner — the portfolio-level aggregator above the per-product
 * Harvest detector.
 *
 * Where the Harvest agent looks at ONE product's drift, the miner runs the same
 * deterministic detection + classification across EVERY product in a line and
 * clusters the divergences. The same change touching the same files across many
 * products is the strongest signal that it belongs in the platform (Rubin &
 * Chechik, *managing cloned variants*).
 *
 * Read-only: it never opens an MR. It produces a ranked "candidate harvests"
 * report that feeds the Harvest agent (a human picks a candidate → runs Harvest
 * on the representative product). Scheduler-capable like line-health.
 */

const MAX_PRODUCTS = 40;
const MAX_FILES_PER_PRODUCT = 40;

const SYSTEM_PROMPT = `You are an SPL harvest analyst. You are given candidate divergences mined across all products of a Software Product Line: groups of products that independently made similar direct changes to generator-owned files.

Write a concise markdown report titled "## Candidate Harvests" that, for each candidate (most corroborated first):
- States the suggested change type (new-optional-feature / extend-existing-feature / bugfix-to-generated) and why.
- Names how many products show it (N of M) and lists them.
- Recommends whether to harvest it, and on which representative product to run the Harvest agent first.

End with a one-line "## Recommendation" naming the single highest-value candidate to harvest now. If there are no multi-product (corroborated) candidates, say so plainly. Be specific; name exact file paths and product names.`;

const definition = {
  type: 'variant-miner',
  title: 'Variant Divergence Miner',
  description:
    'Scans every product in a line for direct changes, clusters the same divergence across products, and ranks candidate harvests. Read-only; feeds the Harvest agent. Scheduler-capable.',
  scope: 'line',

  steps: [
    {
      name: 'load-context',
      kind: 'deterministic',
      run: async (ctx) => {
        if (!ctx.lineId) throw new Error('variant-miner requires scope.lineId');
        const scan = await scanProducts({ lineId: ctx.lineId, userId: ctx.userId });
        return {
          output: {
            line: scan.line,
            totalProducts: scan.summary.total,
            products: scan.verdicts.map((v) => ({ productId: v.productId, name: v.name })),
          },
        };
      },
    },

    {
      name: 'detect-per-product',
      kind: 'git',
      run: async (ctx) => {
        const { products } = ctx.getStepOutput('load-context');
        const divergences = [];
        const errors = [];

        for (const p of products.slice(0, MAX_PRODUCTS)) {
          try {
            const { projectId } = await productAccess({
              productId: p.productId,
              userId: ctx.userId,
              });
            const changes = await detectProductChanges({ projectId });
            if (!changes.files.length) continue;
            const signals = classifyChangeSignals({ files: changes.files, commits: changes.commits });
            divergences.push({
              productId: p.productId,
              name: p.name,
              fileCount: changes.files.length,
              suggestedType: signals.suggestedType,
              generatorOwnedPaths: signals.generatorOwnedPaths.slice(0, MAX_FILES_PER_PRODUCT),
              customizationPaths: signals.customizationPaths.slice(0, MAX_FILES_PER_PRODUCT),
              fixHint: signals.fixHint,
            });
          } catch (err) {
            errors.push({ name: p.name, error: err?.message ?? String(err) });
          }
        }

        return {
          output: {
            productsWithChanges: divergences.length,
            divergences,
            errors,
          },
        };
      },
    },

    {
      name: 'aggregate',
      kind: 'deterministic',
      run: async (ctx) => {
        const { totalProducts } = ctx.getStepOutput('load-context');
        const { divergences } = ctx.getStepOutput('detect-per-product');
        const candidates = mineCandidates(divergences, totalProducts);
        return {
          output: {
            candidateCount: candidates.length,
            corroboratedCount: candidates.filter((c) => c.corroborated).length,
            candidates,
          },
        };
      },
    },

    {
      name: 'narrate',
      kind: 'llm',
      run: async (ctx) => {
        const { line, totalProducts } = ctx.getStepOutput('load-context');
        const detect = ctx.getStepOutput('detect-per-product');
        const agg = ctx.getStepOutput('aggregate');
        const candidates = agg.candidates ?? [];

        if (!candidates.length) {
          const markdown =
            `## Candidate Harvests\n\nNo harvestable divergences found across the ${totalProducts} product(s) of **${line.name}**.` +
            (detect.productsWithChanges
              ? ` ${detect.productsWithChanges} product(s) had direct changes, but only in customization points (product-local).`
              : ' No products have direct changes beyond their generated baseline.');
          return {
            output: { markdown, candidateCount: 0 },
            result: {
              lineName: line.name,
              totalProducts,
              productsWithChanges: detect.productsWithChanges,
              candidateCount: 0,
              candidates: [],
              markdown,
            },
          };
        }

        const candidateBlock = candidates
          .map((c, i) => {
            const tag = c.corroborated ? `corroborated x${c.productCount}` : 'single product';
            return (
              `${i + 1}. [${tag}] type=${c.suggestedType}\n` +
              `   files: ${c.files.join(', ')}\n` +
              `   products (${c.productCount}/${c.totalProducts}): ${c.products.join(', ')}\n` +
              `   representative: ${c.representativeProductName ?? '(n/a)'}`
            );
          })
          .join('\n');

        const { text } = await complete({
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content:
                `## SPL: ${line.name}\n` +
                `Products: ${totalProducts} total, ${detect.productsWithChanges} with direct changes.\n\n` +
                `## Candidate divergences (clustered by shared generator-owned files)\n${candidateBlock}\n\n` +
                `Write the Candidate Harvests report.`,
            },
          ],
          memories: ctx.memories, instructions: ctx.instructions,
        });

        return {
          output: { markdown: text, candidateCount: candidates.length },
          result: {
            lineName: line.name,
            totalProducts,
            productsWithChanges: detect.productsWithChanges,
            candidateCount: candidates.length,
            corroboratedCount: agg.corroboratedCount,
            candidates,
            markdown: text,
          },
        };
      },
    },
  ],
};

registerAgent(definition);

export default definition;
