
export function isSuppressingDisposition(disposition, now = new Date()) {
  if (!disposition) return false;
  if (disposition.state === 'snoozed') {
    return Boolean(disposition.snoozeUntil) && new Date(disposition.snoozeUntil) > now;
  }
  return disposition.state === 'dismissed' || disposition.state === 'manually-harvested';
}

export function suppressedSignatures(dispositions, now = new Date()) {
  return new Set(
    (dispositions ?? []).filter((d) => isSuppressingDisposition(d, now)).map((d) => d.signature),
  );
}

export function resolvedDispositions(dispositions, now = new Date()) {
  return (dispositions ?? []).filter((d) => isSuppressingDisposition(d, now));
}

export function launchedProductIds(harvestRuns) {
  return new Set(
    (harvestRuns ?? [])
      .filter((r) => r.status !== 'cancelled')
      .map((r) => String(r.scope?.productId ?? '')),
  );
}

export function filterCandidates({
  candidates,
  launchedIds = new Set(),
  suppressedSigs = new Set(),
  filterTypes = [],
  minCorroboration = 1,
}) {
  return (candidates ?? [])
    .filter((c) => !launchedIds.has(String(c.representativeProductId ?? '')))
    .filter((c) => !suppressedSigs.has(c.signature))
    .filter((c) => !filterTypes.length || filterTypes.includes(c.suggestedType))
    .filter((c) => (c.productCount ?? 1) >= minCorroboration);
}

export function groupHarvestRunsByColumn(harvestRuns) {
  const runs = harvestRuns ?? [];
  return {
    proposed: runs.filter((r) => ['queued', 'running'].includes(r.status)),
    review: runs.filter((r) => r.status === 'awaiting_approval'),
    merged: runs.filter((r) => ['done', 'failed', 'cancelled'].includes(r.status)),
  };
}

export function runProductNameParts(run) {
  const step = [...(run.steps ?? [])].reverse().find((s) => s.name === 'detect-changes' && s.outputSummary);
  const productName = step?.outputSummary?.productName ?? null;
  const productId = run.scope?.productId ?? null;
  return { productName, productId };
}

export function runChangeType(run) {
  if (run.result?.changeType) return run.result.changeType;
  const withType = (run.proposals ?? []).find((p) => p.body?.changeType);
  if (withType) return withType.body.changeType;
  const step = [...(run.steps ?? [])].reverse().find((s) => s.outputSummary?.changeType);
  return step?.outputSummary?.changeType ?? null;
}

export function hasReviewProposal(run) {
  return (run.proposals ?? []).some(
    (p) =>
      !p.decision &&
      ((p.kind === 'fm_patch' && (p.body?.fileEdits?.length || p.body?.newModelUvl)) ||
        (p.kind === 'merge_resolution' && p.body?.fileEdits?.length)),
  );
}

export function runSignature(run) {
  return run.input?.steering?.signature ?? null;
}

export function isMergedRun(run) {
  return Boolean(run.input?.merge);
}

export function mergeSourceCount(run) {
  return (run.input?.merge?.sourceRunIds ?? []).length;
}

export function canSplitMergedRun(run) {
  return isMergedRun(run) && run.status !== 'done';
}

export function isMergeableReviewRun(run) {
  return run.status === 'awaiting_approval' && !isMergedRun(run);
}

export function riskParts(risk) {
  if (!risk) return [];
  const parts = [];
  if (risk.highTouch?.length) parts.push({ kind: 'highTouch', files: risk.highTouch });
  if (risk.sharedWith) parts.push({ kind: 'sharedWith', n: risk.sharedWith });
  return parts;
}
