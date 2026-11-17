import { describe, expect, it } from 'vitest';

import { describeProposal, pauseReasonMeta, pendingProposal } from '../../../../../client/agents/components/activity/proposalSummary.js';

function noEsClaveSinResolver(texto) {
  return typeof texto === 'string' && texto.length > 0 && !texto.startsWith('labels.');
}

describe('describeProposal', () => {
  it('propuesta vacía/nula no revienta', () => {
    expect(describeProposal(null)).toBe('');
    expect(describeProposal(undefined)).toBe('');
  });

  it('merge_resolution: con ficheros y recuento, usa la frase completa', () => {
    const texto = describeProposal({
      kind: 'merge_resolution',
      body: { title: 'MR !42', fileEdits: [{ path: 'src/a.js' }, { path: 'src/b.js' }] },
    });
    expect(noEsClaveSinResolver(texto)).toBe(true);
    expect(texto).toContain('MR !42');
    expect(texto).toContain('a.js');
  });

  it('merge_resolution: sin título ni ficheros cae a un texto por defecto legible', () => {
    const texto = describeProposal({ kind: 'merge_resolution', body: {} });
    expect(noEsClaveSinResolver(texto)).toBe(true);
  });

  it('fm_patch: con feature y ficheros combina las dos cosas', () => {
    const texto = describeProposal({
      kind: 'fm_patch',
      body: { changeType: 'generalización', featureName: 'Pagos', fileEdits: [{ path: 'fm/model.uvl' }] },
    });
    expect(texto).toContain('Pagos');
    expect(texto).toContain('model.uvl');
    expect(noEsClaveSinResolver(texto)).toBe(true);
  });

  it('git_comment: es una recomendación con título', () => {
    const texto = describeProposal({ kind: 'git_comment', body: { title: 'Conflicto en pom.xml' } });
    expect(texto).toContain('Conflicto en pom.xml');
    expect(noEsClaveSinResolver(texto)).toBe(true);
  });

  it('spec_patch: parche de spec con título', () => {
    const texto = describeProposal({ kind: 'spec_patch', body: { title: 'Quitar feature obsoleta' } });
    expect(texto).toContain('Quitar feature obsoleta');
    expect(noEsClaveSinResolver(texto)).toBe(true);
  });

  it('plan_approval: con stats construye el resumen del plan (migrate/regen/skip)', () => {
    const texto = describeProposal({
      kind: 'plan_approval',
      body: { editClass: 'generalización', plan: { stats: { migrate: 2, regen: 1, skip: 0, likelyConflict: 1 } } },
    });
    expect(texto).toContain('generalización');
    expect(texto).toContain('2');
    expect(noEsClaveSinResolver(texto)).toBe(true);
  });

  it('plan_approval: sin acciones en el plan dice "sin acciones", no se queda en blanco', () => {
    const texto = describeProposal({
      kind: 'plan_approval',
      body: { plan: { stats: { migrate: 0, regen: 0, skip: 0, likelyConflict: 0 } } },
    });
    expect(noEsClaveSinResolver(texto)).toBe(true);
  });

  it('test_review: todos los productos en verde', () => {
    const texto = describeProposal({
      kind: 'test_review',
      body: { perProduct: [{ passed: true }, { passed: true }] },
    });
    expect(texto).toContain('2');
    expect(noEsClaveSinResolver(texto)).toBe(true);
  });

  it('test_review: con fallos muestra el recuento real, no "todo verde"', () => {
    const texto = describeProposal({
      kind: 'test_review',
      body: { perProduct: [{ passed: true }, { passed: false }] },
    });
    expect(texto).toContain('1/2');
  });

  it('un kind desconocido cae al título, y si tampoco hay título al propio kind', () => {
    expect(describeProposal({ kind: 'algo-nuevo', body: { title: 'Mi propuesta' } })).toBe('Mi propuesta');
    expect(describeProposal({ kind: 'algo-nuevo', body: {} })).toBe('algo-nuevo');
  });
});

describe('pendingProposal', () => {
  it('devuelve la primera propuesta sin decisión', () => {
    const decidida = { _id: 'p1', decision: 'approved' };
    const pendiente = { _id: 'p2', decision: null };
    expect(pendingProposal({ proposals: [decidida, pendiente] })).toBe(pendiente);
  });

  it('si todas están decididas, no hay ninguna pendiente', () => {
    expect(pendingProposal({ proposals: [{ decision: 'approved' }] })).toBeNull();
  });

  it('sin propuestas o sin run no revienta', () => {
    expect(pendingProposal({ proposals: [] })).toBeNull();
    expect(pendingProposal(null)).toBeNull();
  });
});

describe('pauseReasonMeta', () => {
  const RAZONES = ['blast_radius', 'critical', 'ambiguous', 'mode'];

  it.each(RAZONES)('resuelve etiqueta y pista reales (no la clave i18n) para "%s"', (razon) => {
    const meta = pauseReasonMeta(razon);
    expect(meta).not.toBeNull();
    expect(noEsClaveSinResolver(meta.label)).toBe(true);
    expect(noEsClaveSinResolver(meta.hint)).toBe(true);
    expect(meta.icon).toMatch(/^pi pi-/);
  });

  it('una razón desconocida no revienta la pantalla: no hay meta que pintar', () => {
    expect(pauseReasonMeta('no-existe')).toBeNull();
    expect(pauseReasonMeta(undefined)).toBeNull();
  });
});
