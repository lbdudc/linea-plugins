
export function isPendingRun(run) {
  return run?.status === 'awaiting_approval';
}

export function pendingRuns(runs) {
  return (runs ?? []).filter(isPendingRun);
}

export function staleIds(idSet, runs) {
  const vivos = new Set(pendingRuns(runs).map((r) => r._id));
  return [...idSet].filter((id) => !vivos.has(id));
}
