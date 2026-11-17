import { i18n } from '../../boot/i18n.js';

const STATUS_LABEL_KEY = {
  queued: 'labels.status_queued',
  running: 'labels.status_running',
  awaiting_approval: 'labels.status_awaiting_approval',
  awaiting_child: 'labels.status_awaiting_child',
  awaiting_external: 'labels.status_awaiting_external',
  done: 'labels.status_done',
  failed: 'labels.status_failed',
  cancelled: 'labels.status_cancelled',
};

const statusLabel = (status) => (STATUS_LABEL_KEY[status] ? i18n.global.t(STATUS_LABEL_KEY[status]) : undefined);

const STATUS_BUCKET = {
  queued: 'run',
  running: 'run',
  awaiting_child: 'run',
  awaiting_external: 'run',
  awaiting_approval: 'wait',
  done: 'done',
  failed: 'fail',
  cancelled: 'fail',
};

export const BUCKET_STYLE = {
  run: { dot: 'var(--p-agent-color)', fg: 'var(--p-agent-color)', bg: 'var(--p-agent-highlight)' },
  wait: { dot: 'var(--status-warn-solid)', fg: 'var(--status-warn-solid)', bg: 'var(--status-warn-soft)' },
  done: { dot: 'var(--status-ok-solid)', fg: 'var(--p-text-muted-color)', bg: 'var(--status-ok-soft)' },
  fail: { dot: 'var(--status-bad-solid)', fg: 'var(--status-bad-strong)', bg: 'var(--status-bad-soft)' },
};

export const hasUnresolvedConflicts = (run) =>
  run?.agentType === 'sync' && run.status === 'done' && run.result?.hasConflicts === true;

export const hasBlockedHarvest = (run) =>
  run?.agentType === 'harvest' && run.status === 'done' && run.result?.blocked === true;

export const runBucket = (run) => {
  if (hasUnresolvedConflicts(run) || hasBlockedHarvest(run)) return 'fail';
  return STATUS_BUCKET[run?.status] ?? 'fail';
};

export const runStatusLabel = (run) => {
  if (hasUnresolvedConflicts(run)) return i18n.global.t('labels.run_unresolved_conflicts');
  if (hasBlockedHarvest(run)) return i18n.global.t('labels.run_harvest_blocked');
  return statusLabel(run?.status) ?? run?.status ?? '—';
};

export const runStatusStyle = (run) => BUCKET_STYLE[runBucket(run)];

export const BUCKETS = ['run', 'wait', 'done', 'fail'];

export const FILTRO_BUCKET = {
  activos: 'run',
  atencion: 'wait',
  fallidos: 'fail',
  hechos: 'done',
};
