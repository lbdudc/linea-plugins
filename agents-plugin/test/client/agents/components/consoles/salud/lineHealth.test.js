import { describe, expect, it } from 'vitest';

import { computeRunStats, coveragePercent, formatDurationMs, recentRuns } from '../../../../../../client/agents/components/consoles/salud/lineHealth.js';

describe('coveragePercent', () => {
  it('null sin healthSummary', () => {
    expect(coveragePercent(null)).toBeNull();
  });

  it('null cuando el total es 0 (sin productos, no "0% inválido")', () => {
    expect(coveragePercent({ valid: 0, invalid: 0, total: 0 })).toBeNull();
  });

  it('redondea el porcentaje', () => {
    expect(coveragePercent({ valid: 1, invalid: 2, total: 3 })).toBe(33);
    expect(coveragePercent({ valid: 2, invalid: 1, total: 3 })).toBe(67);
  });

  it('100% cuando todo es válido', () => {
    expect(coveragePercent({ valid: 5, invalid: 0, total: 5 })).toBe(100);
  });

  it('0% real cuando todo es inválido (distinto de "sin datos")', () => {
    expect(coveragePercent({ valid: 0, invalid: 5, total: 5 })).toBe(0);
  });
});

describe('computeRunStats', () => {
  it('cuenta cada bucket por separado', () => {
    const runs = [
      { status: 'done' },
      { status: 'done' },
      { status: 'awaiting_approval' },
      { status: 'failed' },
      { status: 'running' },
    ];
    expect(computeRunStats(runs)).toEqual({ total: 5, done: 2, awaiting: 1, failed: 1 });
  });

  it('vacío sin runs', () => {
    expect(computeRunStats([])).toEqual({ total: 0, done: 0, awaiting: 0, failed: 0 });
  });

  it('tolera un valor no-array (dato inesperado del servidor)', () => {
    expect(computeRunStats(null)).toEqual({ total: 0, done: 0, awaiting: 0, failed: 0 });
  });
});

describe('formatDurationMs', () => {
  it('null sin duración', () => {
    expect(formatDurationMs(null)).toBeNull();
    expect(formatDurationMs(0)).toBeNull();
  });

  it('milisegundos por debajo de 1s', () => {
    expect(formatDurationMs(420)).toBe('420ms');
  });

  it('segundos con un decimal por debajo de 1 minuto', () => {
    expect(formatDurationMs(3200)).toBe('3.2s');
  });

  it('minutos redondeados a partir de 1 minuto', () => {
    expect(formatDurationMs(125000)).toBe('2m');
  });
});

describe('recentRuns', () => {
  it('se queda con los primeros 8 por defecto', () => {
    const runs = Array.from({ length: 12 }, (_, i) => ({ _id: String(i) }));
    expect(recentRuns(runs)).toHaveLength(8);
    expect(recentRuns(runs)[0]._id).toBe('0');
  });

  it('respeta un límite explícito', () => {
    const runs = Array.from({ length: 5 }, (_, i) => ({ _id: String(i) }));
    expect(recentRuns(runs, 3)).toHaveLength(3);
  });
});
