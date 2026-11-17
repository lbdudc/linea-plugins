import { Container } from 'typedi';
import { normalizeProductSpec } from '../../linea/featureModel.js';
import ProductRepository from '../../model/repositories/ProductRepository.js';
import ProductSpecService from '../../model/services/ProductSpecService.js';
import AgentPolicyRepository from '../models/AgentPolicyRepository.js';
import { mergePolicy } from '../models/AgentPolicy.js';
import { classifyFmEdit } from '../tools/fmEditClass.js';
import { productAccess, branches } from '../tools/git.js';
import { compareBranches } from '../../linea/repo.js';

/**
 * FamilyImpactPlanner — the deterministic heart of Phase 1.
 *
 * Given a current + proposed feature model and the full live product portfolio,
 * it produces a FamilyImpactPlan: one row per product, each with an action
 * (migrate | regen | skip), a likely-conflict flag, and a criticality marker.
 *
 * Three signals compose the plan:
 *
 *   1. Thüm edit class (fmEditClass) — overall shape of the blast
 *   2. completeFeatureSelection on both models (evolution.js classifyImpact) —
 *      exact breaking/fixing partition for every product
 *   3. Branch-SHA drift per product (compareBranches bigbang→main) — whether
 *      a product has manual edits that will conflict with the incoming regen
 *
 * Every signal is deterministic; no LLM is involved here. The plan is what the
 * human approves in Phase 2, so it must be fully derivable without inference.
 *
 * Cascade action vocabulary:
 *   migrate — product spec invalid on the proposed FM → spawn evolution (migration)
 *   regen   — spec stays valid but the FM/platform changed → spawn regen
 *             (regen auto-spawns sync on conflict, which is the existing behaviour)
 *   skip    — refactoring + no drift → nothing needed for this product
 *
 * The `likely_conflict` flag (true when the product has main>bigbang drift) is
 * metadata for the human plan review only — it doesn't change the cascade action.
 */

const CHUNK_SIZE = 5;   // max parallel git host calls per batch
const ACTION_ORDER = { migrate: 0, regen: 1, skip: 2 };

// Enumerate every feature name reachable from the FM root.
const getAllFeatureNames = (node) => {
  const names = new Set();
  const traverse = (n) => {
    if (!n) return;
    if (n.name) names.add(n.name);
    for (const child of n.features ?? []) traverse(child);
  };
  traverse(node);
  return names;
};

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

class FamilyImpactPlanner {
  productRepository    = Container.get(ProductRepository);
  agentPolicyRepository = Container.get(AgentPolicyRepository);

  /**
   * Build the full family impact plan for a proposed FM change.
   *
   * @param {object} opts
   * @param {string}      opts.lineId
   * @param {string}      opts.userId         — triggers permission-checked git host reads
   * @param {object}      opts.line           — Line Mongoose doc (from loadFeatureModel)
   * @param {FeatureModel} opts.currentModel
   * @param {FeatureModel} opts.proposedModel
   * @param {string}      opts.proposedModelStr — raw UVL/XML of the proposed model
   * @param {string}      opts.origin
   * @returns {Promise<FamilyImpactPlan>}
   */
  plan = async ({ lineId, userId, line, currentModel, proposedModel, proposedModelStr, origin }) => {
    const all = await this.productRepository.findByLineId(lineId);
    const products = all.filter((p) => !p.archived);

    // ── Signal 2: branch-SHA drift per product (lightweight conflict predict) ──
    const driftMap = await this.#checkDriftAndReadSpecs({ products, userId });

    // ── Signal 1: Thüm classification + breaking/fixing partition ─────────────
    const { editClass, breaking, fixing } = classifyFmEdit({ currentModel, proposedModel, products });
    const breakingIds = new Set(breaking.map((v) => v.productId));

    // ── Signal 3: per-product criticality policy ───────────────────────────────
    const policies = await this.#loadPolicies(lineId, products);

    // ── Build cascade entries ─────────────────────────────────────────────────
    const cascade = products.map((product) => {
      const productId   = String(product._id);
      const name        = product.spec?.basicData?.name ?? productId;
      const isCritical  = policies[productId]?.criticality === 'critical';
      const hasDrift    = driftMap[productId] ?? false;

      let action;
      if (breakingIds.has(productId)) {
        // Spec invalid on proposed model → must migrate before regen.
        action = 'migrate';
      } else if (editClass === 'refactoring' && !hasDrift) {
        // Pure refactoring AND no manual edits → nothing needed.
        action = 'skip';
      } else {
        // FM changed (generalization / specialization / arbitrary) OR product has
        // drift → regen it. The regen agent auto-spawns sync on conflict.
        action = 'regen';
      }

      // Find this product's verdict for the plan display
      const breakVerdict = breaking.find((v) => v.productId === productId);
      const fixVerdict   = fixing.find((v) => v.productId === productId);

      return {
        productId,
        name,
        version:         product.spec?.basicData?.version ?? '?',
        action,
        likely_conflict: hasDrift && action !== 'migrate',
        isCritical,
        impact: breakVerdict?.impact ?? fixVerdict?.impact ?? 'unaffected_valid',
      };
    });

    // Sort: migrate first (most urgent), then regen (by criticality, then drift),
    // then skip. Critical products float to the top within each group.
    cascade.sort((a, b) => {
      const orderDiff = ACTION_ORDER[a.action] - ACTION_ORDER[b.action];
      if (orderDiff !== 0) return orderDiff;
      // Within group: critical first, then likely-conflict (needs human attention)
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      if (a.likely_conflict !== b.likely_conflict) return a.likely_conflict ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const stats = {
      total:          cascade.length,
      migrate:        cascade.filter((c) => c.action === 'migrate').length,
      regen:          cascade.filter((c) => c.action === 'regen').length,
      likelyConflict: cascade.filter((c) => c.likely_conflict).length,
      skip:           cascade.filter((c) => c.action === 'skip').length,
      critical:       cascade.filter((c) => c.isCritical).length,
      breaking:       breaking.length,
      fixing:         fixing.length,
    };

    // FM feature diff — used by the sandbox-test step for 1-wise interaction testing.
    const currentNames  = getAllFeatureNames(currentModel);
    const proposedNames = getAllFeatureNames(proposedModel);
    const newFeatures     = [...proposedNames].filter((n) => !currentNames.has(n));
    const removedFeatures = [...currentNames].filter((n) => !proposedNames.has(n));

    return {
      editClass,
      proposedModelStr,
      origin,
      line: { id: String(line._id), name: line.name },
      cascade,
      stats,
      newFeatures,
      removedFeatures,
    };
  };

  // ── private ──────────────────────────────────────────────────────────────────

  /**
   * Lightweight drift check (compare `main` vs `bigbang` for each product) plus
   * reading `.linea/spec.json`, fused into the same per-product pass. Batches
   * CHUNK_SIZE parallel git host calls to stay within the 30s step timeout for
   * lines with many products. Best-effort: any failure → assume no drift (safe
   * side: the regen still runs and the sync agent auto-handles the conflict).
   * Reading the spec is best-effort here too: `plan` is a read-only preview a human
   * approves before anything writes, so no `cutOnInfra`.
   */
  async #checkDriftAndReadSpecs({ products, userId }) {
    const results = {};
    const chunks = chunkArray(products, CHUNK_SIZE);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (product) => {
          const productId = String(product._id);
          let projectId;
          try {
            ({ projectId } = await productAccess({ productId, userId }));
          } catch {
            results[productId] = false;
            return;
          }

          const [driftOutcome, specOutcome] = await Promise.allSettled([
            // from=bigbang (base), to=main (default): commits in main not in bigbang
            compareBranches({ id: projectId, userId, from: branches.base, to: branches.default }),
            Container.get(ProductSpecService).getSpecFromHostOrCache({
              userId, productProjectId: projectId, fallbackSpec: product.spec,
              context: `FamilyImpactPlanner#plan: product ${productId}`,
            }),
          ]);

          if (driftOutcome.status === 'fulfilled') {
            // `.linea/**` es metadato nuestro, no cambio del producto (ADR-033)
            const realDiffs = (driftOutcome.value?.files ?? []).filter((d) => !d.newPath?.startsWith('.linea/'));
            results[productId] = realDiffs.length > 0;
          } else {
            results[productId] = false;
          }

          if (specOutcome.status === 'fulfilled') {
            const { spec, source } = specOutcome.value;
            product.spec = source === 'repo' ? normalizeProductSpec({ spec }) : spec;
          }
        })
      );
    }

    return results;
  }

  /**
   * Load per-product criticality from AgentPolicy. Cached nowhere — policy reads
   * are fast (indexed Mongo queries) and must reflect the current state.
   *
   * The line-level policy document is the same for every product on this line,
   * so it's fetched once here instead of via `resolveEffective` per product
   * (which re-queried it N times for N products).
   */
  async #loadPolicies(lineId, products) {
    let line = null;
    try {
      line = await this.agentPolicyRepository.findOneByScope({ lineId: String(lineId) });
    } catch { /* fall through with line = null; mergePolicy treats that as "no override" */ }

    const policies = {};
    await Promise.all(
      products.map(async (product) => {
        const productId = String(product._id);
        try {
          const productPolicy = await this.agentPolicyRepository.findOneByScope({
            lineId: String(lineId),
            productId,
          });
          policies[productId] = mergePolicy(productPolicy, line);
        } catch {
          policies[productId] = { criticality: 'normal', modes: {} };
        }
      })
    );
    return policies;
  }
}

Container.set(FamilyImpactPlanner, new FamilyImpactPlanner());

export default FamilyImpactPlanner;
