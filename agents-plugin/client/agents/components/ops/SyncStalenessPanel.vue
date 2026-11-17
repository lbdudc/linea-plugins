<script setup>
import Chart from 'primevue/chart';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Esqueleto from '../common/Esqueleto.vue';
import EsqueletoLista from '../common/EsqueletoLista.vue';

import { useOpsChartColors } from './chartColors.js';

const props = defineProps({
  products: { type: Array, default: () => [] },
  stalenessStats: { type: Object, default: () => ({ recent: 0, stale7: 0, stale30: 0, stale90: 0, never: 0 }) },
  staleCount: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
});

const { t } = useI18n();
const colores = useOpsChartColors();

const hasProducts = computed(() => props.products.length > 0);

const recencyData = computed(() => {
  const c = colores.value;
  return {
    labels: [t('labels.recent'), t('labels.stale_7_30'), t('labels.stale_30_90'), t('labels.stale_90_plus'), t('labels.never_synced')],
    datasets: [{
      data: [
        props.stalenessStats.recent,
        props.stalenessStats.stale7,
        props.stalenessStats.stale30,
        props.stalenessStats.stale90,
        props.stalenessStats.never,
      ],
      backgroundColor: [c['--status-ok-solid'], c['--status-warn-solid'], c['--status-serious'], c['--status-bad-solid'], c['--p-text-dim-color']],
      borderRadius: 4,
    }],
  };
});
const recencyOptions = computed(() => {
  const c = colores.value;
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: c['--p-text-dim-color'], font: { size: 10.5 } } },
      y: { beginAtZero: true, grid: { color: c['--p-content-border-color'] }, ticks: { color: c['--p-text-dim-color'], precision: 0, font: { size: 10.5 } } },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y} ${t('labels.products').toLowerCase()}` } },
    },
  };
});

const DAY_MS = 86_400_000;
function lastSyncLabel(lastSyncAt) {
  if (!lastSyncAt) return t('labels.never_synced');
  const days = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / DAY_MS);
  if (days === 0) return t('labels.sync_today');
  return t('labels.sync_days_ago', { n: days });
}
function lastSyncColorVar(lastSyncAt) {
  if (!lastSyncAt) return '--status-bad-solid';
  const days = (Date.now() - new Date(lastSyncAt).getTime()) / DAY_MS;
  if (days < 7) return '--status-ok-solid';
  if (days < 30) return '--status-warn-solid';
  return '--status-bad-solid';
}
</script>

<template>
  <section class="staleness">
    <div class="staleness__header">
      <span class="staleness__titulo rotulo">{{ t('labels.sync_staleness') }}</span>
      <div class="staleness__regla" aria-hidden="true"></div>
    </div>

    <div class="staleness__kpis">
      <div class="staleness__kpi">
        <span class="staleness__kpi-valor cifra" :style="staleCount > 0 ? { color: 'var(--status-warn-solid)' } : null">{{ loading ? '…' : staleCount }}</span>
        <span class="staleness__kpi-label rotulo">{{ t('labels.stale_products') }}</span>
      </div>
      <div class="staleness__kpi">
        <span class="staleness__kpi-valor cifra" style="color: var(--status-ok-strong)">{{ loading ? '…' : stalenessStats.recent }}</span>
        <span class="staleness__kpi-label rotulo">{{ t('labels.recent') }}</span>
      </div>
      <div class="staleness__kpi">
        <span class="staleness__kpi-valor cifra" :style="stalenessStats.never > 0 ? { color: 'var(--status-bad-strong)' } : null">{{ loading ? '…' : stalenessStats.never }}</span>
        <span class="staleness__kpi-label rotulo">{{ t('labels.never_synced') }}</span>
      </div>
    </div>

    <div class="staleness__body">
      <div class="staleness__chart">
        <span class="staleness__chart-titulo">{{ t('labels.sync_staleness') }} <span class="staleness__chart-count ident">{{ products.length }} {{ t('labels.products') }}</span></span>
        <div class="staleness__chart-body">
          <Esqueleto v-if="loading" ancho="118px" alto="118px" radio="50%" />
          <p v-else-if="!hasProducts" class="staleness__estado">{{ t('labels.no_data') }}</p>
          <Chart v-else type="bar" :data="recencyData" :options="recencyOptions" />
        </div>
      </div>

      <div class="staleness__list-card">
        <span class="staleness__chart-titulo">{{ t('labels.last_synced') }}</span>
        <EsqueletoLista v-if="loading" :filas="4" :punto="false" />
        <p v-else-if="!hasProducts" class="staleness__estado staleness__estado--list">{{ t('labels.no_data') }}</p>
        <ul v-else class="staleness__list">
          <li v-for="p in products" :key="String(p._id)" class="staleness__item">
            <span class="staleness__item-info">
              <span class="staleness__item-nombre">{{ p.name }}</span>
              <span class="staleness__item-linea ident">{{ p.line }}</span>
            </span>
            <span class="staleness__badge" :style="{ color: `var(${lastSyncColorVar(p.lastSyncAt)})`, borderColor: `var(${lastSyncColorVar(p.lastSyncAt)})` }">
              {{ lastSyncLabel(p.lastSyncAt) }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.staleness {
  flex-shrink: 0;
  margin-top: 34px;
  padding-top: 26px;
  border-top: 1px solid var(--p-content-border-color);
}

.staleness__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.staleness__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.staleness__kpis {
  display: flex;
  gap: 28px;
  margin-bottom: 20px;
}

.staleness__kpi {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.staleness__kpi-valor {
  font-size: 24px;
  color: var(--p-text-color);
}

.staleness__body {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 16px;
}

.staleness__chart,
.staleness__list-card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  background: var(--p-content-background);
  padding: 14px 16px;
  min-width: 0;
}

.staleness__chart-titulo {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
  margin-bottom: 10px;
}

.staleness__chart-count {
  font-size: 11px;
  color: var(--p-text-muted-color);
  font-weight: 400;
}

.staleness__chart-body {
  height: 160px;
  position: relative;
}

.staleness__estado {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  margin: 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
}

.staleness__estado--list {
  height: auto;
  padding: 16px 0;
}

.staleness__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 230px;
  overflow-y: auto;
}

.staleness__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.staleness__item:last-child {
  border-bottom: none;
}

.staleness__item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.staleness__item-nombre {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.staleness__item-linea {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.staleness__badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: 10px;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .staleness__body {
    grid-template-columns: 1fr;
  }
}
</style>
