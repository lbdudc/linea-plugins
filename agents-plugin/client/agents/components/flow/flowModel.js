
/**
 * Pure derivation for the Flow hub — the "round trip" overview at the top of the
 * Agents page (see FlowHub.vue). Takes the same raw data every pipeline console
 * already reads (runs from the shared agentRunStore, ChangesetVersion rows,
 * HarvestDisposition rows) and reduces it to three stage summaries:
 *
 *   1. divergence  — what changed in each product, off the SPL (Variant Miner + Harvest)
 *   2. intoSpl     — how it's merging into the line (Harvest proposals + Change Sets)
 *   3. propagation — what gets reimplemented in each product from the SPL (Change Set cascade)
 *
 * No Vue, no API calls, no i18n — everything here is plain data in, plain data out,
 * so it can be unit-tested without mounting a component. FlowHub.vue calls
 * `deriveFlow` inside a `computed`.
 */

const byCreatedDesc = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

/** A disposition suppresses its candidate while active: dismissed / manually-harvested
 * always; snoozed only until its date passes. Mirrors HarvestConsole's `isSuppressing`. */
export const isDispositionSuppressing = (d) => {
  if (d.state === 'snoozed') return Boolean(d.snoozeUntil) && new Date(d.snoozeUntil) > new Date();
  return d.state === 'dismissed' || d.state === 'manually-harvested';
};

/** Pull a changeset run's plan out of wherever it currently lives — the pending
 * `plan_approval` proposal while awaiting a decision, or the persisted result
 * ledger once decided. Mirrors ChangeSetPlanApproval's `plan` computed. */
export const extractChangesetPlan = (run) => {
  const planProposal = (run?.proposals ?? []).find((p) => p.kind === 'plan_approval');
  return planProposal?.body?.plan ?? run?.result?.ledger?.plan ?? null;
};

const ACTIVE_STATUSES = ['queued', 'running', 'awaiting_approval', 'awaiting_child', 'awaiting_external'];
const isActive = (run) => ACTIVE_STATUSES.includes(run?.status);

/**
 * @param {object} input
 * @param {Array}  input.runs         all runs in scope (agentRunStore.runs, already
 *                                     filtered or not — this function filters by lineId itself)
 * @param {Array}  input.versions     ChangesetVersion rows for the line
 * @param {Array}  input.dispositions HarvestDisposition rows for the line
 * @param {string|null} input.lineId  the selected line — when null, every stage is empty
 */
export const deriveFlow = ({ runs = [], versions = [], dispositions = [], lineId = null } = {}) => {
  const sameLine = (r) => Boolean(lineId) && String(r.scope?.lineId ?? '') === String(lineId);
  const lineRuns = lineId ? runs.filter(sameLine) : [];

  // ── 1. Divergence — Variant Miner's latest scan + open Harvest candidates ─────
  const minerRuns = lineRuns.filter((r) => r.agentType === 'variant-miner').sort(byCreatedDesc);
  const latestMiner = minerRuns[0] ?? null;
  const minerScanning = isActive(latestMiner) && ['queued', 'running'].includes(latestMiner?.status);

  const suppressedSignatures = new Set(dispositions.filter(isDispositionSuppressing).map((d) => d.signature));
  // Products already past the candidate stage (a harvest run already exists for them)
  // shouldn't double-count as "still diverged" the way HarvestConsole excludes them.
  const harvestedProductIds = new Set(
    lineRuns.filter((r) => r.agentType === 'harvest').map((r) => String(r.scope?.productId ?? '')).filter(Boolean)
  );
  const openCandidates = (latestMiner?.result?.candidates ?? [])
    .filter((c) => !suppressedSignatures.has(c.signature))
    .filter((c) => !harvestedProductIds.has(String(c.representativeProductId ?? '')));

  const corroborated = openCandidates.filter((c) => c.corroborated ?? (c.productCount ?? 1) >= 2).length;
  const driftedProductIds = new Set();
  for (const c of openCandidates) {
    for (const pid of c.productIds ?? (c.representativeProductId ? [c.representativeProductId] : [])) {
      driftedProductIds.add(String(pid));
    }
  }

  const divergence = {
    candidates: openCandidates.length,
    corroborated,
    productsDrifted: driftedProductIds.size,
    latestMinerRun: latestMiner,
    minerScanning,
    // Kept (not just the count) so the product table can show per-product divergence
    // without re-deriving the suppression/harvested-exclusion logic above.
    openCandidates,
  };

  // ── 2. Into the SPL — Harvest proposals awaiting a decision + Change Set status ─
  const harvestRuns = lineRuns.filter((r) => r.agentType === 'harvest');
  const harvestAwaiting = harvestRuns.filter((r) => r.status === 'awaiting_approval').length;
  const harvestOpen = harvestRuns.filter(isActive).length;

  const lineVersions = lineId ? versions.filter((v) => String(v.lineId ?? '') === String(lineId)) : [];
  const versionsByStatus = lineVersions.reduce((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});
  // "Active" work-in-progress versions — not yet merged or archived.
  const activeVersion = lineVersions
    .filter((v) => v.status === 'draft' || v.status === 'sandbox' || v.status === 'testing')
    .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))[0] ?? null;

  const intoSpl = {
    harvestAwaiting,
    harvestOpen,
    activeVersion,
    versionsByStatus,
    versionsOpen: (versionsByStatus.draft ?? 0) + (versionsByStatus.sandbox ?? 0) + (versionsByStatus.testing ?? 0),
  };

  // ── 3. Propagation — the active Change Set's cascade (migrate/regen/skip per product) ─
  const changesetRuns = lineRuns
    .filter((r) => r.agentType === 'changeset' && !r.parentRunId)
    .sort(byCreatedDesc);
  // Prefer a run still in flight over the most recent terminal one, so the stage
  // reflects what the operator needs to act on right now.
  const activeChangesetRun = changesetRuns.find(isActive) ?? changesetRuns[0] ?? null;
  const plan = extractChangesetPlan(activeChangesetRun);
  const rawCascade = plan?.cascade ?? [];

  // The plan is a snapshot taken when the Change Set was approved — it has no idea
  // whether the product has since actually been regenerated/migrated. Originally this
  // only looked at the specific regen/evolution child *this changeset* spawned (via
  // parentRunId), but that's too narrow: a product can just as well get fixed by a
  // plain "Re-run" from the Sync console, or by a later Sync Line batch — none of
  // which are children of this changeset run, yet they equally satisfy the cascade's
  // requirement. Reconcile against the latest run of the relevant type for the
  // product instead, regardless of who spawned it — same "latest wins" approach
  // SyncConsole's regenForProduct already uses, so the two views can't drift apart
  // on the same product. `result.conflicts` mirrors Sync's `hasConflicts`: the run
  // finished but still needs attention, so it isn't "completed" either.
  const actionAgentType = (action) => (action === 'migrate' ? 'evolution' : 'regen');
  const latestActionRun = (productId, action) =>
    lineRuns
      .filter((r) => r.agentType === actionAgentType(action) && String(r.scope?.productId ?? '') === String(productId))
      .sort(byCreatedDesc)[0] ?? null;

  const cascade = rawCascade.map((c) => {
    const child = latestActionRun(c.productId, c.action);
    if (!child) return { ...c, childStatus: null, completed: false, childFailed: false, childNeedsReview: false };
    const childNeedsReview = child.status === 'done' && Boolean(child.result?.conflicts);
    const childFailed = child.status === 'failed' || child.status === 'cancelled';
    return { ...c, childStatus: child.status, completed: child.status === 'done' && !childNeedsReview, childFailed, childNeedsReview };
  });

  // Stats reflect what's still actually outstanding, not what the plan originally
  // called for — so the stage card stops saying "2 regen" once those two are done.
  const outstanding = cascade.filter((c) => c.action !== 'skip' && !c.completed);
  const stats = {
    migrate: outstanding.filter((c) => c.action === 'migrate').length,
    regen: outstanding.filter((c) => c.action === 'regen').length,
    skip: cascade.filter((c) => c.action === 'skip').length,
    likelyConflict: outstanding.filter((c) => c.likely_conflict).length,
    critical: outstanding.filter((c) => c.isCritical).length,
  };

  const propagation = {
    cascade,
    stats,
    activeRun: activeChangesetRun,
    editClass: plan?.editClass ?? activeChangesetRun?.result?.editClass ?? null,
  };

  return { divergence, intoSpl, propagation };
};
