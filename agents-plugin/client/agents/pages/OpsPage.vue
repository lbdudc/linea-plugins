<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import agentApi from '../api/agentApi.js';
import { agentRunStore } from '../stores/agentRunStore.js';
import { connect as conectarSocket } from '../boot/ws.js';

import AgentPerfTable from '../components/ops/AgentPerfTable.vue';
import DeploymentOutcomesPanel from '../components/ops/DeploymentOutcomesPanel.vue';
import FleetTable from '../components/ops/FleetTable.vue';
import KpiRibbon from '../components/ops/KpiRibbon.vue';
import LatencyChart from '../components/ops/LatencyChart.vue';
import RunsOverTimeChart from '../components/ops/RunsOverTimeChart.vue';
import SyncStalenessPanel from '../components/ops/SyncStalenessPanel.vue';
import { fmtMs, fmtPct } from '../components/ops/format.js';
import { computeStaleCount, computeStalenessStats, sortProductsBySync } from '../components/ops/stalenessStats.js';

const { t } = useI18n();

const RANGOS = computed(() => [
  { id: 7, label: t('labels.ops_range_7') },
  { id: 14, label: t('labels.ops_range_14') },
  { id: 30, label: t('labels.ops_range_30') },
  { id: 90, label: t('labels.ops_range_90') },
]);

const rango = ref(14);
const metrics = ref(null);
const cargando = ref(true);
const error = ref(null);

async function cargarMetrics() {
  cargando.value = true;
  error.value = null;
  try {
    metrics.value = await agentApi.getMetrics({ windowDays: rango.value });
  } catch (err) {
    error.value = err?.response?.data?.error ?? err.message ?? t('labels.ops_load_metrics_error');
    metrics.value = null;
  } finally {
    cargando.value = false;
  }
}

watch(rango, cargarMetrics);
onMounted(cargarMetrics);

async function cargarRuns() {
  try {
    agentRunStore.setAll(await agentApi.listRuns());
  } catch {
  }
}
function alRun({ run }) {
  agentRunStore.upsert(run);
}
function alPropuesta({ runId, proposal }) {
  agentRunStore.mergeProposal(runId, proposal);
}
function alPaso({ runId, status, step }) {
  agentRunStore.mergeStep(runId, status, step);
}

const liveTerminal = computed(
  () => agentRunStore.runs.filter((r) => ['done', 'failed', 'cancelled'].includes(r.status)).length,
);
let refreshTimer = null;
watch(liveTerminal, () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(cargarMetrics, 1500);
});

onMounted(() => {
  cargarRuns();
  conectarSocket().on('agent-run', alRun);
  conectarSocket().on('agent-proposal', alPropuesta);
  conectarSocket().on('agent-step', alPaso);
});
onBeforeUnmount(() => {
  clearTimeout(refreshTimer);
  conectarSocket().off('agent-run', alRun);
  conectarSocket().off('agent-proposal', alPropuesta);
  conectarSocket().off('agent-step', alPaso);
});

const deploymentMetrics = ref(null);
const deploymentLoading = ref(true);
const products = ref([]);
const productsLoading = ref(true);

async function cargarAnalytics() {
  deploymentLoading.value = true;
  try {
    deploymentMetrics.value = await agentApi.getDeploymentMetrics();
  } catch {
    deploymentMetrics.value = null;
  } finally {
    deploymentLoading.value = false;
  }

  productsLoading.value = true;
  try {
    products.value = await agentApi.listEnrolledProducts();
  } catch {
    products.value = [];
  } finally {
    productsLoading.value = false;
  }
}
onMounted(cargarAnalytics);

const stalenessStats = computed(() => computeStalenessStats(products.value));
const staleCount = computed(() => computeStaleCount(products.value));
const productsSortedBySync = computed(() => sortProductsBySync(products.value));

const kpis = computed(() => {
  const m = metrics.value;
  return [
    { label: t('labels.stats_total'), value: m?.total ?? '—' },
    { label: t('labels.stats_success_rate'), value: fmtPct(m?.successRate), colorVar: '--status-ok-strong' },
    {
      label: t('labels.ops_kpi_error_rate'),
      value: fmtPct(m?.errorRate),
      colorVar: (m?.errorRate ?? 0) > 0 ? '--status-bad-strong' : null,
    },
    {
      label: t('labels.stats_awaiting_approval'),
      value: m?.pendingApprovals ?? '—',
      colorVar: (m?.pendingApprovals ?? 0) > 0 ? '--status-warn-solid' : null,
    },
    { label: t('labels.ops_kpi_avg_latency'), value: fmtMs(m?.latency?.avg) },
    { label: t('labels.ops_kpi_p95_latency'), value: fmtMs(m?.latency?.p95) },
  ];
});

const dias = computed(() => metrics.value?.timeSeries ?? []);
const perAgent = computed(() => metrics.value?.perAgent ?? {});
</script>

<template>
  <section class="ops">
    <div class="ops__cabecera">
      <div class="ops__titulos">
        <h1 class="ops__titulo cifra">{{ t('labels.ops_title') }}</h1>
        <p class="ops__subtitulo">{{ t('labels.ops_subtitle') }}</p>
      </div>
      <div class="ops__rangos" role="group" :aria-label="t('labels.ops_range_group_aria')">
        <button
          v-for="r in RANGOS"
          :key="r.id"
          type="button"
          class="ops__rango"
          :class="{ 'ops__rango--activo': rango === r.id }"
          :aria-pressed="rango === r.id"
          @click="rango = r.id"
        >
          {{ r.label }}
        </button>
      </div>
      <button
        type="button"
        class="ops__refrescar"
        :disabled="cargando"
        :aria-label="t('labels.ops_refresh')"
        @click="cargarMetrics"
      >
        <i class="pi pi-refresh" :class="{ 'ops__refrescar-icono--girando': cargando }" aria-hidden="true"></i>
        {{ t('labels.ops_refresh') }}
      </button>
    </div>

    <p v-if="error" class="ops__error" role="alert">{{ error }}</p>

    <KpiRibbon :items="kpis" :cargando="cargando" class="ops__kpis" />

    <RunsOverTimeChart :days="dias" :loading="cargando" />

    <LatencyChart :per-agent="perAgent" :loading="cargando" />

    <AgentPerfTable :per-agent="perAgent" :loading="cargando" />

    <FleetTable :runs="agentRunStore.runs" />

    <DeploymentOutcomesPanel :metrics="deploymentMetrics" :loading="deploymentLoading" />

    <SyncStalenessPanel
      :products="productsSortedBySync"
      :staleness-stats="stalenessStats"
      :stale-count="staleCount"
      :loading="productsLoading"
    />
  </section>
</template>

<style scoped>
.ops {
  padding: 28px 32px 32px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.ops__cabecera {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 20px;
  margin-bottom: 24px;
}

.ops__titulos {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ops__titulo {
  margin: 0;
  font-size: 32px;
  line-height: 1.1;
  color: var(--p-text-color);
}

.ops__subtitulo {
  margin: 0;
  font-size: 14px;
  color: var(--p-text-muted-color);
}

.ops__rangos {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ops__rango {
  padding: 6px 13px;
  border-radius: 20px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--p-content-border-color);
  background: transparent;
  color: var(--p-text-muted-color);
}

.ops__rango:hover {
  color: var(--p-text-color);
}

.ops__rango--activo {
  border-color: var(--p-agent-background);
  background: var(--p-agent-highlight);
  color: var(--p-text-color);
}

.ops__error {
  color: var(--status-bad);
  font-size: 12.5px;
  margin: 0 0 16px;
}

.ops__kpis {
  margin-bottom: 28px;
}
</style>
