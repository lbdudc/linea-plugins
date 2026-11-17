const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];

export function deriveMatrixMode({ hasPendingPlanProposal, runStatus }) {
  if (hasPendingPlanProposal) return 'planning';
  if (TERMINAL_STATUSES.includes(runStatus)) return 'done';
  return 'cascading';
}

export function buildApprovalMeta({ overrides, autonomyDefault, autonomyPerProduct }) {
  const nonDefaultOverrides = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, v]) => v !== 'include'),
  );
  const nonDefaultAutonomy = Object.fromEntries(
    Object.entries(autonomyPerProduct ?? {}).filter(([, v]) => v !== autonomyDefault),
  );
  return {
    overrides: Object.keys(nonDefaultOverrides).length ? nonDefaultOverrides : undefined,
    autonomy: {
      default: autonomyDefault,
      perProduct: Object.keys(nonDefaultAutonomy).length ? nonDefaultAutonomy : {},
    },
  };
}
