<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import agentApi from '../api/agentApi.js';
import { scope } from '../stores/scope.js';
import { agentRunStore } from '../stores/agentRunStore.js';
import { connect as conectarSocket } from '../boot/ws.js';

import SyncConsole from '../components/consoles/sync/SyncConsole.vue';
import { notify } from '../components/consoles/harvest/notify.js';

const { t } = useI18n();

const cargando = ref(false);
const starting = ref(false);
const decidingRunId = ref(null);
const error = ref('');

const errMsg = (err) => err.response?.data?.error ?? err.message ?? t('labels.flow_load_error');

async function cargar() {
  cargando.value = true;
  error.value = '';
  try {
    const lista = await agentApi.listRuns({ lineId: scope.lineId, productId: scope.productId });
    agentRunStore.setAll(lista);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    cargando.value = false;
  }
}

async function onLaunch({ agentType, lineId, productId, input }) {
  starting.value = true;
  try {
    const run = await agentApi.createRun({ agentType, scope: productId ? { lineId, productId } : { lineId }, input: input ?? {} });
    agentRunStore.upsert(run);
  } catch (e) {
    notify({ type: 'negative', message: errMsg(e) });
  } finally {
    starting.value = false;
  }
}

async function onDecide({ runId, proposalId, decision, meta }) {
  decidingRunId.value = runId;
  try {
    const run = await agentApi.decide(runId, { proposalId, decision, meta });
    agentRunStore.upsert(run);
  } catch (e) {
    notify({ type: 'negative', message: errMsg(e) });
  } finally {
    decidingRunId.value = null;
  }
}

async function onRefine({ runId, message }) {
  try {
    await agentApi.refine(runId, message);
  } catch (e) {
    notify({ type: 'negative', message: errMsg(e) });
  }
}

async function onRestore({ runId, versionIndex }) {
  try {
    await agentApi.restoreVersion(runId, { versionIndex });
  } catch (e) {
    notify({ type: 'negative', message: errMsg(e) });
  }
}

function alPaso({ runId, status, step }) {
  agentRunStore.mergeStep(runId, status, step);
}
function alRun({ run }) {
  agentRunStore.upsert(run);
}
function alPropuesta({ runId, proposal }) {
  agentRunStore.mergeProposal(runId, proposal);
}

onMounted(() => {
  cargar();
  conectarSocket().on('agent-step', alPaso);
  conectarSocket().on('agent-run', alRun);
  conectarSocket().on('agent-proposal', alPropuesta);
});

onBeforeUnmount(() => {
  conectarSocket().off('agent-step', alPaso);
  conectarSocket().off('agent-run', alRun);
  conectarSocket().off('agent-proposal', alPropuesta);
});

watch(() => [scope.lineId, scope.productId], cargar);
</script>

<template>
  <section class="propagacion">
    <header class="propagacion__cab">
      <p class="rotulo">{{ t('labels.section_pipelines') }}</p>
      <h1 class="cifra propagacion__titulo">{{ t('labels.flow_stage_propagation') }}</h1>
    </header>

    <p v-if="cargando" class="propagacion__cargando">
      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.loading') }}
    </p>

    <SyncConsole
      :runs="agentRunStore.runs"
      :deciding-run-id="decidingRunId"
      :starting="starting"
      @launch="onLaunch"
      @decide="onDecide"
      @refine="onRefine"
      @restore="onRestore"
    />

    <p v-if="error" class="propagacion__error" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ error }}
    </p>
  </section>
</template>

<style scoped>
.propagacion {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.propagacion__cab {
  padding: 24px 32px 0;
  flex: none;
}

.propagacion__titulo {
  font-size: 32px;
  margin: 2px 0 0;
}

.propagacion__cargando {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 32px 0;
  font-size: 12px;
  color: var(--p-text-muted-color);
  flex: none;
}

.propagacion__error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 32px;
  font-size: 12px;
  color: var(--status-bad);
  background: var(--status-bad-soft);
  border-top: 1px solid var(--status-bad-border);
  flex: none;
}
</style>
