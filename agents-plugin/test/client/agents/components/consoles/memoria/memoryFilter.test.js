import { describe, expect, it } from 'vitest';

import { scorePercent, sortMemoriesByRecency } from '../../../../../../client/agents/components/consoles/memoria/memoryFilter.js';

describe('sortMemoriesByRecency', () => {
  it('ordena de más reciente a más antigua', () => {
    const memories = [
      { _id: 'a', createdAt: '2026-01-01T00:00:00Z' },
      { _id: 'b', createdAt: '2026-03-01T00:00:00Z' },
      { _id: 'c', createdAt: '2026-02-01T00:00:00Z' },
    ];
    expect(sortMemoriesByRecency(memories).map((m) => m._id)).toEqual(['b', 'c', 'a']);
  });

  it('no muta el array original', () => {
    const memories = [{ _id: 'a', createdAt: '2026-01-01' }, { _id: 'b', createdAt: '2026-02-01' }];
    const original = [...memories];
    sortMemoriesByRecency(memories);
    expect(memories).toEqual(original);
  });

  it('vacío sin memorias', () => {
    expect(sortMemoriesByRecency([])).toEqual([]);
    expect(sortMemoriesByRecency(undefined)).toEqual([]);
  });
});

describe('scorePercent', () => {
  it('null sin score (no es lo mismo que 0%)', () => {
    expect(scorePercent(null)).toBeNull();
    expect(scorePercent(undefined)).toBeNull();
  });

  it('redondea a un porcentaje entero', () => {
    expect(scorePercent(0.876)).toBe(88);
    expect(scorePercent(0)).toBe(0);
    expect(scorePercent(1)).toBe(100);
  });
});
