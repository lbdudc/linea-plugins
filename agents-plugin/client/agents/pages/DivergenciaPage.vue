<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import agentApi from '../api/agentApi.js';
import { scope } from '../stores/scope.js';
import { agentRunStore } from '../stores/agentRunStore.js';
import { connect as conectarSocket } from '../boot/ws.js';

import HarvestConsole from '../components/consoles/harvest/HarvestConsole.vue';
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
  <section class="divergencia">
    <header class="divergencia__cab">
      <p class="rotulo">{{ t('labels.section_pipelines') }}</p>
      <h1 class="cifra divergencia__titulo">{{ t('labels.flow_stage_divergence') }}</h1>
      <p v-if="!scope.lineId" class="divergencia__aviso">
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        {{ t('labels.flow_pick_line') }}
      </p>
    </header>

    <p v-if="cargando" class="divergencia__cargando">
      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.loading') }}
    </p>

    <HarvestConsole :runs="agentRunStore.runs" :deciding-run-id="decidingRunId" :starting="starting" @launch="onLaunch" @decide="onDecide" @refine="onRefine" @restore="onRestore" />

    <p v-if="error" class="divergencia__error" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ error }}
    </p>
  </section>
</template>

<style scoped>
.divergencia {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.divergencia__cab {
  padding: 24px 32px 0;
  flex: none;
}

.divergencia__titulo {
  font-size: 32px;
  margin: 2px 0 0;
}

.divergencia__cargando {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 32px 0;
  font-size: 12px;
  color: var(--p-text-muted-color);
  flex: none;
}

.divergencia__aviso {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 0;
  padding: 9px 12px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  background: var(--p-highlight-soft);
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
}

.divergencia__error {
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
