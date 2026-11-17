import { describe, expect, it } from 'vitest';

import { STEP_ORDER, buildPhases, canRerun, fmtDuration } from '../../../../../../client/agents/components/consoles/consolidacion/changesetPhases.js';

describe('canRerun', () => {
  it('permite reejecutar sobre runs terminales o en pausa de aprobación', () => {
    expect(canRerun('done')).toBe(true);
    expect(canRerun('failed')).toBe(true);
    expect(canRerun('cancelled')).toBe(true);
    expect(canRerun('awaiting_approval')).toBe(true);
  });

  it('no permite reejecutar mientras el run está en marcha', () => {
    expect(canRerun('running')).toBe(false);
    expect(canRerun('queued')).toBe(false);
    expect(canRerun('awaiting_child')).toBe(false);
    expect(canRerun(null)).toBe(false);
  });
});

describe('buildPhases', () => {
  it('sin steps, todo pending en el orden fijo del servidor', () => {
    const phases = buildPhases([]);
    expect(phases.map((p) => p.name)).toEqual(STEP_ORDER);
    expect(phases.every((p) => p.status === 'pending')).toBe(true);
  });

  it('fusiona los steps ya reportados sobre la plantilla ordenada', () => {
    const steps = [
      { name: 'plan', status: 'done', kind: 'deterministic', durationMs: 420 },
      { name: 'cascade', status: 'running', kind: 'llm' },
    ];
    const phases = buildPhases(steps);
    expect(phases.find((p) => p.name === 'plan')).toMatchObject({ status: 'done', kind: 'deterministic', durationMs: 420 });
    expect(phases.find((p) => p.name === 'cascade')).toMatchObject({ status: 'running', kind: 'llm' });
    expect(phases.find((p) => p.name === 'approve-plan').status).toBe('pending');
  });

  it('preserva el orden fijo aunque los steps lleguen en otro orden', () => {
    const steps = [
      { name: 'record', status: 'done' },
      { name: 'plan', status: 'done' },
    ];
    expect(buildPhases(steps).map((p) => p.name)).toEqual(STEP_ORDER);
  });

  it('un step con error queda marcado en su fase', () => {
    const phases = buildPhases([{ name: 'test', status: 'failed', error: 'timeout' }]);
    expect(phases.find((p) => p.name === 'test')).toMatchObject({ status: 'failed', error: 'timeout' });
  });

  it('un step con un name que no está en STEP_ORDER desaparece en silencio (igual que el original)', () => {
    const phases = buildPhases([{ name: 'a-future-step', status: 'done' }]);
    expect(phases.map((p) => p.name)).toEqual(STEP_ORDER);
  });
});

describe('fmtDuration', () => {
  it('sin duración, null', () => {
    expect(fmtDuration(0)).toBeNull();
    expect(fmtDuration(null)).toBeNull();
  });

  it('milisegundos por debajo de 1s', () => {
    expect(fmtDuration(420)).toBe('420ms');
  });

  it('segundos con un decimal por debajo de 1 minuto', () => {
    expect(fmtDuration(4200)).toBe('4.2s');
  });

  it('minutos y segundos a partir de 1 minuto', () => {
    expect(fmtDuration(75000)).toBe('1m 15s');
  });
});
