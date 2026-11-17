<script setup>
import Chart from 'primevue/chart';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import EsqueletoGrafico from '../common/EsqueletoGrafico.vue';

import { agentLabel } from './agentLabels.js';
import { useOpsChartColors } from './chartColors.js';
import { fmtMs } from './format.js';

const props = defineProps({
  perAgent: { type: Object, default: () => ({}) },
  loading: { type: Boolean, default: false },
});

const { t } = useI18n();
const colores = useOpsChartColors();

const entradas = computed(() =>
  Object.entries(props.perAgent).sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0)),
);
const hayDatos = computed(() => entradas.value.length > 0);

const datosGrafica = computed(() => {
  const c = colores.value;
  return {
    labels: entradas.value.map(([type]) => agentLabel(type)),
    datasets: [
      {
        label: 'p50',
        data: entradas.value.map(([, a]) => a.latency?.p50 ?? 0),
        backgroundColor: c['--chart-1'],
        borderRadius: 3,
        categoryPercentage: 0.7,
        barPercentage: 0.9,
      },
      {
        label: 'p95',
        data: entradas.value.map(([, a]) => a.latency?.p95 ?? 0),
        backgroundColor: c['--chart-2'],
        borderRadius: 3,
        categoryPercentage: 0.7,
        barPercentage: 0.9,
      },
    ],
  };
});

const opcionesGrafica = computed(() => {
  const c = colores.value;
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: c['--p-text-dim-color'], font: { size: 10.5 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: c['--p-content-border-color'] },
        ticks: { color: c['--p-text-dim-color'], font: { size: 10.5 }, callback: (v) => fmtMs(v) },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtMs(ctx.parsed.y)}` } },
    },
  };
});

const leyenda = computed(() => [
  { label: 'p50', colorVar: '--chart-1' },
  { label: 'p95', colorVar: '--chart-2' },
]);
</script>

<template>
  <section class="latency-chart">
    <div class="latency-chart__header">
      <span class="latency-chart__titulo rotulo">{{ t('labels.ops_chart_latency') }}</span>
      <div class="latency-chart__regla" aria-hidden="true"></div>
      <div class="latency-chart__leyenda">
        <div v-for="s in leyenda" :key="s.label" class="latency-chart__leyenda-item">
          <span class="latency-chart__leyenda-punto" :style="{ background: `var(${s.colorVar})` }" aria-hidden="true"></span>
          <span class="ident">{{ s.label }}</span>
        </div>
      </div>
    </div>

    <div class="latency-chart__cuerpo">
      <EsqueletoGrafico v-if="loading" alto="150px" />
      <p v-else-if="!hayDatos" class="latency-chart__estado">{{ t('labels.perf_table_no_runs') }}</p>
      <Chart v-else type="bar" :data="datosGrafica" :options="opcionesGrafica" class="latency-chart__canvas" />
    </div>
  </section>
</template>

<style scoped>
.latency-chart {
  flex-shrink: 0;
  margin-bottom: 30px;
}

.latency-chart__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.latency-chart__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.latency-chart__leyenda {
  display: flex;
  align-items: center;
  gap: 16px;
}

.latency-chart__leyenda-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.latency-chart__leyenda-punto {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex-shrink: 0;
}

.latency-chart__cuerpo {
  height: 220px;
}

.latency-chart__canvas {
  height: 220px;
}

.latency-chart__estado {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
  margin: 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
}
</style>
