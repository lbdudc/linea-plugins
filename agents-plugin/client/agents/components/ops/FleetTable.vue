<script setup>
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Select from 'primevue/select';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { agentLabel } from './agentLabels.js';
import { filterFleetRuns, uniqueAgentTypes, uniqueStatuses } from './fleetFilter.js';
import { fmtMs } from './format.js';
import { statusColorVar } from './runStatusVar.js';

const { t } = useI18n();

const props = defineProps({
  runs: { type: Array, default: () => [] },
});

const agentFilter = ref(null);
const statusFilter = ref(null);

const agentOptions = computed(() =>
  uniqueAgentTypes(props.runs).map((type) => ({ label: agentLabel(type), value: type })),
);
const statusOptions = computed(() =>
  uniqueStatuses(props.runs).map((status) => ({ label: t(`labels.status_${status}`), value: status })),
);

const filas = computed(() =>
  filterFleetRuns(props.runs, { agentType: agentFilter.value, status: statusFilter.value }),
);

function scopeLabel(run) {
  if (run.scope?.productId) return t('labels.scope_product');
  if (run.scope?.lineId) return t('labels.scope_line');
  return t('labels.ops_scope_none');
}

function duration(run) {
  if (!run.createdAt || !run.updatedAt) return '—';
  return fmtMs(new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime());
}
</script>

<template>
  <section class="fleet">
    <div class="fleet__header">
      <span class="fleet__titulo rotulo">{{ t('labels.ops_fleet_title') }}</span>
      <div class="fleet__regla" aria-hidden="true"></div>
      <div class="fleet__filtros">
        <Select
          v-model="agentFilter"
          :options="agentOptions"
          option-label="label"
          option-value="value"
          show-clear
          :placeholder="t('labels.ops_filter_agent')"
          size="small"
          class="fleet__filtro"
        />
        <Select
          v-model="statusFilter"
          :options="statusOptions"
          option-label="label"
          option-value="value"
          show-clear
          :placeholder="t('labels.ops_filter_status')"
          size="small"
          class="fleet__filtro"
        />
      </div>
    </div>

    <p v-if="!filas.length" class="fleet__estado">{{ t('labels.ops_fleet_empty') }}</p>

    <DataTable v-else :value="filas" data-key="_id" size="small" class="fleet__grid">
      <Column :header="t('labels.ops_col_status')">
        <template #body="{ data }">
          <span class="fleet__estado-chip">
            <span class="fleet__punto" :style="{ background: `var(${statusColorVar(data.status)})` }" aria-hidden="true"></span>
            {{ t(`labels.status_${data.status}`) }}
          </span>
        </template>
      </Column>
      <Column :header="t('labels.ops_col_agent')">
        <template #body="{ data }"><span class="fleet__agente">{{ agentLabel(data.agentType) }}</span></template>
      </Column>
      <Column :header="t('labels.ops_col_scope')">
        <template #body="{ data }">{{ scopeLabel(data) }}</template>
      </Column>
      <Column :header="t('labels.ops_col_duration')" header-class="fleet__col--num" body-class="fleet__col--num">
        <template #body="{ data }"><span class="ident">{{ duration(data) }}</span></template>
      </Column>
    </DataTable>
  </section>
</template>

<style scoped>
.fleet {
  flex-shrink: 0;
  margin-bottom: 28px;
}

.fleet__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.fleet__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.fleet__filtros {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fleet__filtro {
  min-width: 150px;
}

.fleet__estado {
  margin: 24px 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
}

.fleet__estado-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

.fleet__punto {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.fleet__agente {
  font-size: 13px;
}

.fleet__grid :deep(.p-datatable-table) {
  font-size: 12.5px;
}

.fleet__grid :deep(.p-datatable-thead > tr > th) {
  background: transparent;
  border-color: var(--p-content-border-color);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--p-text-dim-color);
  padding: 8px 10px;
}

.fleet__grid :deep(.p-datatable-tbody > tr) {
  background: transparent;
}

.fleet__grid :deep(.p-datatable-tbody > tr > td) {
  border-color: var(--p-content-hover-background);
  padding: 9px 10px;
  color: var(--p-text-color);
}

.fleet__grid :deep(.p-datatable-tbody > tr:hover > td) {
  background: var(--p-content-hover-background);
}

.fleet__grid :deep(.fleet__col--num) {
  text-align: right;
}
</style>
