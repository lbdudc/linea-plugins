<script setup>
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import EsqueletoLista from '../common/EsqueletoLista.vue';

import { agentLabel } from './agentLabels.js';
import { fmtMs, fmtPct } from './format.js';

const { t } = useI18n();

const props = defineProps({
  perAgent: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
});

const filas = computed(() =>
  Object.entries(props.perAgent)
    .map(([agentType, a]) => ({
      agentType,
      label: agentLabel(agentType),
      runs: a.total,
      successRate: a.successRate,
      approvalRate: a.approvalRate,
      p50: a.latency?.p50,
      p95: a.latency?.p95,
    }))
    .sort((x, y) => y.runs - x.runs)
);

const successColorVar = (rate) => {
  if (rate == null) return null;
  if (rate >= 90) return '--status-ok-solid';
  if (rate >= 80) return '--status-warn-solid';
  return '--status-bad-solid';
};
</script>

<template>
  <section class="perf-table">
    <div class="perf-table__header">
      <span class="perf-table__titulo rotulo">{{ t('labels.ops_table_perf') }}</span>
      <div class="perf-table__regla" aria-hidden="true"></div>
    </div>

    <EsqueletoLista v-if="loading" :filas="4" :punto="false" encuadrada />
    <p v-else-if="!filas.length" class="perf-table__estado">{{ t('labels.perf_table_no_runs') }}</p>

    <DataTable v-else :value="filas" data-key="agentType" size="small" class="perf-table__grid">
      <Column field="label" :header="t('labels.ops_col_agent')">
        <template #body="{ data }">
          <span class="perf-table__agente">{{ data.label }}</span>
        </template>
      </Column>
      <Column field="runs" :header="t('labels.ops_col_runs')" header-class="perf-table__col--num" body-class="perf-table__col--num">
        <template #body="{ data }"><span class="ident">{{ data.runs }}</span></template>
      </Column>
      <Column field="successRate" :header="t('labels.ops_col_success')" header-class="perf-table__col--num" body-class="perf-table__col--num">
        <template #body="{ data }">
          <div class="perf-table__exito">
            <div class="perf-table__barra">
              <div
                v-if="data.successRate != null"
                class="perf-table__barra-relleno"
                :style="{ width: `${data.successRate}%`, background: `var(${successColorVar(data.successRate)})` }"
              ></div>
            </div>
            <span class="ident">{{ fmtPct(data.successRate) }}</span>
          </div>
        </template>
      </Column>
      <Column field="approvalRate" :header="t('labels.ops_col_approval')" header-class="perf-table__col--num" body-class="perf-table__col--num">
        <template #body="{ data }">
          <span class="ident" :class="{ 'perf-table__valor--tenue': data.approvalRate == null }">{{ fmtPct(data.approvalRate) }}</span>
        </template>
      </Column>
      <Column field="p50" :header="t('labels.perf_col_p50')" header-class="perf-table__col--num" body-class="perf-table__col--num">
        <template #body="{ data }"><span class="ident perf-table__valor--muted">{{ fmtMs(data.p50) }}</span></template>
      </Column>
      <Column header-class="perf-table__col--num" body-class="perf-table__col--num">
        <template #header>
          <span :title="t('labels.ops_kpi_p95_hint')">{{ t('labels.perf_col_p95') }}</span>
        </template>
        <template #body="{ data }"><span class="ident perf-table__valor--muted">{{ fmtMs(data.p95) }}</span></template>
      </Column>
    </DataTable>
  </section>
</template>

<style scoped>
.perf-table {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.perf-table__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.perf-table__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.perf-table__estado {
  margin: 24px 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
}

.perf-table__agente {
  font-size: 13px;
}

.perf-table__valor--muted {
  color: var(--p-text-muted-color);
}

.perf-table__valor--tenue {
  color: var(--p-text-faint-color);
}

.perf-table__exito {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.perf-table__barra {
  width: 62px;
  height: 4px;
  border-radius: 2px;
  background: var(--p-content-hover-background);
  overflow: hidden;
}

.perf-table__barra-relleno {
  height: 100%;
}

.perf-table__grid :deep(.p-datatable-table) {
  font-size: 12.5px;
}

.perf-table__grid :deep(.p-datatable-thead > tr > th) {
  background: transparent;
  border-color: var(--p-content-border-color);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--p-text-dim-color);
  padding: 8px 10px;
}

.perf-table__grid :deep(.p-datatable-tbody > tr) {
  background: transparent;
}

.perf-table__grid :deep(.p-datatable-tbody > tr > td) {
  border-color: var(--p-content-hover-background);
  padding: 9px 10px;
  color: var(--p-text-color);
}

.perf-table__grid :deep(.p-datatable-tbody > tr:hover > td) {
  background: var(--p-content-hover-background);
}

.perf-table__grid :deep(.perf-table__col--num) {
  text-align: right;
}
</style>
