import { describe, expect, it } from 'vitest';

import { allFeatures, buildComparisonMatrix, commonRows, diffRows, getFeatureSet } from '../../../../../../client/agents/components/consoles/salud/productComparison.js';

describe('getFeatureSet', () => {
  it('spec.features como array', () => {
    expect(getFeatureSet({ spec: { features: ['A', 'B'] } })).toEqual(new Set(['A', 'B']));
  });

  it('spec.features como objeto de booleanos (solo las activas)', () => {
    expect(getFeatureSet({ spec: { features: { A: true, B: false, C: true } } })).toEqual(new Set(['A', 'C']));
  });

  it('spec.selection como fallback cuando no hay spec.features', () => {
    expect(getFeatureSet({ spec: { selection: ['X'] } })).toEqual(new Set(['X']));
  });

  it('conjunto vacío sin datos', () => {
    expect(getFeatureSet({})).toEqual(new Set());
    expect(getFeatureSet(null)).toEqual(new Set());
  });
});

describe('allFeatures', () => {
  it('unión ordenada de todos los productos', () => {
    const products = [{ spec: { features: ['B', 'A'] } }, { spec: { features: ['C'] } }];
    expect(allFeatures(products)).toEqual(['A', 'B', 'C']);
  });
});

describe('buildComparisonMatrix / diffRows / commonRows', () => {
  const products = [
    { _id: 'p1', spec: { features: ['A', 'B'] } },
    { _id: 'p2', spec: { features: ['A'] } },
  ];
  const matrix = buildComparisonMatrix(products);

  it('marca differsAcross cuando no todos los productos coinciden', () => {
    const row = matrix.find((r) => r.feature === 'B');
    expect(row.differsAcross).toBe(true);
    expect(row.values).toEqual([true, false]);
  });

  it('no marca differsAcross cuando todos coinciden', () => {
    const row = matrix.find((r) => r.feature === 'A');
    expect(row.differsAcross).toBe(false);
  });

  it('diffRows solo trae las que difieren', () => {
    expect(diffRows(matrix).map((r) => r.feature)).toEqual(['B']);
  });

  it('commonRows solo trae las que todos tienen (no las que nadie tiene)', () => {
    expect(commonRows(matrix).map((r) => r.feature)).toEqual(['A']);
  });

  it('una característica desactivada en todos los productos ni siquiera aparece en la matriz', () => {
    const matrix2 = buildComparisonMatrix([
      { _id: 'p1', spec: { features: { A: true, B: false } } },
      { _id: 'p2', spec: { features: { A: true, B: false } } },
    ]);
    expect(matrix2.map((r) => r.feature)).toEqual(['A']);
    expect(commonRows(matrix2).map((r) => r.feature)).toEqual(['A']);
  });
});
