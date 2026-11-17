<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';

import { runStatusStyle } from '../../activity/runStatus.js';
import HarvestReviewDialog from '../harvest/HarvestReviewDialog.vue';

import { actionColor, AUTONOMY_MODES, childAgentIcon } from './changesetConstants.js';
import { deriveMatrixRows, overrideOf } from './productMatrix.js';

const props = defineProps({
  cascade: { type: Array, default: () => [] },
  childRunsById: { type: Object, default: () => ({}) },
  mode: { type: String, default: 'done' },
  modelValue: { type: Object, default: () => ({}) },
  autonomyPerProduct: { type: Object, default: undefined },
  autonomyDefault: { type: String, default: 'semi' },
  decidingRunId: { type: String, default: null },
  decide: { type: Function, default: null },
  refine: { type: Function, default: null },
  restore: { type: Function, default: null },
});

const emit = defineEmits(['update:modelValue', 'update:autonomyPerProduct']);

const { t } = useI18n();

const setOverride = (productId, value) => emit('update:modelValue', { ...props.modelValue, [productId]: value });

const showAutonomy = computed(() => props.mode === 'planning' && props.autonomyPerProduct !== undefined);
const autonomyOf = (productId) => props.autonomyPerProduct?.[productId] ?? props.autonomyDefault ?? 'semi';
const setAutonomy = (productId, value) => {
  if (!props.autonomyPerProduct) return;
  emit('update:autonomyPerProduct', { ...props.autonomyPerProduct, [productId]: value });
};

const KNOWN_ACTIONS = new Set(['migrate', 'regen', 'skip']);
const actionLabel = (action) => (KNOWN_ACTIONS.has(action) ? t(`labels.matrix_action_${action}`) : action);

const matrixStatusLabel = (child) => {
  if (!child) return t('labels.matrix_status_queued');
  const key = `labels.matrix_status_${child.status}`;
  const translated = t(key);
  return translated !== key ? translated : child.status;
};

const toggleOptions = computed(() => [
  { value: 'include', label: t('labels.matrix_toggle_include') },
  { value: 'defer', label: t('labels.matrix_toggle_defer') },
  { value: 'skip', label: t('labels.matrix_toggle_skip') },
]);

const rows = computed(() => deriveMatrixRows({
  cascade: props.cascade,
  childRunsById: props.childRunsById,
  overrides: props.modelValue,
  mode: props.mode,
}));

const reviewRun = ref(null);
const reviewOpen = ref(false);
const openReview = (child) => {
  reviewRun.value = child;
  reviewOpen.value = true;
};
const onReviewDecide = ({ proposalId, decision }) => {
  if (!reviewRun.value || !props.decide) return;
  reviewOpen.value = false;
  props.decide({ runId: String(reviewRun.value._id), proposalId, decision });
};
const onReviewRefine = (message) => {
  if (!reviewRun.value || !props.refine) return;
  props.refine({ runId: String(reviewRun.value._id), message });
};
const onReviewRestore = ({ versionIndex }) => {
  if (!reviewRun.value || !props.restore) return;
  props.restore({ runId: String(reviewRun.value._id), versionIndex });
};
</script>

<template>
  <div class="product-matrix">
    <DataTable :value="rows" data-key="productId" size="small" class="product-matrix__grid">
      <Column field="name" :header="t('labels.matrix_col_product')">
        <template #body="{ data }">
          <span class="product-matrix__product">
            <i v-if="data.isCritical" class="pi pi-circle-fill product-matrix__critical-dot" :title="t('labels.matrix_flag_critical_tooltip')" aria-hidden="true"></i>
            <span class="product-matrix__name">{{ data.name }}</span>
            <span class="product-matrix__version">v{{ data.version }}</span>
          </span>
        </template>
      </Column>

      <Column field="action" :header="t('labels.matrix_col_planned_action')">
        <template #body="{ data }">
          <Tag :value="actionLabel(data.action)" :style="{ color: actionColor(data.action), borderColor: actionColor(data.action) }" class="product-matrix__badge" />
        </template>
      </Column>

      <Column :header="t('labels.matrix_col_flags')">
        <template #body="{ data }">
          <span class="product-matrix__flags">
            <Tag
              v-if="data.likely_conflict"
              :value="t('labels.matrix_flag_drift')"
              :title="t('labels.matrix_flag_drift_tooltip')"
              icon="pi pi-exclamation-triangle"
              :style="{ color: 'var(--status-warn-solid)', borderColor: 'var(--status-warn-solid)' }"
              class="product-matrix__badge"
            />
            <Tag
              v-if="data.isCritical"
              :value="t('labels.matrix_flag_critical')"
              :style="{ color: 'var(--status-bad-solid)', borderColor: 'var(--status-bad-solid)' }"
              class="product-matrix__badge"
            />
          </span>
        </template>
      </Column>

      <Column v-if="mode === 'planning'" :header="t('labels.matrix_col_include')">
        <template #body="{ data }">
          <SelectButton
            :model-value="overrideOf(modelValue, data.productId)"
            :options="toggleOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            class="product-matrix__toggle"
            @update:model-value="(v) => setOverride(data.productId, v)"
          />
        </template>
      </Column>
      <Column v-else :header="t('labels.matrix_col_state')">
        <template #body="{ data }">
          <span v-if="data.outcomeKind === 'deferred'" class="product-matrix__state" :style="{ color: 'var(--p-text-muted-color)' }">{{ t('labels.matrix_deferred') }}</span>
          <span v-else-if="data.outcomeKind === 'skipped'" class="product-matrix__state" :style="{ color: 'var(--p-text-dim-color)' }">{{ t('labels.matrix_skipped') }}</span>
          <span v-else-if="data.outcomeKind === 'child'" class="product-matrix__state" :style="{ color: runStatusStyle(data.child).fg }">
            <i :class="childAgentIcon(data.child.agentType)" aria-hidden="true"></i>
            {{ matrixStatusLabel(data.child) }}
          </span>
          <span v-else class="product-matrix__state product-matrix__state--empty">—</span>
        </template>
      </Column>

      <Column v-if="showAutonomy" :header="t('labels.matrix_col_autonomy')">
        <template #body="{ data }">
          <span class="product-matrix__autonomy">
            <button
              v-for="aMode in AUTONOMY_MODES"
              :key="aMode.value"
              type="button"
              class="product-matrix__autonomy-btn"
              :class="{ 'product-matrix__autonomy-btn--active': autonomyOf(data.productId) === aMode.value }"
              :style="autonomyOf(data.productId) === aMode.value ? { color: aMode.color } : null"
              :title="`${aMode.label}: ${aMode.description}`"
              @click="setAutonomy(data.productId, aMode.value)"
            >
              <i :class="aMode.icon" aria-hidden="true"></i>
            </button>
            <span v-if="autonomyOf(data.productId) !== (autonomyDefault ?? 'semi')" class="product-matrix__override">{{ t('labels.matrix_override') }}</span>
          </span>
        </template>
      </Column>

      <Column v-if="mode === 'cascading'" style="width: 110px">
        <template #body="{ data }">
          <button
            v-if="data.child?.status === 'awaiting_approval'"
            type="button"
            class="product-matrix__review"
            :disabled="decidingRunId === String(data.child?._id)"
            @click="openReview(data.child)"
          >
            <i :class="decidingRunId === String(data.child?._id) ? 'pi pi-spin pi-spinner' : 'pi pi-eye'" aria-hidden="true"></i>
            {{ t('labels.matrix_review') }}
          </button>
        </template>
      </Column>

      <template #empty>
        <span class="product-matrix__empty">{{ t('labels.matrix_empty') }}</span>
      </template>
    </DataTable>

    <HarvestReviewDialog
      v-if="reviewRun"
      v-model="reviewOpen"
      :run="reviewRun"
      :busy="decidingRunId === String(reviewRun?._id)"
      @decide="onReviewDecide"
      @refine="onReviewRefine"
      @restore="onReviewRestore"
    />
  </div>
</template>

<style scoped>
.product-matrix__grid :deep(.p-datatable-table) {
  font-size: 12.5px;
}

.product-matrix__grid :deep(.p-datatable-thead > tr > th) {
  background: transparent;
  border-color: var(--p-content-border-color);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--p-text-dim-color);
  padding: 7px 10px;
}

.product-matrix__grid :deep(.p-datatable-tbody > tr) {
  background: transparent;
}

.product-matrix__grid :deep(.p-datatable-tbody > tr > td) {
  border-color: var(--p-content-hover-background);
  padding: 7px 10px;
  color: var(--p-text-color);
}

.product-matrix__product {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.product-matrix__critical-dot {
  font-size: 8px;
  color: var(--status-bad-solid);
}

.product-matrix__name {
  font-weight: 500;
}

.product-matrix__version {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.product-matrix__badge {
  font-size: 10.5px;
  background: transparent;
  border: 1px solid currentColor;
}

.product-matrix__flags {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.product-matrix__state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}

.product-matrix__state--empty {
  color: var(--p-text-faint-color);
}

.product-matrix__toggle :deep(.p-togglebutton),
.product-matrix__toggle :deep(.p-selectbutton .p-button) {
  padding: 3px 9px;
  font-size: 11px;
}

.product-matrix__autonomy {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.product-matrix__autonomy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-faint-color);
  cursor: pointer;
}

.product-matrix__autonomy-btn:hover {
  background: var(--hover-veil);
}

.product-matrix__autonomy-btn--active {
  background: var(--p-agent-highlight-soft);
}

.product-matrix__override {
  font-size: 9.5px;
  color: var(--p-text-muted-color);
  margin-left: 4px;
}

.product-matrix__review {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border: none;
  border-radius: 5px;
  background: var(--status-warn-soft);
  color: var(--status-warn-solid);
  font-size: 11.5px;
  cursor: pointer;
}

.product-matrix__review:disabled {
  opacity: 0.6;
  cursor: default;
}

.product-matrix__empty {
  display: block;
  padding: 10px 4px;
  font-size: 12px;
  color: var(--p-text-dim-color);
  text-align: center;
}
</style>
