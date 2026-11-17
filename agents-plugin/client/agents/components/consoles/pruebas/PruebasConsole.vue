<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import Select from 'primevue/select';

import agentApi from '../../../api/agentApi.js';
import { scope } from '../../../stores/scope.js';
import { agentTitle } from '../../activity/agentTitles.js';
import { relativeAge } from '../../activity/format.js';
import { runStatusLabel, runStatusStyle } from '../../activity/runStatus.js';
import HarvestToastHost from '../harvest/HarvestToastHost.vue';
import { notify } from '../harvest/notify.js';

import SandboxTab from './SandboxTab.vue';
import PlaygroundTab from './PlaygroundTab.vue';

const { t } = useI18n();
const route = useRoute();

const REVIEW_KINDS = ['fm_patch', 'merge_resolution'];

const runs = ref([]);
const loading = ref(false);
const selectedId = ref(typeof route.query.runId === 'string' ? route.query.runId : null);

const eligibleRuns = computed(() =>
  runs.value.filter((r) => r.agentType === 'changeset' || ['harvest', 'sync'].includes(r.agentType)),
);

const runOptions = computed(() => eligibleRuns.value.map((r) => ({
  value: String(r._id),
  label: `${agentTitle(r.agentType)} · ${r.scope?.productName ?? r.scope?.lineName ?? '—'} · ${relativeAge(r.createdAt)}`,
  run: r,
})));

const selectedRun = computed(() => eligibleRuns.value.find((r) => String(r._id) === String(selectedId.value)) ?? null);

const isChangeset = computed(() => selectedRun.value?.agentType === 'changeset');

const sandboxProposal = computed(() => {
  if (!isChangeset.value) return null;
  return (selectedRun.value?.proposals ?? []).find((p) => p.kind === 'sandbox_iteration' && !p.decision) ?? null;
});

const playgroundProposal = computed(() => {
  if (isChangeset.value || !selectedRun.value) return null;
  return (selectedRun.value.proposals ?? []).find((p) => REVIEW_KINDS.includes(p.kind) && !p.decision) ?? null;
});

async function cargarRuns() {
  loading.value = true;
  try {
    const lista = await agentApi.listRuns({ lineId: scope.lineId });
    runs.value = lista;
    if (!selectedId.value && lista.length) {
      const primero = lista.find((r) => r.agentType === 'changeset' || ['harvest', 'sync'].includes(r.agentType));
      if (primero) selectedId.value = String(primero._id);
    }
  } catch {
    notify({ type: 'negative', message: t('labels.activity_load_list_error') });
  } finally {
    loading.value = false;
  }
}

onMounted(cargarRuns);
watch(() => scope.lineId, cargarRuns);

const deciding = ref(false);
const onDecide = async ({ runId, proposalId, decision }) => {
  deciding.value = true;
  try {
    await agentApi.decide(runId, { proposalId, decision });
    await cargarRuns();
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? err.message });
  } finally {
    deciding.value = false;
  }
};
</script>

<template>
  <div class="pruebas">
    <HarvestToastHost />

    <div class="pruebas__picker">
      <Select
        v-model="selectedId"
        :options="runOptions"
        option-label="label"
        option-value="value"
        :placeholder="t('labels.activity_pick_run')"
        :loading="loading"
        class="pruebas__select"
        :empty-message="t('labels.no_runs_match_filters')"
      />
    </div>

    <div v-if="!selectedRun" class="pruebas__empty">
      <i class="pi pi-desktop" aria-hidden="true"></i>
      <span>{{ t('labels.activity_pick_run') }}</span>
    </div>

    <template v-else>
      <div class="pruebas__run-meta">
        <span class="pruebas__run-status" :style="{ color: runStatusStyle(selectedRun).fg }">{{ runStatusLabel(selectedRun) }}</span>
        <span class="pruebas__run-sep">·</span>
        <span class="ident">{{ selectedRun.scope?.productName ?? selectedRun.scope?.lineName ?? '—' }}</span>
      </div>

      <SandboxTab
        v-if="isChangeset"
        :run-id="String(selectedRun._id)"
        :run="selectedRun"
        :proposal="sandboxProposal"
        :decide="onDecide"
      />
      <PlaygroundTab
        v-else
        :run-id="String(selectedRun._id)"
        :run="selectedRun"
        :proposal="playgroundProposal"
      />
    </template>
  </div>
</template>

<style scoped>
.pruebas {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.pruebas__picker {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pruebas__select {
  min-width: 360px;
}

.pruebas__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px;
  color: var(--p-text-dim-color);
  font-size: 13px;
}

.pruebas__run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.pruebas__run-status {
  font-weight: 500;
}

.pruebas__run-sep {
  color: var(--p-text-faint-color);
}
</style>
