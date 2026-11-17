import { describe, it, expect } from 'vitest';
import { deriveFlow, isDispositionSuppressing, extractChangesetPlan } from '../../../../../client/agents/components/flow/flowModel';

const LINE = 'line-1';

const run = (overrides) => ({
  _id: 'run-' + Math.random().toString(36).slice(2),
  status: 'done',
  scope: { lineId: LINE },
  proposals: [],
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('deriveFlow', () => {
  it('returns empty stages when no line is selected', () => {
    const flow = deriveFlow({ runs: [run({})], versions: [], dispositions: [], lineId: null });
    expect(flow.divergence.candidates).toBe(0);
    expect(flow.divergence.openCandidates).toEqual([]);
    expect(flow.intoSpl.harvestAwaiting).toBe(0);
    expect(flow.propagation.cascade).toEqual([]);
  });

  it('returns empty stages for a line with zero runs', () => {
    const flow = deriveFlow({ runs: [], versions: [], dispositions: [], lineId: LINE });
    expect(flow.divergence.candidates).toBe(0);
    expect(flow.divergence.productsDrifted).toBe(0);
    expect(flow.intoSpl.harvestOpen).toBe(0);
    expect(flow.intoSpl.activeVersion).toBeNull();
    expect(flow.propagation.activeRun).toBeNull();
  });

  it('counts miner candidates, corroboration, and drifted products', () => {
    const minerRun = run({
      agentType: 'variant-miner',
      status: 'done',
      result: {
        candidates: [
          { signature: 'a', suggestedType: 'new-optional-feature', productCount: 1, productIds: ['p1'], products: ['Alpha'], representativeProductId: 'p1', corroborated: false },
          { signature: 'b', suggestedType: 'bugfix-to-generated', productCount: 3, productIds: ['p2', 'p3'], products: ['Beta', 'Gamma'], representativeProductId: 'p2', corroborated: true },
        ],
      },
    });
    const flow = deriveFlow({ runs: [minerRun], versions: [], dispositions: [], lineId: LINE });
    expect(flow.divergence.candidates).toBe(2);
    expect(flow.divergence.corroborated).toBe(1);
    expect(flow.divergence.productsDrifted).toBe(3);
    expect(flow.divergence.minerScanning).toBe(false);
  });

  it('excludes candidates suppressed by an active disposition', () => {
    const minerRun = run({
      agentType: 'variant-miner',
      result: { candidates: [{ signature: 'a', productIds: ['p1'], products: ['Alpha'], representativeProductId: 'p1', productCount: 1 }] },
    });
    const dismissed = { signature: 'a', state: 'dismissed' };
    const flow = deriveFlow({ runs: [minerRun], versions: [], dispositions: [dismissed], lineId: LINE });
    expect(flow.divergence.candidates).toBe(0);
  });

  it('excludes candidates whose representative product already has a harvest run', () => {
    const minerRun = run({
      agentType: 'variant-miner',
      result: { candidates: [{ signature: 'a', productIds: ['p1'], products: ['Alpha'], representativeProductId: 'p1', productCount: 1 }] },
    });
    const harvestRun = run({ agentType: 'harvest', scope: { lineId: LINE, productId: 'p1' }, status: 'awaiting_approval' });
    const flow = deriveFlow({ runs: [minerRun, harvestRun], versions: [], dispositions: [], lineId: LINE });
    expect(flow.divergence.candidates).toBe(0);
    expect(flow.intoSpl.harvestAwaiting).toBe(1);
  });

  it('counts open Change Sets and picks the most recent active one as the active version', () => {
    const versions = [
      { _id: 'v1', lineId: LINE, status: 'merged', createdAt: '2026-01-01T00:00:00Z' },
      { _id: 'v2', lineId: LINE, status: 'draft', createdAt: '2026-01-03T00:00:00Z' },
      { _id: 'v3', lineId: LINE, status: 'sandbox', createdAt: '2026-01-02T00:00:00Z' },
    ];
    const flow = deriveFlow({ runs: [], versions, dispositions: [], lineId: LINE });
    expect(flow.intoSpl.versionsOpen).toBe(2);
    expect(flow.intoSpl.activeVersion._id).toBe('v2');
  });

  it('extracts the cascade and stats from a pending plan_approval proposal', () => {
    const changesetRun = run({
      agentType: 'changeset',
      status: 'awaiting_approval',
      proposals: [{
        kind: 'plan_approval',
        decision: null,
        body: {
          plan: {
            editClass: 'generalization',
            cascade: [
              { productId: 'p1', name: 'Alpha', action: 'migrate', likely_conflict: true, isCritical: false },
              { productId: 'p2', name: 'Beta', action: 'regen', likely_conflict: false, isCritical: true },
              { productId: 'p3', name: 'Gamma', action: 'skip' },
            ],
            stats: { migrate: 1, regen: 1, skip: 1, likelyConflict: 1, critical: 1 },
          },
        },
      }],
    });
    const flow = deriveFlow({ runs: [changesetRun], versions: [], dispositions: [], lineId: LINE });
    expect(flow.propagation.activeRun._id).toBe(changesetRun._id);
    expect(flow.propagation.cascade).toHaveLength(3);
    expect(flow.propagation.stats).toEqual({ migrate: 1, regen: 1, skip: 1, likelyConflict: 1, critical: 1 });
    expect(flow.propagation.editClass).toBe('generalization');
  });

  it('falls back to the decided proposal / result ledger once a changeset run is terminal', () => {
    const changesetRun = run({
      agentType: 'changeset',
      status: 'done',
      proposals: [{ kind: 'plan_approval', decision: 'approved', body: { plan: null } }],
      result: { ledger: { plan: { cascade: [{ productId: 'p1', name: 'Alpha', action: 'regen' }], stats: { regen: 1 } } } },
    });
    const flow = deriveFlow({ runs: [changesetRun], versions: [], dispositions: [], lineId: LINE });
    expect(flow.propagation.cascade).toHaveLength(1);
    expect(flow.propagation.stats.regen).toBe(1);
  });

  it('reconciles cascade entries against their spawned regen/evolution children', () => {
    const changesetRun = run({
      _id: 'cs-1',
      agentType: 'changeset',
      status: 'done',
      result: {
        ledger: {
          plan: {
            cascade: [
              { productId: 'p1', name: 'Alpha', action: 'regen', likely_conflict: false, isCritical: false },
              { productId: 'p2', name: 'Beta', action: 'regen', likely_conflict: true, isCritical: false },
              { productId: 'p3', name: 'Gamma', action: 'regen', likely_conflict: false, isCritical: false },
              { productId: 'p4', name: 'Delta', action: 'migrate', likely_conflict: false, isCritical: false },
            ],
            stats: { migrate: 1, regen: 3, skip: 0, likelyConflict: 1, critical: 0 },
          },
        },
      },
    });
    // p1: regen finished clean — should read as completed, drop out of "outstanding".
    const p1Child = run({ agentType: 'regen', parentRunId: 'cs-1', scope: { lineId: LINE, productId: 'p1' }, status: 'done', result: { conflicts: false } });
    // p2: regen finished but still has conflicts — not completed, flagged for review.
    const p2Child = run({ agentType: 'regen', parentRunId: 'cs-1', scope: { lineId: LINE, productId: 'p2' }, status: 'done', result: { conflicts: true } });
    // p3: regen child errored out.
    const p3Child = run({ agentType: 'regen', parentRunId: 'cs-1', scope: { lineId: LINE, productId: 'p3' }, status: 'failed' });
    // p4: no child yet — still outstanding, same as today's behavior.

    const flow = deriveFlow({ runs: [changesetRun, p1Child, p2Child, p3Child], versions: [], dispositions: [], lineId: LINE });

    const byProduct = Object.fromEntries(flow.propagation.cascade.map((c) => [c.productId, c]));
    expect(byProduct.p1.completed).toBe(true);
    expect(byProduct.p2.completed).toBe(false);
    expect(byProduct.p2.childNeedsReview).toBe(true);
    expect(byProduct.p3.completed).toBe(false);
    expect(byProduct.p3.childFailed).toBe(true);
    expect(byProduct.p4.completed).toBe(false);

    // Only p2, p3, p4 are still actually outstanding — p1 is done.
    expect(flow.propagation.stats.regen).toBe(2);
    expect(flow.propagation.stats.migrate).toBe(1);
    expect(flow.propagation.stats.likelyConflict).toBe(1);
  });

  it('counts a later regen as completing the cascade even if the changeset did not spawn it', () => {
    // Mirrors what actually happened with ComplexCalculator: the changeset's own
    // spawned regen child failed (a since-fixed Windows rename bug), and the
    // product was only fixed later by a plain "Re-run" from the Sync console —
    // an unrelated top-level run, not a child of this changeset.
    const changesetRun = run({
      _id: 'cs-2',
      agentType: 'changeset',
      status: 'done',
      createdAt: '2026-08-07T11:30:00Z',
      result: {
        ledger: {
          plan: { cascade: [{ productId: 'p1', name: 'Alpha', action: 'regen' }], stats: { regen: 1 } },
        },
      },
    });
    const spawnedFailure = run({
      agentType: 'regen', parentRunId: 'cs-2', scope: { lineId: LINE, productId: 'p1' },
      status: 'failed', createdAt: '2026-08-07T11:30:32Z',
    });
    const laterManualRerun = run({
      agentType: 'regen', parentRunId: null, scope: { lineId: LINE, productId: 'p1' },
      status: 'done', createdAt: '2026-08-14T10:17:42Z', result: { conflicts: false },
    });

    const flow = deriveFlow({ runs: [changesetRun, spawnedFailure, laterManualRerun], versions: [], dispositions: [], lineId: LINE });
    expect(flow.propagation.cascade[0].completed).toBe(true);
    expect(flow.propagation.stats.regen).toBe(0);
  });

  it('prefers an in-flight changeset run over a more recent terminal one', () => {
    const terminal = run({ agentType: 'changeset', status: 'done', createdAt: '2026-01-02T00:00:00Z' });
    const inFlight = run({ agentType: 'changeset', status: 'running', createdAt: '2026-01-01T00:00:00Z' });
    const flow = deriveFlow({ runs: [terminal, inFlight], versions: [], dispositions: [], lineId: LINE });
    expect(flow.propagation.activeRun._id).toBe(inFlight._id);
  });

  it('ignores runs scoped to a different line', () => {
    const otherLineRun = run({ agentType: 'variant-miner', scope: { lineId: 'other-line' }, result: { candidates: [{ signature: 'x', productIds: ['p1'] }] } });
    const flow = deriveFlow({ runs: [otherLineRun], versions: [], dispositions: [], lineId: LINE });
    expect(flow.divergence.candidates).toBe(0);
  });
});

describe('isDispositionSuppressing', () => {
  it('suppresses dismissed and manually-harvested unconditionally', () => {
    expect(isDispositionSuppressing({ state: 'dismissed' })).toBe(true);
    expect(isDispositionSuppressing({ state: 'manually-harvested' })).toBe(true);
  });

  it('suppresses snoozed only until the snooze date passes', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(isDispositionSuppressing({ state: 'snoozed', snoozeUntil: future })).toBe(true);
    expect(isDispositionSuppressing({ state: 'snoozed', snoozeUntil: past })).toBe(false);
  });

  it('does not suppress an unrecognized or open state', () => {
    expect(isDispositionSuppressing({ state: 'open' })).toBe(false);
  });
});

describe('extractChangesetPlan', () => {
  it('returns null for a run with no plan anywhere', () => {
    expect(extractChangesetPlan(run({}))).toBeNull();
    expect(extractChangesetPlan(null)).toBeNull();
  });
});
