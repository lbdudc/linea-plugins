import { describe, expect, it } from 'vitest';

import { deriveMatrixRows, overrideOf } from '../../../../../../client/agents/components/consoles/consolidacion/productMatrix.js';

describe('overrideOf', () => {
  it('sin override guardado, "include" por defecto', () => {
    expect(overrideOf({}, 'p1')).toBe('include');
    expect(overrideOf(undefined, 'p1')).toBe('include');
  });

  it('con override guardado, lo devuelve', () => {
    expect(overrideOf({ p1: 'skip' }, 'p1')).toBe('skip');
  });
});

describe('deriveMatrixRows', () => {
  const cascade = [
    { productId: 'p1', action: 'migrate' },
    { productId: 'p2', action: 'skip' },
    { productId: 'p3', action: 'regen' },
  ];

  it('en modo planning nunca hay outcomeKind — el operador todavía no ha decidido nada', () => {
    const rows = deriveMatrixRows({ cascade, childRunsById: {}, overrides: { p1: 'defer' }, mode: 'planning' });
    expect(rows.every((r) => r.outcomeKind === null)).toBe(true);
  });

  it('override "defer" gana en modo cascading/done, con independencia de la action planeada', () => {
    const rows = deriveMatrixRows({ cascade, childRunsById: {}, overrides: { p1: 'defer' }, mode: 'cascading' });
    expect(rows.find((r) => r.productId === 'p1').outcomeKind).toBe('deferred');
  });

  it('override "skip" o action "skip" del plan dan "skipped"', () => {
    const rows = deriveMatrixRows({ cascade, childRunsById: {}, overrides: { p3: 'skip' }, mode: 'cascading' });
    expect(rows.find((r) => r.productId === 'p2').outcomeKind).toBe('skipped');
    expect(rows.find((r) => r.productId === 'p3').outcomeKind).toBe('skipped');
  });

  it('sin defer/skip, con run hijo vivo, "child"', () => {
    const childRunsById = { p1: { _id: 'r1', status: 'running' } };
    const rows = deriveMatrixRows({ cascade, childRunsById, overrides: {}, mode: 'cascading' });
    const row = rows.find((r) => r.productId === 'p1');
    expect(row.outcomeKind).toBe('child');
    expect(row.child._id).toBe('r1');
  });

  it('sin defer/skip y sin run hijo todavía, null (aún no ha arrancado)', () => {
    const rows = deriveMatrixRows({ cascade, childRunsById: {}, overrides: {}, mode: 'cascading' });
    expect(rows.find((r) => r.productId === 'p1').outcomeKind).toBeNull();
  });

  it('conserva los campos originales de la entrada del plan', () => {
    const rows = deriveMatrixRows({ cascade, childRunsById: {}, overrides: {}, mode: 'done' });
    expect(rows[0]).toMatchObject({ productId: 'p1', action: 'migrate' });
  });
});
