<script setup>
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';

import agentApi from '../../../api/agentApi.js';
import { runStatusLabel, runStatusStyle } from '../../activity/runStatus.js';

import { computeRunStats, coveragePercent, formatDurationMs, recentRuns } from './lineHealth.js';
import ProductComparisonModal from './ProductComparisonModal.vue';

const props = defineProps({
  lineId: { type: String, required: true },
  healthSummary: { type: Object, default: null },
  modelStats: { type: Object, default: null },
  products: { type: Array, default: () => [] },
});

const { t } = useI18n();

const tab = ref('overview');
const runs = ref([]);
const runsLoading = shallowRef(false);
const comparisonOpen = ref(false);

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');

const coverage = computed(() => coveragePercent(props.healthSummary));
const runStats = computed(() => computeRunStats(runs.value));
const recent = computed(() => recentRuns(runs.value, 8));

async function fetchRuns() {
  runsLoading.value = true;
  try {
    runs.value = await agentApi.listRuns({ lineId: props.lineId });
  } finally {
    runsLoading.value = false;
  }
}

onMounted(fetchRuns);
</script>

<template>
  <div class="lhd">
    <Tabs v-model:value="tab">
      <div class="lhd__header">
        <div class="lhd__title"><i class="pi pi-heart-fill" aria-hidden="true"></i> {{ t('labels.line_health') }}</div>
        <TabList class="lhd__tabs">
          <Tab value="overview">{{ t('labels.overview') }}</Tab>
          <Tab value="runs">{{ t('labels.agent_runs') }}</Tab>
        </TabList>
        <Button
          v-if="products.length >= 2"
          text size="small" icon="pi pi-clone"
          :label="t('labels.compare')"
          @click="comparisonOpen = true"
        />
        <Button text rounded icon="pi pi-refresh" :loading="runsLoading" @click="fetchRuns" />
      </div>

      <TabPanels>
        <TabPanel value="overview" class="lhd__panel">
          <div class="lhd__grid">
            <div class="lhd__tile">
              <div class="lhd__tile-label"><i class="pi pi-sitemap" aria-hidden="true"></i> {{ t('labels.feature_model_tile') }}</div>
              <div class="lhd__tile-value">
                <template v-if="modelStats">
                  {{ modelStats.featureCount != null ? modelStats.featureCount : '—' }}
                  <span class="lhd__tile-unit">{{ t('labels.features_count_unit') }}</span>
                </template>
                <template v-else>—</template>
              </div>
              <span v-if="modelStats" class="lhd__badge">{{ modelStats.format ?? '?' }}</span>
            </div>

            <div class="lhd__tile">
              <div class="lhd__tile-label"><i class="pi pi-shield" aria-hidden="true"></i> {{ t('labels.product_coverage') }}</div>
              <template v-if="healthSummary && healthSummary.total > 0">
                <div class="lhd__tile-value">{{ coverage }}<span class="lhd__tile-unit">%</span></div>
                <ProgressBar :value="coverage" :show-value="false" class="lhd__progress" :class="{ 'lhd__progress--warn': healthSummary.invalid > 0 }" />
                <div class="lhd__chip-row">
                  <span class="lhd__chip lhd__chip--ok"><i class="pi pi-check-circle" aria-hidden="true"></i> {{ healthSummary.valid }}</span>
                  <span class="lhd__chip lhd__chip--bad"><i class="pi pi-times-circle" aria-hidden="true"></i> {{ healthSummary.invalid }}</span>
                </div>
              </template>
              <div v-else class="lhd__tile-value">—</div>
            </div>

            <div class="lhd__tile">
              <div class="lhd__tile-label"><i class="pi pi-bolt" aria-hidden="true"></i> {{ t('labels.agent_runs') }}</div>
              <div class="lhd__tile-value">{{ runStats.total }}</div>
              <div class="lhd__chip-row">
                <span v-if="runStats.awaiting > 0" class="lhd__chip lhd__chip--warn"><i class="pi pi-clock" aria-hidden="true"></i> {{ runStats.awaiting }} {{ t('labels.runs_pending') }}</span>
                <span v-if="runStats.failed > 0" class="lhd__chip lhd__chip--bad"><i class="pi pi-times-circle" aria-hidden="true"></i> {{ runStats.failed }} {{ t('labels.runs_failed') }}</span>
                <span v-if="runStats.awaiting === 0 && runStats.failed === 0 && runStats.done > 0" class="lhd__chip lhd__chip--ok"><i class="pi pi-check-circle" aria-hidden="true"></i> {{ runStats.done }} {{ t('labels.runs_done') }}</span>
              </div>
            </div>
          </div>
        </TabPanel>

        <TabPanel value="runs" class="lhd__panel lhd__panel--runs">
          <div v-if="runsLoading && !runs.length" class="lhd__state">
            <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
            <span>{{ t('labels.loading_runs') }}</span>
          </div>
          <div v-else-if="!runs.length" class="lhd__state">
            <i class="pi pi-bolt" aria-hidden="true"></i>
            <span>{{ t('labels.no_agent_runs_yet') }}</span>
          </div>
          <div v-else class="lhd__runs">
            <div v-for="run in recent" :key="run._id" class="lhd__run">
              <span class="lhd__run-dot" :style="{ background: runStatusStyle(run).dot }" aria-hidden="true"></span>
              <div class="lhd__run-body">
                <div class="lhd__run-header">
                  <span class="lhd__run-type">{{ run.agentType }}</span>
                  <span v-if="run.input?.dryRun" class="lhd__badge lhd__badge--outline">{{ t('labels.dry_run_badge') }}</span>
                </div>
                <div class="lhd__run-meta">
                  {{ fmtDate(run.createdAt) }}
                  <template v-if="formatDurationMs(run.durationMs)"> · {{ formatDurationMs(run.durationMs) }}</template>
                  <template v-if="run.result?.mrUrl">
                    · <a :href="run.result.mrUrl" target="_blank" rel="noopener noreferrer" class="lhd__run-link">{{ t('labels.mr_opened') }}</a>
                  </template>
                </div>
              </div>
              <span class="lhd__run-status" :style="{ color: runStatusStyle(run).fg }">{{ runStatusLabel(run) }}</span>
            </div>
            <div v-if="runs.length > 8" class="lhd__more">+{{ runs.length - 8 }} {{ t('labels.more_runs_count') }}</div>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <ProductComparisonModal v-model="comparisonOpen" :products="products" />
  </div>
</template>

<style scoped>
.lhd {
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  background: var(--p-content-background);
}

.lhd__header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.lhd__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--p-text-color);
  white-space: nowrap;
}

.lhd__title i {
  color: var(--p-agent-color);
}

.lhd__tabs {
  flex: 1;
}

.lhd__tabs :deep(.p-tablist-tab-list) {
  background: transparent;
  border: none;
}

.lhd__panel {
  padding: 16px;
}

.lhd__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.lhd__tile {
  background: var(--p-surface-ground);
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  padding: 12px 14px;
}

.lhd__tile-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-dim-color);
  margin-bottom: 8px;
}

.lhd__tile-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  color: var(--p-text-color);
}

.lhd__tile-unit {
  font-size: 12px;
  font-weight: 400;
  color: var(--p-text-muted-color);
  margin-left: 3px;
}

.lhd__badge {
  display: inline-block;
  margin-top: 8px;
  padding: 2px 8px;
  border-radius: 20px;
  background: var(--p-agent-highlight);
  color: var(--p-agent-color);
  font-size: 10.5px;
}

.lhd__badge--outline {
  background: transparent;
  border: 1px solid var(--p-text-faint-color);
  color: var(--p-text-muted-color);
  margin-top: 0;
}

.lhd__progress {
  height: 5px;
  margin-top: 8px;
}

.lhd__progress :deep(.p-progressbar-value) {
  background: var(--status-ok-solid);
}

.lhd__progress--warn :deep(.p-progressbar-value) {
  background: var(--status-warn-solid);
}

.lhd__chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.lhd__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 20px;
  font-size: 10.5px;
  border: 1px solid var(--p-content-border-color);
  color: var(--p-text-muted-color);
}

.lhd__chip--ok {
  border-color: var(--status-ok-solid);
  color: var(--status-ok-solid);
}

.lhd__chip--bad {
  border-color: var(--status-bad-solid);
  color: var(--status-bad-solid);
}

.lhd__chip--warn {
  border-color: var(--status-warn-solid);
  color: var(--status-warn-solid);
}

.lhd__panel--runs {
  padding-top: 10px;
}

.lhd__state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 4px;
  font-size: 13px;
  color: var(--p-text-muted-color);
}

.lhd__runs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lhd__run {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-surface-ground);
}

.lhd__run-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.lhd__run-body {
  flex: 1;
  min-width: 0;
}

.lhd__run-header {
  display: flex;
  align-items: center;
  gap: 7px;
}

.lhd__run-type {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-text-color);
}

.lhd__run-meta {
  font-size: 11px;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lhd__run-link {
  color: var(--p-agent-color);
}

.lhd__run-status {
  font-size: 11px;
  flex: none;
}

.lhd__more {
  text-align: center;
  font-size: 11px;
  color: var(--p-text-muted-color);
  padding: 4px 0 2px;
}
</style>
