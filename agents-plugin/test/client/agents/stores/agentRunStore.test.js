import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunStore, awaitingApprovalCount } from '../../../../client/agents/stores/agentRunStore.js';

const run = (overrides) => ({
  _id: 'r-' + Math.random().toString(36).slice(2),
  status: 'running',
  steps: [],
  ...overrides,
});

beforeEach(() => {
  agentRunStore.setAll([]);
});

describe('upsert', () => {
  it('añade un run nuevo al principio de la lista', () => {
    agentRunStore.setAll([run({ _id: 'a' })]);
    agentRunStore.upsert(run({ _id: 'b' }));
    expect(agentRunStore.runs.map((r) => r._id)).toEqual(['b', 'a']);
  });

  it('si el run ya existe, lo mezcla en su sitio en vez de duplicarlo', () => {
    agentRunStore.setAll([run({ _id: 'a', status: 'running' }), run({ _id: 'b', status: 'running' })]);
    agentRunStore.upsert({ _id: 'a', status: 'done' });
    expect(agentRunStore.runs).toHaveLength(2);
    const a = agentRunStore.runs.find((r) => r._id === 'a');
    expect(a.status).toBe('done');
    expect(a.steps).toEqual([]);
  });
});

describe('mergeStep', () => {
  it('añade un paso nuevo y actualiza el status del run', () => {
    agentRunStore.setAll([run({ _id: 'a', status: 'running', steps: [] })]);
    agentRunStore.mergeStep('a', 'awaiting_approval', { _id: 's1', name: 'harvest' });
    const a = agentRunStore.runs.find((r) => r._id === 'a');
    expect(a.status).toBe('awaiting_approval');
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0]).toEqual({ _id: 's1', name: 'harvest' });
  });

  it('un paso con el mismo _id se sustituye, no se duplica', () => {
    agentRunStore.setAll([run({ _id: 'a', steps: [{ _id: 's1', name: 'v1' }] })]);
    agentRunStore.mergeStep('a', 'running', { _id: 's1', name: 'v2' });
    const a = agentRunStore.runs.find((r) => r._id === 'a');
    expect(a.steps).toHaveLength(1);
    expect(a.steps[0].name).toBe('v2');
  });

  it('sin status (undefined) conserva el status que ya tenía el run', () => {
    agentRunStore.setAll([run({ _id: 'a', status: 'running', steps: [] })]);
    agentRunStore.mergeStep('a', undefined, { _id: 's1' });
    expect(agentRunStore.runs.find((r) => r._id === 'a').status).toBe('running');
  });

  it('un runId que no existe en el store no revienta ni añade nada', () => {
    agentRunStore.setAll([run({ _id: 'a' })]);
    expect(() => agentRunStore.mergeStep('no-existe', 'done', { _id: 's1' })).not.toThrow();
    expect(agentRunStore.runs).toHaveLength(1);
  });
});

describe('remove', () => {
  it('borra el run indicado', () => {
    agentRunStore.setAll([run({ _id: 'a' }), run({ _id: 'b' })]);
    agentRunStore.remove('a');
    expect(agentRunStore.runs.map((r) => r._id)).toEqual(['b']);
  });

  it('borra un hijo directo junto con su padre', () => {
    agentRunStore.setAll([
      run({ _id: 'padre', parentRunId: null }),
      run({ _id: 'hijo', parentRunId: 'padre' }),
      run({ _id: 'ajeno', parentRunId: null }),
    ]);
    agentRunStore.remove('padre');
    expect(agentRunStore.runs.map((r) => r._id)).toEqual(['ajeno']);
  });

  it('borra descendientes de forma transitiva (nieto incluido)', () => {
    agentRunStore.setAll([
      run({ _id: 'abuelo', parentRunId: null }),
      run({ _id: 'padre', parentRunId: 'abuelo' }),
      run({ _id: 'nieto', parentRunId: 'padre' }),
      run({ _id: 'bisnieto', parentRunId: 'nieto' }),
      run({ _id: 'ajeno', parentRunId: null }),
    ]);
    agentRunStore.remove('abuelo');
    expect(agentRunStore.runs.map((r) => r._id)).toEqual(['ajeno']);
  });

  it('el borrado transitivo funciona aunque los descendientes salgan antes que sus padres en la lista', () => {
    agentRunStore.setAll([
      run({ _id: 'nieto', parentRunId: 'padre' }),
      run({ _id: 'abuelo', parentRunId: null }),
      run({ _id: 'padre', parentRunId: 'abuelo' }),
    ]);
    agentRunStore.remove('abuelo');
    expect(agentRunStore.runs).toEqual([]);
  });

  it('compara los ids como texto (parentRunId puede llegar como ObjectId, no como string)', () => {
    agentRunStore.setAll([
      run({ _id: 'padre', parentRunId: null }),
      run({ _id: 'hijo', parentRunId: { toString: () => 'padre' } }),
    ]);
    agentRunStore.remove('padre');
    expect(agentRunStore.runs).toEqual([]);
  });
});

describe('awaitingApprovalCount', () => {
  it('cuenta solo los runs en awaiting_approval', () => {
    agentRunStore.setAll([
      run({ _id: 'a', status: 'awaiting_approval' }),
      run({ _id: 'b', status: 'running' }),
      run({ _id: 'c', status: 'awaiting_approval' }),
    ]);
    expect(awaitingApprovalCount.value).toBe(2);
  });

  it('baja tras borrar un run en awaiting_approval junto con su árbol', () => {
    agentRunStore.setAll([
      run({ _id: 'padre', status: 'done', parentRunId: null }),
      run({ _id: 'hijo', status: 'awaiting_approval', parentRunId: 'padre' }),
    ]);
    expect(awaitingApprovalCount.value).toBe(1);
    agentRunStore.remove('padre');
    expect(awaitingApprovalCount.value).toBe(0);
  });
});
