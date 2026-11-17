/**
 * Unit tests for the Variant Divergence Miner's deterministic core.
 * Pure functions — no DB, the git host, or LLM.
 */
import { describe, it, expect } from 'vitest';
import { clusterDivergences, rankCandidates, mineCandidates, candidateSignature } from '../../agents/tools/variantMiner.js';

const div = (name, paths, opts = {}) => ({
  productId: opts.productId ?? name,
  name,
  fileCount: opts.fileCount ?? paths.length,
  suggestedType: opts.suggestedType ?? 'extend-existing-feature',
  generatorOwnedPaths: paths,
  customizationPaths: opts.customizationPaths ?? [],
});

describe('clusterDivergences', () => {
  it('clusters products that touch the same files', () => {
    const clusters = clusterDivergences([
      div('A', ['src/a.js', 'src/b.js']),
      div('B', ['src/a.js', 'src/b.js']),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.name)).toEqual(['A', 'B']);
  });

  it('separates products with disjoint files', () => {
    const clusters = clusterDivergences([
      div('A', ['src/a.js']),
      div('B', ['src/z.js']),
    ]);
    expect(clusters).toHaveLength(2);
  });

  it('excludes product-local divergences (no generator-owned files)', () => {
    const clusters = clusterDivergences([
      div('A', [], { customizationPaths: ['README.md'] }),
      div('B', ['src/a.js']),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members[0].name).toBe('B');
  });

  it('respects the Jaccard threshold', () => {
    // Overlap of 1 shared file out of 5 union = 0.2 < 0.4 → separate clusters.
    const clusters = clusterDivergences([
      div('A', ['src/a.js', 'src/b.js', 'src/c.js']),
      div('B', ['src/c.js', 'src/d.js', 'src/e.js']),
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe('rankCandidates', () => {
  it('ranks corroborated (multi-product) candidates first and computes confidence', () => {
    const clusters = clusterDivergences([
      div('A', ['src/shared.js']),
      div('B', ['src/shared.js']),
      div('C', ['src/solo.js']),
    ]);
    const candidates = rankCandidates(clusters, 4);

    expect(candidates[0].productCount).toBe(2);
    expect(candidates[0].corroborated).toBe(true);
    expect(candidates[0].confidence).toBeCloseTo(0.5);
    expect(candidates[1].corroborated).toBe(false);
  });

  it('picks the cleanest diff (smallest fileCount) as representative', () => {
    const clusters = clusterDivergences([
      div('Big', ['src/shared.js'], { fileCount: 12, productId: 'big' }),
      div('Small', ['src/shared.js'], { fileCount: 2, productId: 'small' }),
    ]);
    const [candidate] = rankCandidates(clusters, 2);
    expect(candidate.representativeProductId).toBe('small');
  });
});

describe('rankCandidates risk', () => {
  it('flags high-touch (build/config) files as high risk', () => {
    const clusters = clusterDivergences([div('A', ['package.json'])]);
    const [candidate] = rankCandidates(clusters, 3);
    expect(candidate.risk.level).toBe('high');
    expect(candidate.risk.highTouch).toContain('package.json');
  });

  it('matches *.config.js and CI/docker surfaces as high-touch', () => {
    const clusters = clusterDivergences([
      div('A', ['quasar.config.js']),
      div('B', ['.gitlab-ci.yml'], { productId: 'b' }),
    ]);
    const cands = rankCandidates(clusters, 3);
    expect(cands.every((c) => c.risk.level === 'high')).toBe(true);
  });

  it('marks a low risk when files are ordinary source with no overlap', () => {
    const clusters = clusterDivergences([div('A', ['src/feature/thing.js'])]);
    const [candidate] = rankCandidates(clusters, 3);
    expect(candidate.risk.level).toBe('low');
    expect(candidate.risk.highTouch).toEqual([]);
    expect(candidate.risk.sharedWith).toBe(0);
  });

  it('counts cross-cluster overlap as sharedWith and raises risk to medium', () => {
    // Two clusters kept separate by the Jaccard threshold but sharing one file.
    const clusters = clusterDivergences([
      div('A', ['src/a.js', 'src/b.js', 'src/c.js']),
      div('B', ['src/c.js', 'src/d.js', 'src/e.js'], { productId: 'b' }),
    ]);
    expect(clusters).toHaveLength(2);
    const cands = rankCandidates(clusters, 3);
    expect(cands.every((c) => c.risk.sharedWith === 1)).toBe(true);
    expect(cands.every((c) => c.risk.level === 'medium')).toBe(true);
  });
});

describe('candidateSignature', () => {
  it('is stable for the same file set regardless of order', () => {
    expect(candidateSignature(['src/b.js', 'src/a.js'])).toBe(candidateSignature(['src/a.js', 'src/b.js']));
  });

  it('ignores duplicate paths', () => {
    expect(candidateSignature(['src/a.js', 'src/a.js', 'src/b.js'])).toBe(candidateSignature(['src/a.js', 'src/b.js']));
  });

  it('changes when the file set changes', () => {
    expect(candidateSignature(['src/a.js'])).not.toBe(candidateSignature(['src/a.js', 'src/b.js']));
  });
});

describe('rankCandidates signatures', () => {
  it('attaches a stable signature to each candidate', () => {
    const clusters = clusterDivergences([div('A', ['src/shared.js']), div('B', ['src/shared.js'])]);
    const [candidate] = rankCandidates(clusters, 2);
    expect(candidate.signature).toBe(candidateSignature(['src/shared.js']));
  });
});

describe('mineCandidates', () => {
  it('returns an empty list when there are no harvestable divergences', () => {
    expect(mineCandidates([div('A', [], { customizationPaths: ['.env'] })], 3)).toEqual([]);
  });

  it('clusters and ranks in one call', () => {
    const candidates = mineCandidates(
      [div('A', ['src/x.js']), div('B', ['src/x.js']), div('C', ['src/y.js'])],
      3
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0].productCount).toBe(2);
  });
});
