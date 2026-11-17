export const CHILD_PRIORITY = { sync: 4, evolution: 3, regen: 2, 'line-sync': 1 };

export function buildChildRunsById(runs, rootRunId) {
  if (!rootRunId) return {};
  const collected = new Map();
  const visit = (parentId, guard) => {
    if (guard.has(parentId)) return;
    guard.add(parentId);
    for (const r of runs ?? []) {
      if (r.parentRunId && String(r.parentRunId) === parentId) {
        collected.set(String(r._id), r);
        visit(String(r._id), guard);
      }
    }
  };
  visit(String(rootRunId), new Set());

  const byProduct = {};
  for (const r of collected.values()) {
    const pid = String(r.scope?.productId ?? '');
    if (!pid) continue;
    const current = byProduct[pid];
    const winsOver =
      !current ||
      (CHILD_PRIORITY[r.agentType] ?? 0) > (CHILD_PRIORITY[current.agentType] ?? 0) ||
      (r.status === 'awaiting_approval' && current.status !== 'awaiting_approval');
    if (winsOver) byProduct[pid] = r;
  }
  return byProduct;
}

export function hasCascadeFailures(run) {
  return (run?.result?.cascade?.failedProducts?.length ?? 0) > 0;
}

export function cascadeFailureVersionIds(versions, runs) {
  const failedRunIds = new Set((runs ?? []).filter(hasCascadeFailures).map((r) => String(r._id)));
  return new Set(
    (versions ?? [])
      .filter((v) => v.runId && failedRunIds.has(String(v.runId)))
      .map((v) => String(v._id)),
  );
}
