import { i18n } from '../../boot/i18n.js';

const AGENT_TYPES = [
  'changeset', 'line-sync', 'sync', 'regen', 'line-health', 'harvest',
  'feature-location', 'fm-constraint-advisor', 'evolution', 'variant-miner',
];

const AGENT_TITLE_KEYS = {
  changeset: 'labels.agent_title_changeset',
  'line-sync': 'labels.agent_title_line_sync',
  sync: 'labels.agent_title_sync',
  regen: 'labels.agent_title_regen',
  'line-health': 'labels.agent_title_line_health',
  harvest: 'labels.agent_title_harvest',
  'feature-location': 'labels.agent_title_feature_location',
  'fm-constraint-advisor': 'labels.agent_title_fm_constraint_advisor',
  evolution: 'labels.agent_title_evolution',
  'variant-miner': 'labels.agent_title_variant_miner',
};

export const AGENT_GROUPS_DISEÑO = [
  { labelKey: 'labels.agent_group_co_evolution', types: ['changeset', 'line-sync', 'sync', 'regen'] },
  { labelKey: 'labels.agent_group_analysis_quality', types: ['line-health'] },
  { labelKey: 'labels.agent_group_code_intelligence', types: ['harvest', 'feature-location'] },
  { labelKey: 'labels.agent_group_fm_authoring', types: ['fm-constraint-advisor', 'evolution'] },
  { labelKey: 'labels.agent_group_portfolio', types: ['variant-miner'] },
];

// `tm` may hand a list back as an object keyed by position (it does once the app has merged the plugin's messages into its own)
const listOf = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []);

export const agentCopy = (type) => {
  if (!AGENT_TYPES.includes(type)) return null;
  const raw = i18n.global.tm(`labels.agent_copy.${type}`) ?? {};
  return {
    name: i18n.global.t(AGENT_TITLE_KEYS[type]),
    desc: i18n.global.rt(raw.desc ?? ''),
    steps: listOf(raw.steps).map((s) => i18n.global.rt(s)),
    touches: listOf(raw.touches).map((t) => i18n.global.rt(t)),
    limits: listOf(raw.limits).map((l) => ({ k: i18n.global.rt(l.k), v: i18n.global.rt(l.v) })),
  };
};

export const AGENTES_CON_AUTONOMIA = ['sync', 'harvest', 'evolution', 'changeset'];
