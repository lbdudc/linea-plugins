import { i18n } from '../../../boot/i18n.js';

const t = (key, params) => i18n.global.t(key, params ?? {});

export const AUTONOMY_MODES = [
  { value: 'manual', get label() { return t('labels.autonomy_mode_manual'); }, get description() { return t('labels.autonomy_mode_manual_hint'); }, icon: 'pi pi-user', color: 'var(--p-text-dim-color)' },
  { value: 'semi', get label() { return t('labels.autonomy_mode_semi'); }, get description() { return t('labels.autonomy_mode_semi_hint'); }, icon: 'pi pi-shield', color: 'var(--p-agent-color)' },
  { value: 'automatic', get label() { return t('labels.autonomy_mode_automatic'); }, get description() { return t('labels.autonomy_mode_automatic_hint'); }, icon: 'pi pi-bolt', color: 'var(--status-ok-solid)' },
];

export const autonomyModeMeta = (mode) => AUTONOMY_MODES.find((m) => m.value === mode) ?? AUTONOMY_MODES[1];

const ACTION_COLOR = { migrate: 'var(--chart-4)', regen: 'var(--chart-1)', skip: 'var(--p-text-dim-color)' };
export const actionColor = (action) => ACTION_COLOR[action] ?? 'var(--p-text-dim-color)';

export const EDIT_CLASS_META = {
  refactoring: { icon: 'pi pi-refresh', color: 'var(--status-ok-solid)' },
  generalization: { icon: 'pi pi-sitemap', color: 'var(--p-agent-color)' },
  specialization: { icon: 'pi pi-wrench', color: 'var(--status-warn-solid)' },
  arbitrary: { icon: 'pi pi-exclamation-triangle', color: 'var(--status-bad-solid)' },
};

export const editClassMeta = (cls) => EDIT_CLASS_META[cls] ?? { icon: 'pi pi-sync', color: 'var(--p-text-dim-color)' };

const CHILD_AGENT_ICON = {
  sync: 'pi pi-sitemap',
  evolution: 'pi pi-bolt',
  regen: 'pi pi-replay',
  'line-sync': 'pi pi-sync',
};

export const childAgentIcon = (agentType) => CHILD_AGENT_ICON[agentType] ?? 'pi pi-hourglass';
