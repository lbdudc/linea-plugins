const STATUS_COLOR_VAR = {
  queued: '--p-text-dim-color',
  running: '--p-agent-color',
  awaiting_approval: '--status-warn-solid',
  awaiting_child: '--p-agent-hover-color',
  awaiting_external: '--status-serious',
  done: '--status-ok-solid',
  failed: '--status-bad-solid',
  cancelled: '--p-text-faint-color',
};

export const statusColorVar = (status) => STATUS_COLOR_VAR[status] ?? '--p-text-dim-color';
