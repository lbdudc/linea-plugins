<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Dialog from 'primevue/dialog';

import { buildComparisonMatrix, commonRows, diffRows } from './productComparison.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  products: { type: Array, default: () => [] },
});
const emit = defineEmits(['update:modelValue']);

const { t } = useI18n();

const matrix = computed(() => buildComparisonMatrix(props.products));
const diffs = computed(() => diffRows(matrix.value));
const common = computed(() => commonRows(matrix.value));

const productName = (p) => p.spec?.basicData?.name ?? p.name ?? p._id;
const productVersion = (p) => p.spec?.basicData?.version ?? p.version ?? '?';
</script>

<template>
  <Dialog :visible="modelValue" modal maximized class="pcm" @update:visible="(v) => emit('update:modelValue', v)">
    <template #header>
      <i class="pi pi-clone" aria-hidden="true"></i>
      <span class="pcm__title">{{ t('labels.product_comparison_title') }}</span>
      <span class="pcm__badge">{{ products.length }} {{ t('labels.product_count_badge') }}</span>
      <span class="pcm__badge pcm__badge--warn">{{ diffs.length }} {{ t('labels.differences_count_badge') }}</span>
    </template>

    <table class="pcm__table">
      <thead>
        <tr>
          <th class="pcm__feature-col">{{ t('labels.feature_column_header') }}</th>
          <th v-for="p in products" :key="p._id" class="pcm__product-col">
            <div class="pcm__product-name">{{ productName(p) }}</div>
            <div class="pcm__product-ver">v{{ productVersion(p) }}</div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="diffs.length" class="pcm__section">
          <td :colspan="products.length + 1"><i class="pi pi-arrow-right-arrow-left" aria-hidden="true"></i> {{ t('labels.differences_section_header') }} ({{ diffs.length }})</td>
        </tr>
        <tr v-for="row in diffs" :key="row.feature">
          <td class="pcm__feature-cell">{{ row.feature }}</td>
          <td v-for="(has, i) in row.values" :key="i" class="pcm__val-cell" :class="has ? 'pcm__val-cell--yes' : 'pcm__val-cell--no'">
            <i :class="has ? 'pi pi-check' : 'pi pi-times'" :style="{ color: has ? 'var(--status-ok-solid)' : 'var(--status-bad-solid)' }" aria-hidden="true"></i>
          </td>
        </tr>

        <tr v-if="common.length" class="pcm__section">
          <td :colspan="products.length + 1"><i class="pi pi-check-circle" aria-hidden="true"></i> {{ t('labels.common_features_section_header') }} ({{ common.length }})</td>
        </tr>
        <tr v-for="row in common" :key="row.feature">
          <td class="pcm__feature-cell">{{ row.feature }}</td>
          <td v-for="(has, i) in row.values" :key="i" class="pcm__val-cell pcm__val-cell--common">
            <i class="pi pi-check" style="color: var(--p-text-faint-color)" aria-hidden="true"></i>
          </td>
        </tr>

        <tr v-if="!matrix.length">
          <td :colspan="products.length + 1" class="pcm__empty">{{ t('labels.no_feature_data_available') }}</td>
        </tr>
      </tbody>
    </table>
  </Dialog>
</template>

<style scoped>
.pcm__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.pcm__badge {
  padding: 1px 9px;
  border-radius: 20px;
  border: 1px solid var(--p-text-faint-color);
  color: var(--p-text-muted-color);
  font-size: 11px;
}

.pcm__badge--warn {
  border-color: var(--status-warn-solid);
  color: var(--status-warn-solid);
}

.pcm__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.pcm__table thead tr {
  background: var(--p-surface-ground);
  position: sticky;
  top: 0;
}

.pcm__feature-col {
  text-align: left;
  padding: 8px 16px;
  font-weight: 600;
  white-space: nowrap;
  width: 220px;
  min-width: 140px;
  color: var(--p-text-color);
}

.pcm__product-col {
  text-align: center;
  padding: 6px 12px;
  min-width: 100px;
}

.pcm__product-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--p-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.pcm__product-ver {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.pcm__section td {
  padding: 6px 16px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-dim-color);
  background: var(--p-content-hover-background);
  border-top: 1px solid var(--p-content-border-color);
}

.pcm__feature-cell {
  padding: 5px 16px;
  color: var(--p-text-color);
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 12px;
}

.pcm__val-cell {
  text-align: center;
  padding: 5px 12px;
}

.pcm__val-cell--yes {
  background: var(--status-ok-soft);
}

.pcm__val-cell--no {
  background: var(--status-bad-soft);
}

.pcm__empty {
  text-align: center;
  padding: 32px;
  color: var(--p-text-muted-color);
}
</style>

<style>
.pcm .p-dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
