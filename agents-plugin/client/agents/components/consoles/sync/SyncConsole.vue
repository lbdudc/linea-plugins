<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';

import agentApi from '../../../api/agentApi.js';
import { scope } from '../../../stores/scope.js';
import { connect as conectarSocket } from '../../../boot/ws.js';
import { hasUnresolvedConflicts, runStatusLabel, runStatusStyle } from '../../activity/runStatus.js';

import AgentRunTimeline from '../harvest/AgentRunTimeline.vue';
import RunHistoryDrawer from '../harvest/RunHistoryDrawer.vue';
import HarvestToastHost from '../harvest/HarvestToastHost.vue';
import { notify } from '../harvest/notify.js';

import SyncLaunchDialog from './SyncLaunchDialog.vue';
import { buildBoardBuckets, canRetryResolver, filterLineRuns, relevantRun, syncForProduct } from './syncBoard.js';
import EsqueletoFichas from '../../common/EsqueletoFichas.vue';

const props = defineProps({
  runs: { type: Array, default: () => [] },
  decidingRunId: { type: String, default: null },
  starting: { type: Boolean, default: false },
});
const emit = defineEmits(['launch', 'decide', 'refine', 'restore']);

const { t } = useI18n();

const lineId = computed(() => scope.lineId);
const selectedRunId = ref(null);
const dialogOpen = ref(false);
const launchOpen = ref(false);

const products = ref([]);
const testResults = ref({});
const loadingProducts = ref(false);

const loadProducts = async () => {
  if (!lineId.value) {
    products.value = [];
    return;
  }
  loadingProducts.value = true;
  try {
    const enrolled = await agentApi.listEnrolledProducts();
    products.value = (enrolled ?? []).filter((p) => String(p.lineId ?? '') === String(lineId.value));
  } catch {
    products.value = [];
  } finally {
    loadingProducts.value = false;
  }
};

const loadTestResults = async () => {
  if (!lineId.value) {
    testResults.value = {};
    return;
  }
  try {
    const rows = await agentApi.listTestResults(lineId.value);
    testResults.value = Object.fromEntries(rows.map((r) => [String(r.productId), r]));
  } catch {
    testResults.value = {};
  }
};

watch(
  lineId,
  async () => {
    await Promise.all([loadProducts(), loadTestResults()]);
  },
  { immediate: true },
);

const lineRuns = computed(() => filterLineRuns(props.runs, lineId.value));

const batchRuns = computed(() =>
  [...lineRuns.value].filter((r) => r.agentType === 'line-sync').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
);
const latestBatch = computed(() => batchRuns.value[0] ?? null);
const batchActive = computed(() => ['queued', 'running', 'awaiting_child'].includes(latestBatch.value?.status));

const columns = computed(() => {
  const buckets = buildBoardBuckets(products.value, lineRuns.value, hasUnresolvedConflicts);
  return [
    { key: 'idle', title: t('labels.col_to_sync'), icon: 'pi pi-clock', hint: t('labels.col_to_sync_hint'), products: buckets.idle, esqueleto: 2 },
    { key: 'regenerating', title: t('labels.col_regenerating'), icon: 'pi pi-refresh', hint: t('labels.col_regenerating_hint'), products: buckets.regenerating, esqueleto: 1 },
    { key: 'conflict', title: t('labels.col_conflicts'), icon: 'pi pi-exclamation-triangle', hint: t('labels.col_conflicts_hint'), products: buckets.conflict, esqueleto: 2 },
    { key: 'clean', title: t('labels.col_clean'), icon: 'pi pi-check-circle', hint: t('labels.col_clean_hint'), products: buckets.clean, esqueleto: 1 },
    { key: 'failed', title: t('labels.col_failed'), icon: 'pi pi-times-circle', hint: t('labels.col_failed_hint'), products: buckets.failed, esqueleto: 1 },
  ];
});

const currentlyFailedProducts = computed(() => columns.value.find((c) => c.key === 'failed')?.products ?? []);

const fmtTime = (d) => (d ? new Date(d).toLocaleString() : t('labels.never'));
const selectedRun = computed(() => props.runs.find((r) => r._id === selectedRunId.value) ?? null);

const testing = reactive(new Set());

const testProduct = async (p) => {
  testing.add(String(p._id));
  try {
    await agentApi.runProductTest(p._id, { branch: 'main' });
  } catch {
    testing.delete(String(p._id));
    notify({ type: 'negative', message: t('labels.could_not_start_test') });
  }
};

const onPlaygroundEnd = ({ productId }) => {
  if (!productId) return;
  testing.delete(String(productId));
  loadTestResults();
};

onMounted(() => {
  conectarSocket().on('playground:done', onPlaygroundEnd);
  conectarSocket().on('playground:error', onPlaygroundEnd);
});
onBeforeUnmount(() => {
  conectarSocket().off('playground:done', onPlaygroundEnd);
  conectarSocket().off('playground:error', onPlaygroundEnd);
});

const testChip = (pid) => {
  if (testing.has(String(pid))) return { style: 'run', icon: 'pi pi-hourglass', label: t('labels.testing_short') };
  const r = testResults.value[String(pid)];
  if (!r) return null;
  if (r.status === 'error') return { style: 'neutral', icon: 'pi pi-question-circle', label: t('labels.no_tests') };
  if (r.passed) return { style: 'ok', icon: 'pi pi-check', label: t('labels.tests_pass') };
  return { style: 'bad', icon: 'pi pi-times', label: t('labels.tests_fail') };
};

const openProduct = (p) => {
  const run = relevantRun(lineRuns.value, p._id, hasUnresolvedConflicts);
  if (!run) return;
  selectedRunId.value = run._id;
  dialogOpen.value = true;
};

const rerunProduct = (p) => {
  if (!lineId.value) return;
  emit('launch', { agentType: 'regen', lineId: lineId.value, productId: p._id, input: {} });
};

const retryResolver = (p) => {
  if (!lineId.value) return;
  emit('launch', { agentType: 'sync', lineId: lineId.value, productId: p._id, input: {} });
  notify({ type: 'positive', message: t('labels.retrying_resolver') });
};

const onLaunchSync = ({ productIds, force }) => {
  if (!lineId.value) return;
  emit('launch', { agentType: 'line-sync', lineId: lineId.value, input: { productIds, force } });
  notify({ type: 'positive', message: t('labels.sync_started') });
};

const retryFailed = () => {
  const productIds = currentlyFailedProducts.value.map((p) => p._id);
  if (!lineId.value || !productIds.length) return;
  emit('launch', {
    agentType: 'line-sync',
    lineId: lineId.value,
    input: { productIds, force: Boolean(latestBatch.value?.input?.force) },
  });
  notify({ type: 'positive', message: t('labels.retrying_n_failed_products', { n: productIds.length }) });
};

const onDecide = (payload) => emit('decide', { runId: selectedRun.value?._id, ...payload });
const onRefine = (message) => emit('refine', { runId: selectedRun.value?._id, message });
const onRestore = ({ versionIndex }) => emit('restore', { runId: selectedRun.value?._id, versionIndex });

const productName = (p) => p.name ?? `${t('labels.product_singular')} ${String(p._id).slice(-6)}`;
const isConflictReview = (p) => syncForProduct(lineRuns.value, p._id)?.status === 'awaiting_approval';

const RUN_LABEL_KEY = { sync: 'labels.conflict_resolution', regen: 'labels.regeneration', 'line-sync': 'labels.line_sync' };
const runLabel = (run) => (RUN_LABEL_KEY[run.agentType] ? t(RUN_LABEL_KEY[run.agentType]) : run.agentType);
const historyOpen = ref(false);
const historyProduct = ref(null);
const historyRuns = computed(() => {
  if (!historyProduct.value) return [];
  const pid = String(historyProduct.value._id);
  return lineRuns.value.filter((r) => String(r.scope?.productId ?? '') === pid);
});
const openHistory = (p) => {
  historyProduct.value = p;
  historyOpen.value = true;
};
const openRunById = (run) => {
  selectedRunId.value = run._id;
  dialogOpen.value = true;
};
</script>

<template>
  <div class="sync-board">
    <HarvestToastHost />

    <div class="sync-board__controls">
      <Button
        icon="pi pi-sync"
        :label="t('labels.sync_line')"
        :loading="starting || batchActive"
        :disabled="!lineId || !products.length"
        :title="t('labels.sync_line_tooltip')"
        @click="launchOpen = true"
      />
      <Button text rounded icon="pi pi-refresh" :title="t('labels.refresh_products_tests')" @click="loadProducts(); loadTestResults();" />
      <Button
        v-if="currentlyFailedProducts.length"
        severity="danger"
        icon="pi pi-replay"
        :label="t('labels.retry_failed_count', { n: currentlyFailedProducts.length })"
        :loading="starting || batchActive"
        :title="t('labels.retry_failed_tooltip')"
        @click="retryFailed"
      />
      <div class="sync-board__spacer"></div>
      <div v-if="latestBatch" class="sync-board__last-sync">
        {{ t('labels.last_sync') }}: {{ fmtTime(latestBatch.createdAt) }}
        <span class="sync-board__batch-status" :style="{ color: runStatusStyle(latestBatch).fg }">
          <span class="sync-board__batch-dot" :style="{ background: runStatusStyle(latestBatch).dot }" aria-hidden="true"></span>
          {{ runStatusLabel(latestBatch) }}
        </span>
      </div>
    </div>

    <p v-if="!lineId" class="sync-board__aviso">
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      {{ t('labels.flow_pick_line') }}
    </p>

    <div v-else class="board">
      <div v-for="col in columns" :key="col.key" class="board__col">
        <div class="board__col-head" :title="col.hint">
          <i :class="col.icon" aria-hidden="true"></i>
          <span class="board__col-title">{{ col.title }}</span>
          <span class="board__col-badge">{{ col.products.length }}</span>
        </div>
        <div class="board__col-body">
          <EsqueletoFichas v-if="loadingProducts" :fichas="col.esqueleto" />
          <div v-else-if="!col.products.length" class="board__empty">{{ t('labels.board_column_empty') }}</div>

          <div
            v-for="p in col.products"
            :key="p._id"
            class="card"
            :class="{ 'card--click': !!relevantRun(lineRuns, p._id, hasUnresolvedConflicts), 'card--active': relevantRun(lineRuns, p._id, hasUnresolvedConflicts)?._id === selectedRunId }"
            @click="openProduct(p)"
          >
            <div class="card__row">
              <span class="card__title">{{ productName(p) }}</span>
              <div class="sync-board__spacer"></div>
              <span v-if="relevantRun(lineRuns, p._id, hasUnresolvedConflicts)" class="card__status" :style="{ color: runStatusStyle(relevantRun(lineRuns, p._id, hasUnresolvedConflicts)).fg }">
                <span class="card__status-dot" :style="{ background: runStatusStyle(relevantRun(lineRuns, p._id, hasUnresolvedConflicts)).dot }" aria-hidden="true"></span>
                {{ runStatusLabel(relevantRun(lineRuns, p._id, hasUnresolvedConflicts)) }}
              </span>
              <span v-else class="chip chip--neutral">{{ t('labels.idle_status') }}</span>
            </div>

            <div class="card__row">
              <i v-if="col.key === 'regenerating'" class="pi pi-spin pi-spinner" aria-hidden="true"></i>
              <span v-if="testChip(p._id)" class="chip" :class="`chip--${testChip(p._id).style}`">
                <i :class="[testChip(p._id).icon, { 'pi-spin': testChip(p._id).style === 'run' }]" aria-hidden="true"></i> {{ testChip(p._id).label }}
              </span>
              <Button
                v-if="isConflictReview(p)"
                text size="small" icon="pi pi-eye" :label="t('labels.review_label')"
                class="card__review-btn"
                @click.stop="openProduct(p)"
              />
            </div>

            <div class="card__time">{{ t('labels.last_sync_prefix') }} {{ fmtTime(p.lastSyncAt) }}</div>

            <div class="card__row">
              <button type="button" class="icon-btn" :disabled="testing.has(String(p._id))" :title="t('labels.run_tests')" @click.stop="testProduct(p)">
                <i class="pi pi-play-circle" aria-hidden="true"></i>
              </button>
              <button type="button" class="icon-btn" :disabled="starting || col.key === 'regenerating'" :title="t('labels.re_run_tooltip')" @click.stop="rerunProduct(p)">
                <i class="pi pi-refresh" aria-hidden="true"></i>
              </button>
              <button
                v-if="canRetryResolver(lineRuns, p._id)"
                type="button" class="icon-btn icon-btn--accent" :disabled="starting" :title="t('labels.retry_resolver_tooltip')"
                @click.stop="retryResolver(p)"
              >
                <i class="pi pi-sitemap" aria-hidden="true"></i>
              </button>
              <button type="button" class="icon-btn" :title="t('labels.run_history_for_product')" @click.stop="openHistory(p)">
                <i class="pi pi-history" aria-hidden="true"></i>
              </button>
              <a v-if="p.repo?.webUrl" :href="p.repo.webUrl" target="_blank" rel="noopener noreferrer" class="icon-btn" :title="t('labels.open_product_repository')" @click.stop>
                <i class="pi pi-external-link" aria-hidden="true"></i>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Dialog
      :visible="dialogOpen"
      modal
      class="run-dialog"
      :header="selectedRun ? (selectedRun.agentType === 'sync' ? t('labels.conflict_resolution') : t('labels.regeneration')) : t('labels.run_detail_label')"
      @update:visible="(v) => (dialogOpen = v)"
    >
      <AgentRunTimeline
        v-if="selectedRun"
        :run="selectedRun"
        :busy="decidingRunId === selectedRun._id"
        @decide="onDecide"
        @refine="onRefine"
        @restore="onRestore"
      />
    </Dialog>

    <SyncLaunchDialog v-model="launchOpen" :products="products" :busy="starting" @launch="onLaunchSync" />

    <RunHistoryDrawer
      v-model="historyOpen"
      :title="t('labels.run_history')"
      :subtitle="historyProduct ? productName(historyProduct) : ''"
      :runs="historyRuns"
      :label-for="runLabel"
      @open-run="openRunById"
    />
  </div>
</template>

<style scoped>
.sync-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 18px 20px 20px;
}

.sync-board__spacer {
  flex: 1;
}

.sync-board__controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.sync-board__last-sync {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.sync-board__batch-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.sync-board__batch-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.sync-board__aviso {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 9px 12px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  background: var(--p-highlight-soft);
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
}

.board {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  overflow-x: auto;
}

.board__col {
  display: flex;
  flex-direction: column;
  min-width: 220px;
  flex: 1 1 0;
  min-height: 0;
}

.board__col-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 4px 10px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-text-dim-color);
  border-bottom: 1px solid var(--p-content-border-color);
  margin-bottom: 8px;
}

.board__col-badge {
  padding: 0 6px;
  border-radius: 20px;
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
  font-size: 10.5px;
}

.board__col-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px;
}

.board__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--p-text-dim-color);
  font-size: 12px;
  padding: 8px 4px;
}

.card {
  padding: 10px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
  background: var(--p-content-background);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card--click {
  cursor: pointer;
}

.card--click:hover {
  background: var(--p-content-hover-background);
}

.card--active {
  outline: 2px solid var(--p-agent-color);
  outline-offset: -1px;
}

.card__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  flex: none;
}

.card__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.card__review-btn {
  padding: 0;
}

.card__time {
  font-size: 11px;
  color: var(--p-text-dim-color);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 20px;
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.chip--ok {
  border-color: var(--status-ok-solid);
  color: var(--status-ok-solid);
}

.chip--bad {
  border-color: var(--status-bad-solid);
  color: var(--status-bad-solid);
}

.chip--run {
  border-color: var(--p-agent-color);
  color: var(--p-agent-color);
}

.chip--neutral {
  border-color: var(--p-text-faint-color);
  color: var(--p-text-muted-color);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  flex: none;
}

.icon-btn:hover {
  background: var(--hover-veil);
}

.icon-btn--accent {
  color: var(--p-agent-color);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

</style>

<style>
.p-dialog.run-dialog {
  width: 760px;
  max-width: 96vw;
}
</style>
