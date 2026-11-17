import { describe, expect, it } from 'vitest';

import { buildApprovalMeta, deriveMatrixMode } from '../../../../../../client/agents/components/consoles/consolidacion/changesetApproval.js';

describe('deriveMatrixMode', () => {
  it('con propuesta plan_approval pendiente, planning — gana a cualquier status', () => {
    expect(deriveMatrixMode({ hasPendingPlanProposal: true, runStatus: 'done' })).toBe('planning');
  });

  it('sin propuesta pendiente y status terminal, done', () => {
    expect(deriveMatrixMode({ hasPendingPlanProposal: false, runStatus: 'done' })).toBe('done');
    expect(deriveMatrixMode({ hasPendingPlanProposal: false, runStatus: 'failed' })).toBe('done');
    expect(deriveMatrixMode({ hasPendingPlanProposal: false, runStatus: 'cancelled' })).toBe('done');
  });

  it('sin propuesta pendiente y status en marcha, cascading', () => {
    expect(deriveMatrixMode({ hasPendingPlanProposal: false, runStatus: 'running' })).toBe('cascading');
    expect(deriveMatrixMode({ hasPendingPlanProposal: false, runStatus: 'awaiting_child' })).toBe('cascading');
  });
});

describe('buildApprovalMeta', () => {
  it('sin overrides ni autonomía por producto, overrides queda undefined y perProduct vacío', () => {
    const meta = buildApprovalMeta({ overrides: {}, autonomyDefault: 'semi', autonomyPerProduct: {} });
    expect(meta).toEqual({ overrides: undefined, autonomy: { default: 'semi', perProduct: {} } });
  });

  it('un override en "include" (el valor por defecto) no cuenta como cambio', () => {
    const meta = buildApprovalMeta({ overrides: { p1: 'include' }, autonomyDefault: 'semi', autonomyPerProduct: {} });
    expect(meta.overrides).toBeUndefined();
  });

  it('overrides distintos de "include" sí viajan', () => {
    const meta = buildApprovalMeta({
      overrides: { p1: 'defer', p2: 'skip', p3: 'include' },
      autonomyDefault: 'semi',
      autonomyPerProduct: {},
    });
    expect(meta.overrides).toEqual({ p1: 'defer', p2: 'skip' });
  });

  it('autonomía por producto igual al default global no cuenta como override', () => {
    const meta = buildApprovalMeta({ overrides: {}, autonomyDefault: 'semi', autonomyPerProduct: { p1: 'semi' } });
    expect(meta.autonomy.perProduct).toEqual({});
  });

  it('autonomía por producto distinta del default sí viaja', () => {
    const meta = buildApprovalMeta({
      overrides: {},
      autonomyDefault: 'semi',
      autonomyPerProduct: { p1: 'manual', p2: 'semi', p3: 'automatic' },
    });
    expect(meta.autonomy).toEqual({ default: 'semi', perProduct: { p1: 'manual', p3: 'automatic' } });
  });
});
