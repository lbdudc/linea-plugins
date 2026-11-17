import { describe, expect, it } from 'vitest';

import { BUCKETS, FILTRO_BUCKET, runBucket } from '../../../../../client/agents/components/activity/runStatus.js';

const ESTADOS = [
  'queued',
  'running',
  'awaiting_child',
  'awaiting_external',
  'awaiting_approval',
  'done',
  'failed',
  'cancelled',
];

describe('runBucket', () => {
  it('solo devuelve buckets de la lista declarada', () => {
    for (const status of ESTADOS) {
      expect(BUCKETS).toContain(runBucket({ status }));
    }
  });

  it('agrupa los cuatro estados en vuelo bajo "run"', () => {
    for (const status of ['queued', 'running', 'awaiting_child', 'awaiting_external']) {
      expect(runBucket({ status })).toBe('run');
    }
  });

  it('separa el que espera decisión humana', () => {
    expect(runBucket({ status: 'awaiting_approval' })).toBe('wait');
  });

  it('trata cancelado como fallo, no como terminado', () => {
    expect(runBucket({ status: 'cancelled' })).toBe('fail');
    expect(runBucket({ status: 'failed' })).toBe('fail');
    expect(runBucket({ status: 'done' })).toBe('done');
  });

  it('un estado desconocido no se cuela como "done"', () => {
    expect(runBucket({ status: 'lo-que-sea' })).toBe('fail');
    expect(runBucket(undefined)).toBe('fail');
  });

  it('un sync terminado con conflictos sin resolver cuenta como fallo', () => {
    expect(runBucket({ agentType: 'sync', status: 'done', result: { hasConflicts: true } })).toBe('fail');
    expect(runBucket({ agentType: 'sync', status: 'done', result: { hasConflicts: false } })).toBe('done');
  });

  it('un harvest bloqueado cuenta como fallo', () => {
    expect(runBucket({ agentType: 'harvest', status: 'done', result: { blocked: true } })).toBe('fail');
  });

  it('el rescate por conflictos solo aplica a su agente', () => {
    expect(runBucket({ agentType: 'regen', status: 'done', result: { hasConflicts: true } })).toBe('done');
  });
});

describe('FILTRO_BUCKET', () => {
  it('todos sus valores son buckets que runBucket puede devolver', () => {
    for (const bucket of Object.values(FILTRO_BUCKET)) {
      expect(BUCKETS).toContain(bucket);
    }
  });

  it('cubre los cuatro buckets, sin dejar ninguno sin filtro', () => {
    expect([...Object.values(FILTRO_BUCKET)].sort()).toEqual([...BUCKETS].sort());
  });
});
