import { describe, expect, it } from 'vitest';

import { buildChildRunsById, cascadeFailureVersionIds, hasCascadeFailures } from '../../../../../../client/agents/components/consoles/consolidacion/changesetCascade.js';

describe('buildChildRunsById', () => {
  it('sin rootRunId, objeto vacío', () => {
    expect(buildChildRunsById([{ _id: 'a' }], null)).toEqual({});
  });

  it('recoge los hijos directos indexados por producto', () => {
    const runs = [
      { _id: 'root' },
      { _id: 'c1', parentRunId: 'root', agentType: 'regen', scope: { productId: 'p1' }, status: 'done' },
      { _id: 'c2', parentRunId: 'root', agentType: 'regen', scope: { productId: 'p2' }, status: 'running' },
    ];
    const byProduct = buildChildRunsById(runs, 'root');
    expect(byProduct.p1._id).toBe('c1');
    expect(byProduct.p2._id).toBe('c2');
  });

  it('recorre nietos: un sync disparado por un regen hijo sigue apareciendo', () => {
    const runs = [
      { _id: 'root' },
      { _id: 'regen1', parentRunId: 'root', agentType: 'regen', scope: { productId: 'p1' }, status: 'done' },
      { _id: 'sync1', parentRunId: 'regen1', agentType: 'sync', scope: { productId: 'p1' }, status: 'awaiting_approval' },
    ];
    const byProduct = buildChildRunsById(runs, 'root');
    expect(byProduct.p1._id).toBe('sync1');
  });

  it('a igual prioridad, gana el run que está esperando aprobación', () => {
    const runs = [
      { _id: 'root' },
      { _id: 'r1', parentRunId: 'root', agentType: 'regen', scope: { productId: 'p1' }, status: 'done' },
      { _id: 'r2', parentRunId: 'root', agentType: 'regen', scope: { productId: 'p1' }, status: 'awaiting_approval' },
    ];
    const byProduct = buildChildRunsById(runs, 'root');
    expect(byProduct.p1._id).toBe('r2');
  });

  it('ignora runs sin productId de ámbito', () => {
    const runs = [{ _id: 'root' }, { _id: 'c1', parentRunId: 'root', agentType: 'regen', scope: {}, status: 'done' }];
    expect(buildChildRunsById(runs, 'root')).toEqual({});
  });

  it('no entra en bucle infinito ante un ciclo accidental de parentRunId', () => {
    const runs = [
      { _id: 'a', parentRunId: 'b', agentType: 'regen', scope: { productId: 'p1' }, status: 'done' },
      { _id: 'b', parentRunId: 'a', agentType: 'regen', scope: { productId: 'p1' }, status: 'done' },
    ];
    expect(() => buildChildRunsById(runs, 'a')).not.toThrow();
  });
});

describe('hasCascadeFailures', () => {
  it('sin failedProducts, false', () => {
    expect(hasCascadeFailures({})).toBe(false);
    expect(hasCascadeFailures(null)).toBe(false);
  });

  it('con al menos un producto fallido, true', () => {
    expect(hasCascadeFailures({ result: { cascade: { failedProducts: ['p1'] } } })).toBe(true);
  });
});

describe('cascadeFailureVersionIds', () => {
  it('marca solo las versiones cuyo runId apunta a un run con fallos de cascada', () => {
    const runs = [
      { _id: 'r1', result: { cascade: { failedProducts: ['p1'] } } },
      { _id: 'r2', result: { cascade: { failedProducts: [] } } },
    ];
    const versions = [
      { _id: 'v1', runId: 'r1' },
      { _id: 'v2', runId: 'r2' },
      { _id: 'v3', runId: null },
    ];
    expect(cascadeFailureVersionIds(versions, runs)).toEqual(new Set(['v1']));
  });
});
