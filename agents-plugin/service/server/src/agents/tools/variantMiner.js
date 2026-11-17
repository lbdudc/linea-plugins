/**
 * Deterministic core of the Variant Divergence Miner.
 *
 * The strongest "this should be generalized" signal in an SPL is the SAME
 * divergence appearing independently across products (Rubin & Chechik, *managing
 * cloned variants*). These pure helpers cluster per-product divergences by the
 * set of generator-owned files they touch and rank the resulting candidate
 * harvests. No LLM or git host calls — fully unit-testable.
 */

import { createHash } from 'node:crypto';

/**
 * A stable identity for a candidate, derived from the set of generator-owned files
 * it touches: sha1 of the sorted, de-duplicated path list. Lets a server-side
 * disposition (dismiss / manually-harvested / snooze) match the same candidate
 * across fresh miner re-scans even though candidates are never persisted.
 *
 * Tradeoff: the signature is content-based on the file SET, not the divergence's
 * diffs. If a divergence's touched files materially change, it becomes a NEW
 * candidate and a prior dismissal no longer suppresses it — intentional, so a
 * meaningfully different change resurfaces for triage.
 */
export const candidateSignature = (paths = []) =>
  createHash('sha1').update([...new Set(paths)].sort().join('|')).digest('hex');

const jaccard = (a, b) => {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
};

// Files whose change ripples far beyond a single feature: build/dependency/CI/config.
// Harvesting one of these into the platform is higher-stakes than a localized code
// change, so we flag it for the operator before launch.
const HIGH_TOUCH = [
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Dockerfile$/i,
  /(^|\/)docker-compose\.ya?ml$/,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
  /(^|\/)Makefile$/,
  /\.config\.[cm]?js$/, // *.config.js / .cjs / .mjs (webpack/vite/quasar/babel/…)
  /(^|\/)tsconfig[^/]*\.json$/,
];

const isHighTouch = (p) => HIGH_TOUCH.some((re) => re.test(p));

/**
 * Deterministic risk assessment for a candidate harvest.
 * - `highTouch`: the candidate's files that hit build/dependency/CI/config surfaces.
 * - `sharedWith`: how many OTHER clusters touch at least one of the same files
 *   (a blast-radius hint — a shared file means harvesting here likely affects them).
 * - `level`: high if any high-touch file; medium if it overlaps another cluster;
 *   else low.
 */
const computeRisk = (paths, sharedWith) => {
  const highTouch = (paths ?? []).filter(isHighTouch);
  let level = 'low';
  if (highTouch.length) level = 'high';
  else if (sharedWith >= 1) level = 'medium';
  return { level, highTouch, sharedWith };
};

const majority = (values) => {
  const counts = {};
  let best = null;
  let bestN = 0;
  for (const v of values) {
    counts[v] = (counts[v] ?? 0) + 1;
    if (counts[v] > bestN) {
      bestN = counts[v];
      best = v;
    }
  }
  return best;
};

/**
 * Greedily cluster per-product divergences by file-path overlap. A divergence is
 * `{ productId, name, suggestedType, generatorOwnedPaths, fileCount, ... }`.
 * Products whose changes are all customization points (no generator-owned paths)
 * are not harvest candidates and are skipped here.
 *
 * @returns clusters of `{ paths: string[], members: divergence[] }`
 */
export const clusterDivergences = (divergences, { threshold = 0.4 } = {}) => {
  const clusters = [];
  for (const d of divergences) {
    const paths = d.generatorOwnedPaths ?? [];
    if (!paths.length) continue; // product-local only — not a harvest candidate

    let best = null;
    let bestScore = 0;
    for (const c of clusters) {
      const score = jaccard(paths, c.paths);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (best && bestScore >= threshold) {
      best.members.push(d);
      best.paths = Array.from(new Set([...best.paths, ...paths]));
    } else {
      clusters.push({ paths: [...paths], members: [d] });
    }
  }
  return clusters;
};

/**
 * Turn clusters into ranked candidate harvests. Multi-product clusters
 * (corroborated across the portfolio) rank first; within that, broader changes
 * first. The representative product is the member with the cleanest (smallest)
 * diff — the easiest one to actually run Harvest on.
 */
export const rankCandidates = (clusters, totalProducts) => {
  // Precompute each cluster's file set so `sharedWith` (cross-cluster overlap) is cheap.
  const sets = clusters.map((c) => new Set(c.paths));
  return clusters
    .map((c, i) => {
      const representative = [...c.members].sort(
        (a, b) => (a.fileCount ?? a.generatorOwnedPaths?.length ?? 0) - (b.fileCount ?? b.generatorOwnedPaths?.length ?? 0)
      )[0];
      let sharedWith = 0;
      for (let j = 0; j < sets.length; j++) {
        if (j === i) continue;
        for (const p of sets[j]) {
          if (sets[i].has(p)) { sharedWith++; break; }
        }
      }
      return {
        signature: candidateSignature(c.paths),
        files: c.paths,
        fileCount: c.paths.length,
        products: c.members.map((m) => m.name),
        productIds: c.members.map((m) => m.productId),
        productCount: c.members.length,
        totalProducts,
        confidence: totalProducts > 0 ? c.members.length / totalProducts : 0,
        corroborated: c.members.length > 1,
        suggestedType: majority(c.members.map((m) => m.suggestedType)) ?? 'ambiguous',
        representativeProductId: representative?.productId ?? null,
        representativeProductName: representative?.name ?? null,
        risk: computeRisk(c.paths, sharedWith),
      };
    })
    .sort((a, b) => b.productCount - a.productCount || b.fileCount - a.fileCount);
};

/** Convenience: cluster then rank in one call. */
export const mineCandidates = (divergences, totalProducts, opts = {}) =>
  rankCandidates(clusterDivergences(divergences, opts), totalProducts);
