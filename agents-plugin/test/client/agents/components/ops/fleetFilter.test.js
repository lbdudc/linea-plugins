import { describe, expect, it } from 'vitest';

import { filterFleetRuns, uniqueAgentTypes, uniqueStatuses } from '../../../../../client/agents/components/ops/fleetFilter.js';

const RUNS = [
  { _id: '1', agentType: 'sync', status: 'running' },
  { _id: '2', agentType: 'sync', status: 'done' },
  { _id: '3', agentType: 'harvest', status: 'awaiting_approval' },
  { _id: '4', agentType: 'regen', status: 'failed' },
];

describe('filterFleetRuns', () => {
  it('sin filtros devuelve la flota completa, en el mismo orden', () => {
    expect(filterFleetRuns(RUNS)).toEqual(RUNS);
    expect(filterFleetRuns(RUNS, {})).toEqual(RUNS);
  });

  it('filtra por agentType exacto', () => {
    const filas = filterFleetRuns(RUNS, { agentType: 'sync' });
    expect(filas.map((r) => r._id)).toEqual(['1', '2']);
  });

  it('filtra por status exacto', () => {
    const filas = filterFleetRuns(RUNS, { status: 'failed' });
    expect(filas.map((r) => r._id)).toEqual(['4']);
  });

  it('combina agente + estado (AND, no OR)', () => {
    expect(filterFleetRuns(RUNS, { agentType: 'sync', status: 'done' }).map((r) => r._id)).toEqual(['2']);
    expect(filterFleetRuns(RUNS, { agentType: 'sync', status: 'failed' })).toEqual([]);
  });

  it('un valor que no coincide con ninguna fila vacía la tabla', () => {
    expect(filterFleetRuns(RUNS, { agentType: 'changeset' })).toEqual([]);
  });

  it('tolera runs no-array (todavía sin cargar)', () => {
    expect(filterFleetRuns(undefined)).toEqual([]);
    expect(filterFleetRuns(null, { agentType: 'sync' })).toEqual([]);
  });
});

describe('uniqueAgentTypes / uniqueStatuses', () => {
  it('un valor por cada agentType/status distinto presente, sin catálogo fijo', () => {
    expect(uniqueAgentTypes(RUNS)).toEqual(['sync', 'harvest', 'regen']);
    expect(uniqueStatuses(RUNS)).toEqual(['running', 'done', 'awaiting_approval', 'failed']);
  });

  it('un agente sin ejecuciones no aparece', () => {
    expect(uniqueAgentTypes(RUNS)).not.toContain('evolution');
  });

  it('lista vacía si no hay runs', () => {
    expect(uniqueAgentTypes([])).toEqual([]);
    expect(uniqueStatuses(undefined)).toEqual([]);
  });
});
