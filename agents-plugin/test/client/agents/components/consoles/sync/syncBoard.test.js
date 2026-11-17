import { describe, expect, it } from 'vitest';

import {
  buildBoardBuckets,
  canRetryResolver,
  filterLineRuns,
  isUnderChangeset,
  productState,
  regenForProduct,
  relevantRun,
  syncForProduct,
} from '../../../../../../client/agents/components/consoles/sync/syncBoard.js';

const hasUnresolvedConflicts = (run) =>
  run?.agentType === 'sync' && run.status === 'done' && run.result?.hasConflicts === true;

describe('isUnderChangeset', () => {
  it('sube por parentRunId hasta encontrar un changeset', () => {
    const runsById = {
      grandparent: { _id: 'grandparent', agentType: 'changeset' },
      parent: { _id: 'parent', agentType: 'regen', parentRunId: 'grandparent' },
    };
    const run = { _id: 'child', agentType: 'sync', parentRunId: 'parent' };
    expect(isUnderChangeset(run, runsById)).toBe(true);
  });

  it('false si no hay ancestro changeset', () => {
    const runsById = { parent: { _id: 'parent', agentType: 'regen' } };
    const run = { _id: 'child', agentType: 'sync', parentRunId: 'parent' };
    expect(isUnderChangeset(run, runsById)).toBe(false);
  });

  it('false sin parentRunId', () => {
    expect(isUnderChangeset({ _id: 'a' }, {})).toBe(false);
  });

  it('no entra en bucle infinito con un ciclo de parentRunId', () => {
    const runsById = {
      a: { _id: 'a', agentType: 'regen', parentRunId: 'b' },
      b: { _id: 'b', agentType: 'regen', parentRunId: 'a' },
    };
    expect(isUnderChangeset(runsById.a, runsById)).toBe(false);
  });
});

describe('filterLineRuns', () => {
  it('descarta runs de otra línea y los que cuelgan (como hijo) de un changeset', () => {
    const runs = [
      { _id: '1', agentType: 'regen', scope: { lineId: 'L1' } },
      { _id: '2', agentType: 'regen', scope: { lineId: 'L2' } },
      { _id: '3', agentType: 'changeset', scope: { lineId: 'L1' } },
      { _id: '4', agentType: 'regen', scope: { lineId: 'L1' }, parentRunId: '3' },
    ];
    const result = filterLineRuns(runs, 'L1');
    expect(result.map((r) => r._id)).toEqual(['1', '3']);
  });
});

describe('productState', () => {
  const P = 'p1';

  it('idle sin ningún run', () => {
    expect(productState([], P, hasUnresolvedConflicts)).toBe('idle');
  });

  it('regenerating mientras el regen está en curso', () => {
    const runs = [{ _id: 'r1', agentType: 'regen', status: 'running', scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('regenerating');
  });

  it('conflict cuando el sync está awaiting_approval', () => {
    const runs = [{ _id: 's1', agentType: 'sync', status: 'awaiting_approval', scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('conflict');
  });

  it('resolving mientras el sync está running', () => {
    const runs = [{ _id: 's1', agentType: 'sync', status: 'running', scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('resolving');
  });

  it('conflict cuando el sync terminó done pero el host git sigue reportando conflicto', () => {
    const runs = [
      { _id: 's1', agentType: 'sync', status: 'done', result: { hasConflicts: true }, scope: { productId: P }, createdAt: '2026-01-01' },
    ];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('conflict');
  });

  it('clean cuando el sync done ya no tiene conflictos y no hay regen', () => {
    const runs = [
      { _id: 's1', agentType: 'sync', status: 'done', result: { hasConflicts: false }, scope: { productId: P }, createdAt: '2026-01-01' },
    ];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('idle');
  });

  it('failed cuando el regen falló y no hay sync', () => {
    const runs = [{ _id: 'r1', agentType: 'regen', status: 'failed', scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('failed');
  });

  it('clean cuando el regen terminó done sin conflictos', () => {
    const runs = [{ _id: 'r1', agentType: 'regen', status: 'done', scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('clean');
  });

  it('conflict cuando el regen reporta conflicts en su resultado', () => {
    const runs = [{ _id: 'r1', agentType: 'regen', status: 'done', result: { conflicts: true }, scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('conflict');
  });

  it('prefiere el sync awaiting_approval más reciente sobre uno done más nuevo', () => {
    const runs = [
      { _id: 's-old', agentType: 'sync', status: 'awaiting_approval', scope: { productId: P }, createdAt: '2026-01-01' },
      { _id: 's-new', agentType: 'sync', status: 'done', result: { hasConflicts: false }, scope: { productId: P }, createdAt: '2026-01-02' },
    ];
    expect(syncForProduct(runs, P)._id).toBe('s-old');
    expect(productState(runs, P, hasUnresolvedConflicts)).toBe('conflict');
  });
});

describe('buildBoardBuckets', () => {
  it('reparte productos en los cinco cubos, colapsando resolving en conflict', () => {
    const products = [{ _id: 'p1' }, { _id: 'p2' }, { _id: 'p3' }];
    const runs = [
      { _id: 'r1', agentType: 'regen', status: 'running', scope: { productId: 'p1' }, createdAt: '2026-01-01' },
      { _id: 's2', agentType: 'sync', status: 'running', scope: { productId: 'p2' }, createdAt: '2026-01-01' },
    ];
    const buckets = buildBoardBuckets(products, runs, hasUnresolvedConflicts);
    expect(buckets.regenerating.map((p) => p._id)).toEqual(['p1']);
    expect(buckets.conflict.map((p) => p._id)).toEqual(['p2']);
    expect(buckets.idle.map((p) => p._id)).toEqual(['p3']);
    expect(buckets.clean).toEqual([]);
    expect(buckets.failed).toEqual([]);
  });
});

describe('canRetryResolver', () => {
  const P = 'p1';

  it('false sin ningún run de sync', () => {
    expect(canRetryResolver([], P)).toBe(false);
  });

  it('false mientras el sync sigue en curso (no terminal)', () => {
    const runs = [{ _id: 's1', agentType: 'sync', status: 'running', scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(canRetryResolver(runs, P)).toBe(false);
  });

  it('true cuando el sync terminó failed', () => {
    const runs = [{ _id: 's1', agentType: 'sync', status: 'failed', scope: { productId: P }, createdAt: '2026-01-01' }];
    expect(canRetryResolver(runs, P)).toBe(true);
  });

  it('false cuando el sync ya terminó done y confirmó que no hay conflictos', () => {
    const runs = [
      { _id: 's1', agentType: 'sync', status: 'done', result: { hasConflicts: false }, scope: { productId: P }, createdAt: '2026-01-01' },
    ];
    expect(canRetryResolver(runs, P)).toBe(false);
  });
});

describe('relevantRun', () => {
  it('el regen manda mientras está en curso, aunque haya un sync más nuevo', () => {
    const runs = [
      { _id: 'r1', agentType: 'regen', status: 'running', scope: { productId: 'p1' }, createdAt: '2026-01-01' },
      { _id: 's1', agentType: 'sync', status: 'done', result: { hasConflicts: false }, scope: { productId: 'p1' }, createdAt: '2026-01-02' },
    ];
    expect(relevantRun(runs, 'p1', hasUnresolvedConflicts)._id).toBe('r1');
  });

  it('sin runs en curso, el sync awaiting_approval manda sobre el regen', () => {
    const runs = [
      { _id: 'r1', agentType: 'regen', status: 'done', scope: { productId: 'p1' }, createdAt: '2026-01-01' },
      { _id: 's1', agentType: 'sync', status: 'awaiting_approval', scope: { productId: 'p1' }, createdAt: '2026-01-02' },
    ];
    expect(relevantRun(runs, 'p1', hasUnresolvedConflicts)._id).toBe('s1');
  });
});

describe('regenForProduct', () => {
  it('devuelve null si no hay regen para el producto', () => {
    expect(regenForProduct([], 'p1')).toBeNull();
  });
});
