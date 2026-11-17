<script setup>
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import ProgressBar from 'primevue/progressbar';

import agentApi from '../../../api/agentApi.js';
import { connect as conectarSocket } from '../../../boot/ws.js';
import EsqueletoLista from '../../common/EsqueletoLista.vue';
import { notify } from '../harvest/notify.js';
import { failedCount as countFailed, jobFor, normalizeFeatures, passedCount as countPassed, runningCount as countRunning } from './playgroundJobs.js';
import PlaygroundProductRow from './PlaygroundProductRow.vue';

const props = defineProps({
  runId: { type: String, required: true },
  run: { type: Object, required: true },
  proposal: { type: Object, default: null },
  mode: { type: String, default: 'proposal' },
});

const { t } = useI18n();

const isBranchMode = () => props.mode === 'plan_branch';

const products = ref([]);
const fmCurrent = ref(null);
const fmProposed = ref(null);
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    const lineId = props.run?.scope?.lineId;
    if (!lineId) return;

    const fetchFm = isBranchMode()
      ? agentApi.getPlaygroundBranchFm(props.runId).catch(() => ({ current: null, proposed: null }))
      : agentApi.getPlaygroundFm(props.runId);

    const [enrolled, fmTrees] = await Promise.allSettled([
      agentApi.listEnrolledProducts(),
      fetchFm,
    ]);

    if (enrolled.status === 'fulfilled') {
      products.value = (enrolled.value ?? []).filter((p) => String(p.lineId) === String(lineId));
    }

    if (fmTrees.status === 'fulfilled') {
      fmCurrent.value = fmTrees.value.current ?? null;
      fmProposed.value = fmTrees.value.proposed ?? null;
    }
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_load_playground') });
  } finally {
    loading.value = false;
  }
});

watch(
  () => [props.proposal?.body?.newModelUvl, (props.proposal?.body?.fileEdits ?? []).length],
  async () => {
    if (isBranchMode() || !props.proposal) return;
    try {
      const fmTrees = await agentApi.getPlaygroundFm(props.runId);
      fmCurrent.value = fmTrees.current ?? null;
      fmProposed.value = fmTrees.proposed ?? null;
    } catch { /* best-effort */ }
  },
);

const refreshFm = async () => {
  try {
    const fmTrees = isBranchMode()
      ? await agentApi.getPlaygroundBranchFm(props.runId)
      : await agentApi.getPlaygroundFm(props.runId);
    fmCurrent.value = fmTrees.current ?? null;
    fmProposed.value = fmTrees.proposed ?? null;
  } catch { /* best-effort */ }
};

defineExpose({ refreshFm });

const rowRefs = new Map();
const registerRowRef = (productId, el) => {
  if (el) rowRefs.set(String(productId), el);
  else rowRefs.delete(String(productId));
};

const onRunAll = () => {
  for (const row of rowRefs.values()) row?.triggerRun?.();
};

const jobs = reactive({});
const ensureJob = (productId) => {
  if (!jobs[productId]) jobs[productId] = { status: 'idle', jobId: null, log: [] };
  return jobs[productId];
};

const logLines = (productId) => jobFor(jobs, productId).log;
const statusOf = (productId) => jobFor(jobs, productId).status;

const assumePass = ref(false);

const onRun = async (config) => {
  const job = ensureJob(config.productId);
  job.status = 'running';
  job.log = [];
  const payload = { ...config, skipTests: assumePass.value };
  try {
    const { jobId } = isBranchMode()
      ? await agentApi.runPlaygroundBranchTest(props.runId, payload)
      : await agentApi.runPlaygroundTest(props.runId, payload);
    job.jobId = jobId;
  } catch (err) {
    job.status = 'error';
    job.log.push(`[error] ${err?.response?.data?.error ?? err.message}\n`);
  }
};

const onCancel = async (productId) => {
  const job = ensureJob(productId);
  if (!job?.jobId) return;
  try {
    await agentApi.cancelPlaygroundJob(props.runId, job.jobId);
    job.status = 'cancelled';
    job.log.push('\n[cancelled by user]\n');
  } catch (err) {
    notify({ type: 'warning', message: err?.response?.data?.error ?? err.message });
  }
};

const findJob = (jobId) => Object.values(jobs).find((j) => j.jobId === jobId);

const onPlaygroundStart = ({ jobId, productId }) => {
  const job = ensureJob(productId);
  job.jobId = jobId;
  job.status = 'running';
};
const onPlaygroundLog = ({ jobId, line }) => {
  const job = findJob(jobId);
  if (job) job.log.push(line);
};
const onPlaygroundDone = ({ jobId, exitCode, passed }) => {
  const job = findJob(jobId);
  if (job) {
    job.status = passed ? 'passed' : 'failed';
    job.log.push(`\n[exit code: ${exitCode}]\n`);
  }
};
const onPlaygroundError = ({ jobId, productId, message }) => {
  const job = jobId ? findJob(jobId) : (productId ? ensureJob(productId) : null);
  if (job) {
    job.status = 'error';
    job.log.push(`\n[error] ${message}\n`);
  }
};

onMounted(() => {
  conectarSocket().on('playground:start', onPlaygroundStart);
  conectarSocket().on('playground:log', onPlaygroundLog);
  conectarSocket().on('playground:done', onPlaygroundDone);
  conectarSocket().on('playground:error', onPlaygroundError);
});
onBeforeUnmount(() => {
  conectarSocket().off('playground:start', onPlaygroundStart);
  conectarSocket().off('playground:log', onPlaygroundLog);
  conectarSocket().off('playground:done', onPlaygroundDone);
  conectarSocket().off('playground:error', onPlaygroundError);
});
</script>

<template>
  <div class="pg">
    <div class="pg__head">
      <i class="pi pi-desktop" aria-hidden="true"></i>
      <span class="pg__title">{{ t('labels.playground') }}</span>
      <Button
        text size="small"
        icon="pi pi-play-circle"
        :label="t('labels.run_all')"
        :disabled="!products.length || loading"
        :title="t('labels.run_tests_for_all_products')"
        @click="onRunAll"
      />
      <div class="pg__assume">
        <Checkbox v-model="assumePass" :binary="true" input-id="pg-assume-pass" />
        <label for="pg-assume-pass" :title="t('labels.assume_pass_tooltip')">{{ t('labels.assume_pass') }}</label>
      </div>
      <div class="pg__spacer"></div>
      <span v-if="countRunning(jobs) > 0" class="pg__count pg__count--running">
        <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.running_count', { n: countRunning(jobs) }) }}
      </span>
      <span v-if="countPassed(jobs) > 0" class="pg__count pg__count--passed">{{ t('labels.passed_count', { n: countPassed(jobs) }) }}</span>
      <span v-if="countFailed(jobs) > 0" class="pg__count pg__count--failed">{{ t('labels.failed_count', { n: countFailed(jobs) }) }}</span>
      <span v-if="mode !== 'plan_branch' && proposal?.body?.featureName" class="pg__chip">
        <i class="pi pi-plus" aria-hidden="true"></i> {{ proposal.body.featureName }}
      </span>
    </div>

    <div v-if="loading" class="pg__loading">
      <ProgressBar mode="indeterminate" style="height: 4px" />
      <EsqueletoLista :filas="4" :punto="false" encuadrada />
    </div>

    <div v-else-if="!products.length" class="pg__empty">
      <i class="pi pi-box" aria-hidden="true"></i>
      <span>{{ t('labels.no_products_found_in_line') }}</span>
    </div>

    <div v-else class="pg__rows">
      <p class="pg__hint">{{ t('labels.playground_hint') }}</p>
      <PlaygroundProductRow
        v-for="product in products"
        :key="String(product._id)"
        :ref="(el) => registerRowRef(product._id, el)"
        :run-id="runId"
        :mode="mode"
        :product-id="String(product._id)"
        :product-name="product.spec?.basicData?.name ?? product.name ?? String(product._id)"
        :initial-features="normalizeFeatures(product.spec)"
        :initial-test-image="product.spec?.basicData?.testEnvironment?.image ?? ''"
        :initial-test-command="product.spec?.basicData?.testEnvironment?.command ?? ''"
        :fm-current="fmCurrent"
        :fm-proposed="fmProposed"
        :status="statusOf(String(product._id))"
        :log-lines="logLines(String(product._id))"
        @run="onRun"
        @cancel="onCancel"
      />
    </div>
  </div>
</template>

<style scoped>
.pg {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.pg__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  background: var(--p-content-hover-background);
  font-size: 12.5px;
  flex: none;
}

.pg__title {
  font-weight: 600;
  color: var(--p-text-color);
}

.pg__assume {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--status-ok-strong);
}

.pg__spacer {
  flex: 1;
}

.pg__count {
  font-size: 12px;
}

.pg__count--running {
  color: var(--p-agent-color);
}

.pg__count--passed {
  color: var(--status-ok-solid);
}

.pg__count--failed {
  color: var(--status-bad-solid);
}

.pg__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--p-agent-color);
  color: var(--p-agent-color);
  font-size: 11px;
}

.pg__loading {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

.pg__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: var(--p-text-dim-color);
  font-size: 12.5px;
}

.pg__rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.pg__hint {
  margin: 0;
  padding: 8px 14px 4px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}
</style>
