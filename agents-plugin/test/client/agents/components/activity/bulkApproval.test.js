import { describe, expect, it } from 'vitest';

import { isPendingRun, pendingRuns, staleIds } from '../../../../../client/agents/components/activity/bulkApproval.js';

describe('isPendingRun', () => {
  it('solo es true para awaiting_approval', () => {
    expect(isPendingRun({ status: 'awaiting_approval' })).toBe(true);
    expect(isPendingRun({ status: 'done' })).toBe(false);
    expect(isPendingRun({ status: 'running' })).toBe(false);
  });

  it('no revienta sin run', () => {
    expect(isPendingRun(null)).toBe(false);
    expect(isPendingRun(undefined)).toBe(false);
  });
});

describe('pendingRuns', () => {
  it('filtra solo los que esperan decisión', () => {
    const runs = [
      { _id: 'a', status: 'awaiting_approval' },
      { _id: 'b', status: 'done' },
      { _id: 'c', status: 'awaiting_approval' },
    ];
    expect(pendingRuns(runs).map((r) => r._id)).toEqual(['a', 'c']);
  });

  it('trata una lista ausente como vacía', () => {
    expect(pendingRuns(null)).toEqual([]);
    expect(pendingRuns(undefined)).toEqual([]);
  });
});

describe('staleIds', () => {
  it('detecta ids seleccionados que ya no están pendientes', () => {
    const seleccion = new Set(['a', 'b', 'c']);
    const runsActuales = [
      { _id: 'a', status: 'awaiting_approval' },
      { _id: 'b', status: 'done' },
    ];
    expect(staleIds(seleccion, runsActuales).sort()).toEqual(['b', 'c']);
  });

  it('no marca nada como obsoleto si todo sigue pendiente', () => {
    const seleccion = new Set(['a', 'b']);
    const runsActuales = [
      { _id: 'a', status: 'awaiting_approval' },
      { _id: 'b', status: 'awaiting_approval' },
    ];
    expect(staleIds(seleccion, runsActuales)).toEqual([]);
  });

  it('con selección vacía no hay nada que purgar', () => {
    expect(staleIds(new Set(), [{ _id: 'a', status: 'done' }])).toEqual([]);
  });
});
