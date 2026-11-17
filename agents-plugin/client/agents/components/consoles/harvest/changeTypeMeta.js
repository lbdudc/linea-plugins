import { i18n } from '../../../boot/i18n.js';

export const CHANGE_TYPE_META = {
  'new-optional-feature': { labelKey: 'labels.change_type_new_feature', icon: 'pi pi-plus-circle', color: 'var(--p-agent-color)' },
  'extend-existing-feature': { labelKey: 'labels.change_type_extend_feature', icon: 'pi pi-sitemap', color: 'var(--chart-1)' },
  'bugfix-to-generated': { labelKey: 'labels.change_type_bugfix', icon: 'pi pi-wrench', color: 'var(--status-bad-solid)' },
  'product-local': { labelKey: 'labels.change_type_product_local', icon: 'pi pi-lock', color: 'var(--p-text-dim-color)' },
  ambiguous: { labelKey: 'labels.change_type_ambiguous', icon: 'pi pi-question-circle', color: 'var(--status-warn-solid)' },
  test: { labelKey: 'labels.change_type_test', icon: 'pi pi-list-check', color: 'var(--chart-3)' },
};

export const changeTypeMeta = (type) => {
  const meta = CHANGE_TYPE_META[type];
  if (meta) return { ...meta, label: i18n.global.t(meta.labelKey) };
  return { label: type ?? i18n.global.t('labels.change_type_unknown'), icon: 'pi pi-question-circle', color: 'var(--p-text-dim-color)' };
};
