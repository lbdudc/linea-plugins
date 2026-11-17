import { describe, expect, it, vi } from 'vitest';

import { computeStalenessStats, computeStaleCount, sortProductsBySync } from '../../../../../client/agents/components/ops/stalenessStats.js';

const NOW = new Date('2026-09-15T00:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('computeStalenessStats', () => {
  it('agrupa por antigüedad de lastSyncAt (<7 / 7-30 / 30-90 / >=90 / nunca)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const products = [
        { lastSyncAt: daysAgo(1) },
        { lastSyncAt: daysAgo(6.9) },
        { lastSyncAt: daysAgo(10) },
        { lastSyncAt: daysAgo(29.9) },
        { lastSyncAt: daysAgo(60) },
        { lastSyncAt: daysAgo(200) },
        { lastSyncAt: null },
        { lastSyncAt: undefined },
      ];
      expect(computeStalenessStats(products)).toEqual({
        recent: 2,
        stale7: 2,
        stale30: 1,
        stale90: 1,
        never: 2,
      });
      const total = Object.values(computeStalenessStats(products)).reduce((a, b) => a + b, 0);
      expect(total).toBe(products.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it('el límite de 90 días cae en stale90, no en stale30', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      expect(computeStalenessStats([{ lastSyncAt: daysAgo(90) }]).stale90).toBe(1);
      expect(computeStalenessStats([{ lastSyncAt: daysAgo(89.9) }]).stale30).toBe(1);
      expect(computeStalenessStats([{ lastSyncAt: daysAgo(7) }]).stale7).toBe(1);
      expect(computeStalenessStats([{ lastSyncAt: daysAgo(6.99) }]).recent).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lista vacía o ausente no lanza, todo a cero', () => {
    expect(computeStalenessStats([])).toEqual({ recent: 0, stale7: 0, stale30: 0, stale90: 0, never: 0 });
    expect(computeStalenessStats(undefined)).toEqual({ recent: 0, stale7: 0, stale30: 0, stale90: 0, never: 0 });
  });
});

describe('computeStaleCount', () => {
  it('cuenta todo lo que no está "reciente" (stale7 + stale30 + stale90 + never)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const products = [{ lastSyncAt: daysAgo(1) }, { lastSyncAt: daysAgo(40) }, { lastSyncAt: null }];
      expect(computeStaleCount(products)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('sortProductsBySync', () => {
  it('ordena de más antiguo a más reciente', () => {
    const a = { name: 'a', lastSyncAt: daysAgo(1) };
    const b = { name: 'b', lastSyncAt: daysAgo(50) };
    const c = { name: 'c', lastSyncAt: daysAgo(10) };
    expect(sortProductsBySync([a, b, c]).map((p) => p.name)).toEqual(['b', 'c', 'a']);
  });

  it('los nunca sincronizados van primero, delante de cualquier fecha', () => {
    const synced = { name: 'synced', lastSyncAt: daysAgo(500) };
    const never = { name: 'never', lastSyncAt: null };
    expect(sortProductsBySync([synced, never]).map((p) => p.name)).toEqual(['never', 'synced']);
  });

  it('no muta el array original', () => {
    const original = [{ name: 'b', lastSyncAt: daysAgo(50) }, { name: 'a', lastSyncAt: daysAgo(1) }];
    const copia = [...original];
    sortProductsBySync(original);
    expect(original).toEqual(copia);
  });
});
