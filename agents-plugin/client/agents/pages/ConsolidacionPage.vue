<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import agentApi from '../api/agentApi.js';
import { scope } from '../stores/scope.js';
import { agentRunStore } from '../stores/agentRunStore.js';
import { connect as conectarSocket } from '../boot/ws.js';

import CoEvolutionConsole from '../components/consoles/consolidacion/CoEvolutionConsole.vue';
import { notify } from '../components/consoles/harvest/notify.js';
import HarvestToastHost from '../components/consoles/harvest/HarvestToastHost.vue';

const { t } = useI18n();

const cargando = ref(false);
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

async function onCancel({ runId }) {
  try {
    const run = await agentApi.cancel(runId);
    agentRunStore.upsert(run);
    notify({ type: 'info', message: t('labels.run_cancel_ok') });
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
  <section class="consolidacion">
    <HarvestToastHost />

    <header class="consolidacion__cab">
      <p class="rotulo">{{ t('labels.section_pipelines') }}</p>
      <h1 class="cifra consolidacion__titulo">{{ t('labels.flow_stage_into_spl') }}</h1>
      <p v-if="!scope.lineId" class="consolidacion__aviso">
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        {{ t('labels.flow_pick_line') }}
      </p>
    </header>

    <p v-if="cargando" class="consolidacion__cargando">
      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.loading') }}
    </p>

    <CoEvolutionConsole
      :runs="agentRunStore.runs"
      :deciding-run-id="decidingRunId"
      class="consolidacion__console"
      @decide="onDecide"
      @refine="onRefine"
      @restore="onRestore"
      @cancel="onCancel"
    />

    <p v-if="error" class="consolidacion__error" role="alert">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ error }}
    </p>
  </section>
</template>

<style scoped>
.consolidacion {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.consolidacion__cab {
  padding: 24px 32px 0;
  flex: none;
}

.consolidacion__titulo {
  font-size: 32px;
  margin: 2px 0 0;
}

.consolidacion__aviso {
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

.consolidacion__cargando {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 32px 0;
  font-size: 12px;
  color: var(--p-text-muted-color);
  flex: none;
}

.consolidacion__console {
  flex: 1;
  min-height: 0;
}

.consolidacion__error {
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
