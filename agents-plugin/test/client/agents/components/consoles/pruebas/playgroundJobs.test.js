import { describe, expect, it } from 'vitest';

import { failedCount, findJobByJobId, jobFor, normalizeFeatures, passedCount, runningCount } from '../../../../../../client/agents/components/consoles/pruebas/playgroundJobs.js';

describe('normalizeFeatures', () => {
  it('sin spec, lista vacía', () => {
    expect(normalizeFeatures(null)).toEqual([]);
  });

  it('spec.features como array se devuelve tal cual', () => {
    expect(normalizeFeatures({ features: ['A', 'B'] })).toEqual(['A', 'B']);
  });

  it('spec.features como mapa {nombre: bool} se convierte en array de las activas', () => {
    expect(normalizeFeatures({ features: { A: true, B: false, C: true } })).toEqual(['A', 'C']);
  });

  it('sin features, cae a spec.selection si es array', () => {
    expect(normalizeFeatures({ selection: ['X'] })).toEqual(['X']);
  });

  it('sin nada usable, lista vacía', () => {
    expect(normalizeFeatures({})).toEqual([]);
  });
});

describe('jobFor', () => {
  it('devuelve el job existente', () => {
    const jobs = { p1: { status: 'running', jobId: 'j1', log: ['a'] } };
    expect(jobFor(jobs, 'p1')).toEqual({ status: 'running', jobId: 'j1', log: ['a'] });
  });

  it('sin job para ese producto, devuelve la forma idle por defecto', () => {
    expect(jobFor({}, 'p2')).toEqual({ status: 'idle', jobId: null, log: [] });
    expect(jobFor(undefined, 'p2')).toEqual({ status: 'idle', jobId: null, log: [] });
  });
});

describe('findJobByJobId', () => {
  it('encuentra el job cuyo jobId coincide', () => {
    const jobs = { p1: { status: 'running', jobId: 'j1', log: [] }, p2: { status: 'idle', jobId: null, log: [] } };
    expect(findJobByJobId(jobs, 'j1')).toBe(jobs.p1);
  });

  it('sin coincidencia, null', () => {
    expect(findJobByJobId({}, 'jX')).toBeNull();
  });
});

describe('recuentos (passed/failed/running)', () => {
  const jobs = {
    p1: { status: 'passed', jobId: null, log: [] },
    p2: { status: 'failed', jobId: null, log: [] },
    p3: { status: 'running', jobId: 'j3', log: [] },
    p4: { status: 'passed', jobId: null, log: [] },
    p5: { status: 'idle', jobId: null, log: [] },
  };

  it('passedCount cuenta solo los "passed"', () => {
    expect(passedCount(jobs)).toBe(2);
  });

  it('failedCount cuenta solo los "failed"', () => {
    expect(failedCount(jobs)).toBe(1);
  });

  it('runningCount cuenta solo los "running"', () => {
    expect(runningCount(jobs)).toBe(1);
  });

  it('sin jobs, todos los recuentos son 0', () => {
    expect(passedCount({})).toBe(0);
    expect(failedCount({})).toBe(0);
    expect(runningCount({})).toBe(0);
  });
});
