export const STEP_ORDER = [
  'plan',
  'approve-plan',
  'sandbox',
  'merge-branch',
  'propagate-features',
  'cascade',
  'verify',
  'test',
  'approve-tests',
  'deploy',
  'record',
];

const RERUNNABLE_STATUSES = ['done', 'failed', 'cancelled', 'awaiting_approval'];

export function canRerun(runStatus) {
  return RERUNNABLE_STATUSES.includes(runStatus);
}

export function buildPhases(steps) {
  const byName = Object.fromEntries((steps ?? []).map((s) => [s.name, s]));
  return STEP_ORDER.map((name) => {
    const live = byName[name];
    return {
      name,
      status: live?.status ?? 'pending',
      kind: live?.kind ?? null,
      durationMs: live?.durationMs ?? null,
      error: live?.error ?? null,
    };
  });
}

export function fmtDuration(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
