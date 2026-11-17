
export function coveragePercent(healthSummary) {
  if (!healthSummary || healthSummary.total === 0) return null;
  return Math.round((healthSummary.valid / healthSummary.total) * 100);
}

export function computeRunStats(runs) {
  const lista = Array.isArray(runs) ? runs : [];
  const total = lista.length;
  const done = lista.filter((r) => r.status === 'done').length;
  const awaiting = lista.filter((r) => r.status === 'awaiting_approval').length;
  const failed = lista.filter((r) => r.status === 'failed').length;
  return { total, done, awaiting, failed };
}

export function formatDurationMs(ms) {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

export function recentRuns(runs, limit = 8) {
  return (Array.isArray(runs) ? runs : []).slice(0, limit);
}
