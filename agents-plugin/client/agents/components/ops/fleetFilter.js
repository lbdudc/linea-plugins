
export function filterFleetRuns(runs, { agentType = null, status = null } = {}) {
  const lista = Array.isArray(runs) ? runs : [];
  return lista.filter(
    (r) => (!agentType || r.agentType === agentType) && (!status || r.status === status),
  );
}

export function uniqueAgentTypes(runs) {
  return [...new Set((Array.isArray(runs) ? runs : []).map((r) => r.agentType))];
}

export function uniqueStatuses(runs) {
  return [...new Set((Array.isArray(runs) ? runs : []).map((r) => r.status))];
}
