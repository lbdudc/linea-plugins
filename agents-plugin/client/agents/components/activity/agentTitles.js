import { i18n } from '../../boot/i18n.js';

const AGENT_TITLE_KEYS = {
  harvest: 'labels.agent_title_harvest',
  sync: 'labels.agent_title_sync',
  'line-sync': 'labels.agent_title_line_sync',
  regen: 'labels.agent_title_regen',
  'variant-miner': 'labels.agent_title_variant_miner',
  'line-health': 'labels.agent_title_line_health',
  changeset: 'labels.agent_title_changeset',
  evolution: 'labels.agent_title_evolution',
  'feature-location': 'labels.agent_title_feature_location',
  'fm-constraint-advisor': 'labels.agent_title_fm_constraint_advisor',
};

export const agentTitle = (agentType) => {
  const key = AGENT_TITLE_KEYS[agentType];
  return key ? i18n.global.t(key) : (agentType ?? '—');
};
