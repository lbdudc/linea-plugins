<script setup>
import Chart from 'primevue/chart';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import EsqueletoGrafico from '../common/EsqueletoGrafico.vue';

import { useOpsChartColors } from './chartColors.js';

const props = defineProps({
  days: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
});

const { t } = useI18n();
const colores = useOpsChartColors();

const hayDatos = computed(() => props.days.some((d) => d.total > 0));

const enCurso = (d) => Math.max(0, d.total - d.done - d.failed);

const etiquetaDia = (fecha) => {
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
};

const datosGrafica = computed(() => {
  const c = colores.value;
  const base = { borderColor: c['--p-surface-ground'], borderWidth: 2, borderSkipped: false, stack: 'runs' };
  return {
    labels: props.days.map((d) => etiquetaDia(d.date)),
    datasets: [
      {
        ...base,
        label: t('labels.chart_legend_done'),
        data: props.days.map((d) => d.done),
        backgroundColor: c['--status-ok-solid'],
        borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 },
      },
      {
        ...base,
        label: t('labels.chart_legend_in_progress'),
        data: props.days.map(enCurso),
        backgroundColor: c['--status-warn-solid'],
        borderRadius: 0,
      },
      {
        ...base,
        label: t('labels.chart_legend_failed'),
        data: props.days.map((d) => d.failed),
        backgroundColor: c['--status-bad-solid'],
        borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
      },
    ],
  };
});

const opcionesGrafica = computed(() => {
  const c = colores.value;
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: { color: c['--p-text-dim-color'], font: { size: 10.5, family: "'IBM Plex Mono', monospace" } },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: c['--p-content-border-color'] },
        ticks: { color: c['--p-text-dim-color'], precision: 0, font: { size: 10.5 } },
      },
    },
  };
});

const leyenda = computed(() => [
  { label: t('labels.chart_legend_done'), colorVar: '--status-ok-solid' },
  { label: t('labels.chart_legend_in_progress'), colorVar: '--status-warn-solid' },
  { label: t('labels.chart_legend_failed'), colorVar: '--status-bad-solid' },
]);
</script>

<template>
  <section class="runs-chart">
    <div class="runs-chart__header">
      <span class="runs-chart__titulo rotulo">{{ t('labels.ops_chart_runs_over_time') }}</span>
      <div class="runs-chart__regla" aria-hidden="true"></div>
      <div class="runs-chart__leyenda">
        <div v-for="s in leyenda" :key="s.label" class="runs-chart__leyenda-item">
          <span class="runs-chart__leyenda-punto" :style="{ background: `var(${s.colorVar})` }" aria-hidden="true"></span>
          <span>{{ s.label }}</span>
        </div>
      </div>
    </div>

    <div class="runs-chart__cuerpo">
      <EsqueletoGrafico v-if="loading" alto="170px" />
      <p v-else-if="!hayDatos" class="runs-chart__estado">{{ t('labels.chart_no_runs_in_range') }}</p>
      <Chart v-else type="bar" :data="datosGrafica" :options="opcionesGrafica" class="runs-chart__canvas" />
    </div>
  </section>
</template>

<style scoped>
.runs-chart {
  flex-shrink: 0;
  margin-bottom: 30px;
}

.runs-chart__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.runs-chart__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.runs-chart__leyenda {
  display: flex;
  align-items: center;
  gap: 16px;
}

.runs-chart__leyenda-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.runs-chart__leyenda-punto {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex-shrink: 0;
}

.runs-chart__cuerpo {
  height: 220px;
}

.runs-chart__canvas {
  height: 220px;
}

.runs-chart__estado {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
  margin: 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
}
</style>
