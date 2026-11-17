import { i18n } from '../../boot/i18n.js';

const AGENT_LABEL_KEYS = {
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

export const agentLabel = (type) => (AGENT_LABEL_KEYS[type] ? i18n.global.t(AGENT_LABEL_KEYS[type]) : type);
