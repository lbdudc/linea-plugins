import { i18n } from '../../../boot/i18n.js';

const t = (key, params) => i18n.global.t(key, params ?? {});

const stepDoc = (key) => ({
  get label() { return t(`labels.changeset_step_${key}_label`); },
  get description() { return t(`labels.changeset_step_${key}_description`); },
});

export const AGENT_DOCS = {
  changeset: {
    get summary() { return t('labels.changeset_summary'); },
    steps: {
      plan: stepDoc('plan'),
      'approve-plan': stepDoc('approve_plan'),
      sandbox: stepDoc('sandbox'),
      'merge-branch': stepDoc('merge_branch'),
      'propagate-features': stepDoc('propagate_features'),
      cascade: stepDoc('cascade'),
      verify: stepDoc('verify'),
      test: stepDoc('test'),
      'approve-tests': stepDoc('approve_tests'),
      deploy: stepDoc('deploy'),
      record: stepDoc('record'),
    },
  },
};

export const STEP_KIND_META = {
  deterministic: { icon: 'pi pi-code', color: 'var(--p-text-dim-color)', get label() { return t('labels.step_kind_deterministic'); } },
  llm: { icon: 'pi pi-android', color: 'var(--p-agent-color)', get label() { return t('labels.step_kind_llm'); } },
  git: { icon: 'pi pi-sitemap', color: 'var(--chart-4)', get label() { return t('labels.step_kind_git'); } },
  approval: { icon: 'pi pi-verified', color: 'var(--status-warn-solid)', get label() { return t('labels.step_kind_approval'); } },
};
