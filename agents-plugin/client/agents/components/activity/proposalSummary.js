import { i18n } from '../../boot/i18n.js';

const t = (key, params) => i18n.global.t(key, params ?? {});
const tc = (key, count, params = {}) => i18n.global.t(key, params, count);

const buildPlanSummary = (stats) => {
  if (!stats) return '';
  const parts = [];
  if (stats.migrate) parts.push(`${stats.migrate} ${tc('labels.plan_summary_migration', stats.migrate)}`);
  if (stats.regen) parts.push(`${stats.regen} ${tc('labels.plan_summary_regen', stats.regen)}`);
  if (stats.likelyConflict) parts.push(`${stats.likelyConflict} ${tc('labels.plan_summary_likely_conflict', stats.likelyConflict)}`);
  if (stats.skip) parts.push(`${stats.skip} ${t('labels.plan_summary_unaffected')}`);
  return parts.length ? parts.join(', ') : t('labels.plan_summary_no_action');
};

const fileBasenames = (edits, max = 3) => {
  const names = (edits ?? []).map((e) => (e?.path ?? '').split('/').pop()).filter(Boolean);
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? t('labels.proposal_more_count', { shown, extra: names.length - max }) : shown;
};

export function describeProposal(proposal) {
  if (!proposal) return '';
  const body = proposal.body ?? {};
  if (proposal.kind === 'merge_resolution') {
    const files = fileBasenames(body.fileEdits);
    const count = body.fileEdits?.length ?? 0;
    const title = body.title ?? t('labels.proposal_merge_conflict');
    if (files && count) return t('labels.proposal_sync_resolution_full', { title, files, count });
    if (files) return t('labels.proposal_sync_resolution_files', { title, files });
    if (count) return t('labels.proposal_sync_resolution_count', { title, count });
    return t('labels.proposal_sync_resolution', { title });
  }
  if (proposal.kind === 'fm_patch') {
    const files = fileBasenames(body.fileEdits);
    const type = body.changeType ?? t('labels.change_type_unknown');
    const feature = body.featureName ?? '';
    if (feature && files) return t('labels.proposal_harvest_feature_editing', { type, feature, files });
    if (feature) return t('labels.proposal_harvest_feature', { type, feature });
    if (files) return t('labels.proposal_harvest_editing', { type, files });
    return t('labels.proposal_harvest', { type });
  }
  if (proposal.kind === 'git_comment') {
    return t('labels.proposal_advisory', { title: body.title ?? t('labels.proposal_resolution_plan') });
  }
  if (proposal.kind === 'spec_patch') {
    return t('labels.proposal_spec_patch', { title: body.title ?? t('labels.proposal_fm_fix') });
  }
  if (proposal.kind === 'plan_approval') {
    const cls = body.editClass ?? t('labels.proposal_plan_change_fallback');
    const summary = body.plan?.stats
      ? buildPlanSummary(body.plan.stats)
      : (body.title ?? t('labels.proposal_plan_default_title'));
    return t('labels.proposal_plan_approval', { cls, summary });
  }
  if (proposal.kind === 'test_review') {
    const passed = body.perProduct?.filter((r) => r.passed).length ?? 0;
    const total = body.perProduct?.length ?? 0;
    const allPass = passed === total && total > 0;
    if (allPass) return t('labels.plan_summary_test_passed', { n: total });
    const fault = body.interactionFaults ? `, ${t('labels.plan_summary_interaction_fault')}` : '';
    return `${t('labels.plan_summary_test_review')} — ${passed}/${total}${fault}`;
  }
  return body.title || proposal.kind || t('labels.proposal_generic_fallback');
}

export function pendingProposal(run) {
  return (run?.proposals ?? []).find((p) => !p.decision) ?? null;
}

const PAUSE_REASON_META = {
  blast_radius: {
    color: 'var(--status-serious)',
    icon: 'pi pi-globe',
    labelKey: 'labels.pause_blast_radius_label',
    hintKey: 'labels.pause_blast_radius_hint',
  },
  critical: {
    color: 'var(--status-bad-strong)',
    icon: 'pi pi-exclamation-circle',
    labelKey: 'labels.pause_critical_label',
    hintKey: 'labels.pause_critical_hint',
  },
  ambiguous: {
    color: 'var(--status-warn-solid)',
    icon: 'pi pi-question-circle',
    labelKey: 'labels.pause_ambiguous_label',
    hintKey: 'labels.pause_ambiguous_hint',
  },
  mode: {
    color: 'var(--p-text-muted-color)',
    icon: 'pi pi-pause-circle',
    labelKey: 'labels.pause_mode_label',
    hintKey: 'labels.pause_mode_hint',
  },
};

export const pauseReasonMeta = (reason) => {
  const meta = PAUSE_REASON_META[reason];
  if (!meta) return null;
  return { color: meta.color, icon: meta.icon, label: t(meta.labelKey), hint: t(meta.hintKey) };
};
