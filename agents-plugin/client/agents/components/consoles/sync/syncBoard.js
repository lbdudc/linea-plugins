
const byCreatedDesc = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

export function isUnderChangeset(run, runsById) {
  let cursor = run;
  const seen = new Set();
  while (cursor?.parentRunId && !seen.has(String(cursor._id))) {
    seen.add(String(cursor._id));
    const parent = runsById[String(cursor.parentRunId)];
    if (!parent) return false;
    if (parent.agentType === 'changeset') return true;
    cursor = parent;
  }
  return false;
}

export function filterLineRuns(runs, lineId) {
  const lista = Array.isArray(runs) ? runs : [];
  const runsById = Object.fromEntries(lista.map((r) => [String(r._id), r]));
  const sameLine = (r) => String(r.scope?.lineId ?? '') === String(lineId ?? '');
  return lista.filter((r) => sameLine(r) && !isUnderChangeset(r, runsById));
}

export function latestOfType(lineRuns, type, productId) {
  return (
    lineRuns
      .filter((r) => r.agentType === type && String(r.scope?.productId ?? '') === String(productId))
      .sort(byCreatedDesc)[0] ?? null
  );
}

export function regenForProduct(lineRuns, productId) {
  return latestOfType(lineRuns, 'regen', productId);
}

export function syncForProduct(lineRuns, productId) {
  const runs = lineRuns
    .filter((r) => r.agentType === 'sync' && String(r.scope?.productId ?? '') === String(productId))
    .sort(byCreatedDesc);
  return runs.find((r) => r.status === 'awaiting_approval') ?? runs[0] ?? null;
}

export function relevantRun(lineRuns, productId, hasUnresolvedConflicts) {
  const regen = regenForProduct(lineRuns, productId);
  const sync = syncForProduct(lineRuns, productId);
  if (regen && ['queued', 'running'].includes(regen.status)) return regen;
  if (sync) {
    if (sync.status === 'awaiting_approval') return sync;
    if (['queued', 'running', 'awaiting_child'].includes(sync.status)) return sync;
    if (hasUnresolvedConflicts(sync)) return sync;
  }
  return regen ?? sync;
}

export function productState(lineRuns, productId, hasUnresolvedConflicts) {
  const regen = regenForProduct(lineRuns, productId);
  const sync = syncForProduct(lineRuns, productId);
  if (regen && ['queued', 'running'].includes(regen.status)) return 'regenerating';
  if (sync) {
    if (sync.status === 'awaiting_approval') return 'conflict';
    if (['queued', 'running', 'awaiting_child'].includes(sync.status)) return 'resolving';
    if (hasUnresolvedConflicts(sync)) return 'conflict';
  }
  if (regen) {
    if (regen.status === 'failed') return 'failed';
    if (regen.result?.conflicts) return 'conflict';
    if (regen.status === 'done') return 'clean';
  }
  return 'idle';
}

export function buildBoardBuckets(products, lineRuns, hasUnresolvedConflicts) {
  const buckets = { idle: [], regenerating: [], conflict: [], clean: [], failed: [] };
  for (const p of Array.isArray(products) ? products : []) {
    const st = productState(lineRuns, p._id, hasUnresolvedConflicts);
    const key = st === 'resolving' ? 'conflict' : st;
    (buckets[key] ?? buckets.idle).push(p);
  }
  return buckets;
}

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

export function canRetryResolver(lineRuns, productId) {
  const s = syncForProduct(lineRuns, productId);
  if (!s || !TERMINAL_STATUSES.includes(s.status)) return false;
  return s.result?.hasConflicts !== false;
}
