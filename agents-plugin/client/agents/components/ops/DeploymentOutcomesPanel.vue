<script setup>
import Chart from 'primevue/chart';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Esqueleto from '../common/Esqueleto.vue';
import EsqueletoGrafico from '../common/EsqueletoGrafico.vue';

import { useOpsChartColors } from './chartColors.js';

const props = defineProps({
  metrics: { type: Object, default: null },
  loading: { type: Boolean, default: false },
});

const { t } = useI18n();
const colores = useOpsChartColors();

const conflictRate = computed(() => (props.metrics?.conflictRate != null ? `${props.metrics.conflictRate}%` : '—'));
const successCount = computed(() => props.metrics?.byOutcome?.success ?? '—');

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function formatMes(yyyyMM) {
  const [yr, mo] = yyyyMM.split('-');
  return `${MESES[parseInt(mo, 10) - 1]} ${yr}`;
}

const hasMonthlyData = computed(() => (props.metrics?.byMonth ?? []).length >= 1);
const hasOutcomeData = computed(() => (props.metrics?.total ?? 0) > 0);

const monthlyData = computed(() => {
  const c = colores.value;
  const rows = props.metrics?.byMonth ?? [];
  return {
    labels: rows.map((r) => formatMes(r.month)),
    datasets: [
      { label: t('labels.successful'), data: rows.map((r) => r.success), backgroundColor: c['--status-ok-solid'], borderRadius: 3, stack: 'a' },
      { label: t('labels.with_conflicts'), data: rows.map((r) => r.warning), backgroundColor: c['--status-warn-solid'], borderRadius: 3, stack: 'a' },
      { label: t('labels.failed'), data: rows.map((r) => r.error), backgroundColor: c['--status-bad-solid'], borderRadius: 3, stack: 'a' },
    ],
  };
});
const monthlyOptions = computed(() => {
  const c = colores.value;
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: c['--p-text-dim-color'], maxRotation: 45, font: { size: 10.5 } } },
      y: { stacked: true, beginAtZero: true, grid: { color: c['--p-content-border-color'] }, ticks: { color: c['--p-text-dim-color'], precision: 0, font: { size: 10.5 } } },
    },
    plugins: { legend: { position: 'bottom', labels: { color: c['--p-text-muted-color'], boxWidth: 10, padding: 12, font: { size: 11 } } } },
  };
});

const outcomeData = computed(() => {
  const c = colores.value;
  const o = props.metrics?.byOutcome ?? {};
  return {
    labels: [t('labels.successful'), t('labels.with_conflicts'), t('labels.failed')],
    datasets: [{
      data: [o.success ?? 0, o.warning ?? 0, o.error ?? 0],
      backgroundColor: [c['--status-ok-solid'], c['--status-warn-solid'], c['--status-bad-solid']],
      borderWidth: 0,
      hoverOffset: 4,
    }],
  };
});
const outcomeOptions = computed(() => {
  const c = colores.value;
  return {
    responsive: true,
    maintainAspectRatio: true,
    cutout: '65%',
    plugins: { legend: { position: 'bottom', labels: { color: c['--p-text-muted-color'], boxWidth: 10, padding: 12, font: { size: 11 } } } },
  };
});
</script>

<template>
  <section class="deploy">
    <div class="deploy__header">
      <span class="deploy__titulo rotulo">{{ t('labels.deployment_outcomes') }}</span>
      <div class="deploy__regla" aria-hidden="true"></div>
    </div>

    <div class="deploy__kpis">
      <div class="deploy__kpi">
        <span class="deploy__kpi-valor cifra">{{ loading ? '…' : (metrics?.total ?? '—') }}</span>
        <span class="deploy__kpi-label rotulo">{{ t('labels.total_deployments') }}</span>
      </div>
      <div class="deploy__kpi">
        <span class="deploy__kpi-valor cifra" style="color: var(--status-ok-strong)">{{ loading ? '…' : successCount }}</span>
        <span class="deploy__kpi-label rotulo">{{ t('labels.successful') }}</span>
      </div>
      <div class="deploy__kpi">
        <span class="deploy__kpi-valor cifra" :style="(metrics?.byOutcome?.warning ?? 0) > 0 ? { color: 'var(--status-warn-solid)' } : null">{{ loading ? '…' : conflictRate }}</span>
        <span class="deploy__kpi-label rotulo">{{ t('labels.conflict_rate') }}</span>
      </div>
      <div class="deploy__kpi">
        <span class="deploy__kpi-valor cifra" :style="(metrics?.byOutcome?.error ?? 0) > 0 ? { color: 'var(--status-bad-strong)' } : null">{{ loading ? '…' : (metrics?.byOutcome?.error ?? '—') }}</span>
        <span class="deploy__kpi-label rotulo">{{ t('labels.failed') }}</span>
      </div>
    </div>

    <div class="deploy__charts">
      <div class="deploy__chart deploy__chart--wide">
        <span class="deploy__chart-titulo">{{ t('labels.outcomes_over_time') }}</span>
        <div class="deploy__chart-body">
          <EsqueletoGrafico v-if="loading" alto="130px" />
          <p v-else-if="!hasMonthlyData" class="deploy__estado">{{ t('labels.no_data') }}</p>
          <Chart v-else type="bar" :data="monthlyData" :options="monthlyOptions" />
        </div>
      </div>
      <div class="deploy__chart">
        <span class="deploy__chart-titulo">{{ t('labels.deployment_outcomes') }}</span>
        <div class="deploy__chart-body deploy__chart-body--ring">
          <Esqueleto v-if="loading" ancho="118px" alto="118px" radio="50%" />
          <p v-else-if="!hasOutcomeData" class="deploy__estado">{{ t('labels.no_data') }}</p>
          <Chart v-else type="doughnut" :data="outcomeData" :options="outcomeOptions" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.deploy {
  flex-shrink: 0;
  margin-top: 34px;
  padding-top: 26px;
  border-top: 1px solid var(--p-content-border-color);
}

.deploy__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.deploy__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.deploy__kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  margin-bottom: 20px;
}

.deploy__kpi {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.deploy__kpi-valor {
  font-size: 24px;
  color: var(--p-text-color);
}

.deploy__charts {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}

.deploy__chart {
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  background: var(--p-content-background);
  padding: 14px 16px;
  min-width: 0;
}

.deploy__chart-titulo {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
  margin-bottom: 10px;
}

.deploy__chart-body {
  height: 190px;
  position: relative;
}

.deploy__chart-body--ring {
  display: flex;
  align-items: center;
  justify-content: center;
}

.deploy__estado {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  margin: 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
}

@media (max-width: 900px) {
  .deploy__charts {
    grid-template-columns: 1fr;
  }
}
</style>
