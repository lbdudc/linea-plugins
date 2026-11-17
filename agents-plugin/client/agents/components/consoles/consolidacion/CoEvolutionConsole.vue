<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import Select from 'primevue/select';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';

import agentApi from '../../../api/agentApi.js';
import { scope } from '../../../stores/scope.js';
import { connect as conectarSocket } from '../../../boot/ws.js';
import { agentRunStore } from '../../../stores/agentRunStore.js';

import { notify } from '../harvest/notify.js';

import ChangeSetPhaseRail from './ChangeSetPhaseRail.vue';
import ChangeSetPlanApproval from './ChangeSetPlanApproval.vue';
import ChangeSetLLMDialog from './ChangeSetLLMDialog.vue';
import VersionTree from './VersionTree.vue';
import EsqueletoLista from '../../common/EsqueletoLista.vue';
import VersionChatPanel from './VersionChatPanel.vue';
import ConfirmPromptHost from '../../common/ConfirmPromptHost.vue';
import { confirmDialog, promptDialog } from '../../common/confirmPrompt.js';
import { AGENT_DOCS } from './changesetDocs.js';
import { buildChildRunsById, cascadeFailureVersionIds as cascadeFailureVersionIdsOf, hasCascadeFailures } from './changesetCascade.js';
import { isVersionLocked } from './versionTree.js';
import SandboxTab from '../pruebas/SandboxTab.vue';

const props = defineProps({
  runs: { type: Array, default: () => [] },
  decidingRunId: { type: String, default: null },
  starting: { type: Boolean, default: false },
});

const emit = defineEmits(['decide', 'refine', 'restore', 'cancel']);

const { t } = useI18n();

const onDecide = (payload) => emit('decide', payload);
const onRefine = (payload) => emit('refine', payload);
const onRestore = (payload) => emit('restore', payload);

const selectedLineId = computed(() => scope.lineId);

const versions = ref([]);
const versionsLoading = ref(false);
const selectedVersionId = ref(null);
const activeWorkspaceTab = ref('chat');

const route = useRoute();
const router = useRouter();
const pendingDeepLinkVersionId = ref(typeof route.query.versionId === 'string' ? route.query.versionId : null);

const applyDeepLink = () => {
  const wanted = pendingDeepLinkVersionId.value;
  if (!wanted) return;
  if (!versions.value.some((v) => String(v._id) === String(wanted))) return;
  selectedVersionId.value = String(wanted);
  activeWorkspaceTab.value = 'plan';
  pendingDeepLinkVersionId.value = null;
  const rest = { ...route.query };
  delete rest.versionId;
  router.replace({ query: rest });
};

const loadVersions = async () => {
  if (!selectedLineId.value) { versions.value = []; return; }
  versionsLoading.value = true;
  try {
    versions.value = await agentApi.listVersions(selectedLineId.value);
    applyDeepLink();
  } catch {
    versions.value = [];
  } finally {
    versionsLoading.value = false;
  }
};

watch(selectedLineId, loadVersions, { immediate: true });

watch(() => route.query.versionId, (id) => {
  if (typeof id === 'string' && id) {
    pendingDeepLinkVersionId.value = id;
    applyDeepLink();
  }
});

const onVersionEvent = ({ version, lineId }) => {
  if (!version || !selectedLineId.value) return;
  if (String(lineId) !== String(selectedLineId.value)) return;
  const idx = versions.value.findIndex((v) => String(v._id) === String(version._id));
  if (idx >= 0) versions.value.splice(idx, 1, version);
  else versions.value.push(version);
  applyDeepLink();
};
const onVersionDeleted = ({ version, lineId }) => {
  if (!version || !selectedLineId.value) return;
  if (String(lineId) !== String(selectedLineId.value)) return;
  const idx = versions.value.findIndex((v) => String(v._id) === String(version._id));
  if (idx >= 0) versions.value.splice(idx, 1);
  if (String(selectedVersionId.value) === String(version._id)) selectedVersionId.value = null;
};

onMounted(() => {
  conectarSocket().on('version-created', onVersionEvent);
  conectarSocket().on('version-updated', onVersionEvent);
  conectarSocket().on('version-deleted', onVersionDeleted);
});
onBeforeUnmount(() => {
  conectarSocket().off('version-created', onVersionEvent);
  conectarSocket().off('version-updated', onVersionEvent);
  conectarSocket().off('version-deleted', onVersionDeleted);
});

const selectedVersion = computed(() => versions.value.find((v) => String(v._id) === String(selectedVersionId.value)) ?? null);
const onSelectVersion = (v) => { selectedVersionId.value = String(v._id); };

const upsertVersion = (v) => {
  if (!v?._id) return;
  const idx = versions.value.findIndex((x) => String(x._id) === String(v._id));
  if (idx >= 0) versions.value.splice(idx, 1, v);
  else versions.value.push(v);
};

const onForkVersion = async (v) => {
  const intent = await promptDialog({
    title: t('labels.version_action_fork'),
    message: t('labels.version_fork_prompt', { label: v.label }),
    placeholder: t('labels.version_fork_default_intent', { label: v.label }),
  });
  if (intent == null) return;
  try {
    const created = await agentApi.createVersion(selectedLineId.value, {
      parentVersionId: String(v._id),
      intent: intent.trim() || t('labels.version_fork_default_intent', { label: v.label }),
    });
    upsertVersion(created);
    selectedVersionId.value = String(created._id);
    notify({ type: 'positive', message: t('labels.version_forked_ok', { label: created.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.version_forked_ko') });
  }
};

const onArchiveVersion = async (v) => {
  const ok = await confirmDialog({
    title: t('labels.version_action_archive'),
    message: t('labels.version_archive_confirm', { label: v.label }),
    tone: 'neutral',
  });
  if (!ok) return;
  try {
    const updated = await agentApi.archiveVersion(String(v._id));
    upsertVersion(updated);
    notify({ type: 'info', message: t('labels.version_archived_ok', { label: v.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.version_archived_ko') });
  }
};

const onResetVersion = async ({ version: v, cascade }) => {
  const key = cascade ? 'labels.version_reset_cascade_confirm' : 'labels.version_reset_confirm';
  const ok = await confirmDialog({
    title: t(cascade ? 'labels.version_action_reset_cascade' : 'labels.version_action_reset'),
    message: t(key, { label: v.label }),
    tone: 'warning',
  });
  if (!ok) return;
  try {
    const updated = await agentApi.resetVersion(String(v._id), { cascade });
    upsertVersion(updated);
    notify({ type: 'positive', message: t('labels.version_reset_ok', { label: v.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.version_reset_ko') });
  }
};

const onDeleteVersion = async ({ version: v, cascade }) => {
  const key = cascade ? 'labels.version_delete_cascade_confirm' : 'labels.version_delete_confirm';
  const ok = await confirmDialog({
    title: t(cascade ? 'labels.version_action_delete_cascade' : 'labels.version_action_delete'),
    message: t(key, { label: v.label }),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await agentApi.deleteVersion(String(v._id), { cascade });
    const idx = versions.value.findIndex((x) => String(x._id) === String(v._id));
    if (idx >= 0) versions.value.splice(idx, 1);
    if (String(selectedVersionId.value) === String(v._id)) selectedVersionId.value = null;
    notify({ type: 'positive', message: t('labels.version_deleted_ok', { label: v.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.version_deleted_ko') });
  }
};

const promoting = ref(false);
const onPromoteVersion = async () => {
  const v = selectedVersion.value;
  if (!v || promoting.value) return;
  const confirmKey = v.runId ? 'labels.version_repromote_confirm' : 'labels.version_promote_confirm';
  const ok = await confirmDialog({
    title: t(v.runId ? 'labels.version_repromote_button' : 'labels.version_promote_button'),
    message: t(confirmKey, { label: v.label }),
    tone: 'primary',
  });
  if (!ok) return;
  promoting.value = true;
  try {
    const { version, run } = await agentApi.promoteVersion(String(v._id));
    upsertVersion(version);
    if (run) agentRunStore.upsert(run);
    activeWorkspaceTab.value = 'plan';
    notify({ type: 'positive', message: t('labels.version_promoted_ok', { label: version.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.version_promoted_ko') });
  } finally {
    promoting.value = false;
  }
};

const runForSelectedVersion = computed(() => {
  const rid = selectedVersion.value?.runId;
  if (!rid) return null;
  return props.runs.find((r) => String(r._id) === String(rid)) ?? null;
});

const cascadeHasFailures = computed(() => hasCascadeFailures(runForSelectedVersion.value));
const cascadeFailureVersionIds = computed(() => cascadeFailureVersionIdsOf(versions.value, props.runs));

const selectedVersionLocked = computed(() => isVersionLocked(versions.value, selectedVersion.value));

const createNewRootVersion = async () => {
  const intent = await promptDialog({
    title: t('labels.version_new_root_button'),
    message: t('labels.version_new_root_prompt'),
    placeholder: t('labels.version_new_root_default_intent'),
  });
  if (intent == null) return;
  try {
    const created = await agentApi.createVersion(selectedLineId.value, {
      parentVersionId: null,
      intent: intent.trim() || t('labels.version_new_root_default_intent'),
    });
    upsertVersion(created);
    selectedVersionId.value = String(created._id);
    activeWorkspaceTab.value = 'chat';
    notify({ type: 'positive', message: t('labels.version_created_ok', { label: created.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.version_created_ko') });
  }
};

const changesetRuns = computed(() =>
  props.runs
    .filter((r) => r.agentType === 'changeset' && !r.parentRunId && (!selectedLineId.value || String(r.scope?.lineId) === selectedLineId.value))
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
);

const pendingCount = computed(() => changesetRuns.value.filter((r) => r.status === 'awaiting_approval').length);

const childRunsById = computed(() => buildChildRunsById(props.runs, runForSelectedVersion.value ? String(runForSelectedVersion.value._id) : null));

const launching = ref(false);

const fromBranchDialog = ref(false);
const branchOptions = ref([]);
const branchLoading = ref(false);
const selectedBranch = ref('');

const excludeMain = (branches) => (branches ?? []).filter((b) => (b?.name ?? b) !== 'main' && !b?.default);

const openFromBranchDialog = async () => {
  if (!selectedLineId.value) return;
  selectedBranch.value = '';
  branchLoading.value = true;
  fromBranchDialog.value = true;
  try {
    branchOptions.value = excludeMain(await agentApi.listLineBranches(selectedLineId.value));
  } catch {
    fromBranchDialog.value = false;
    notify({ type: 'warning', message: t('labels.coevo_branches_load_error') });
  } finally {
    branchLoading.value = false;
  }
};

const launchFromBranch = async () => {
  if (!selectedLineId.value || !selectedBranch.value) return;
  launching.value = true;
  fromBranchDialog.value = false;
  try {
    const created = await agentApi.createVersion(selectedLineId.value, {
      parentVersionId: null,
      intent: t('labels.coevo_from_branch_intent', { branch: selectedBranch.value }),
      branch: selectedBranch.value,
      origin: 'root',
    });
    upsertVersion(created);
    selectedVersionId.value = String(created._id);
    activeWorkspaceTab.value = 'chat';
    notify({ type: 'positive', message: t('labels.version_created_ok', { label: created.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.coevo_create_run_error') });
  } finally {
    launching.value = false;
  }
};

const llmDialogOpen = ref(false);
const rerunningStep = ref(false);

const nowTick = ref(Date.now());
let tickTimer = null;
onMounted(() => { tickTimer = setInterval(() => { nowTick.value = Date.now(); }, 1000); });
onBeforeUnmount(() => { if (tickTimer) clearInterval(tickTimer); });

const fmtElapsed = (ms) => {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
};

const stepDocLabel = (name) => AGENT_DOCS.changeset?.steps?.[name]?.label ?? name;

const activeStepInfo = computed(() => {
  const run = runForSelectedVersion.value;
  if (!run) return null;
  const steps = run.steps ?? [];
  const latest = steps[steps.length - 1] ?? null;
  const status = run.status;

  if (status === 'queued' || (status === 'running' && !latest)) {
    return { tone: 'info', spinning: true, title: t('labels.coevo_live_queued_title'), detail: t('labels.coevo_live_queued_detail'), elapsedLabel: null };
  }
  if (rerunningStep.value) {
    return { tone: 'primary', spinning: true, title: t('labels.coevo_live_rerun_title'), detail: t('labels.coevo_live_rerun_detail'), elapsedLabel: null };
  }
  if (!latest) return null;

  if (latest.status === 'running') {
    const startedAt = latest.startedAt ? new Date(latest.startedAt).getTime() : null;
    const elapsed = startedAt ? nowTick.value - startedAt : null;
    return { tone: 'primary', spinning: true, title: t('labels.coevo_live_running_title', { step: stepDocLabel(latest.name) }), detail: null, elapsedLabel: fmtElapsed(elapsed) };
  }
  if (status === 'awaiting_approval') {
    return { tone: 'warning', spinning: false, icon: 'pi pi-clock', title: t('labels.coevo_live_awaiting_title', { step: stepDocLabel(latest.name) }), detail: t('labels.coevo_live_awaiting_detail'), elapsedLabel: null };
  }
  if (status === 'awaiting_child') {
    return { tone: 'primary', spinning: true, title: t('labels.coevo_live_awaiting_child_title'), detail: t('labels.coevo_live_awaiting_child_detail'), elapsedLabel: null };
  }
  if (status === 'awaiting_external') {
    return { tone: 'primary', spinning: true, title: t('labels.coevo_live_awaiting_external_title'), detail: t('labels.coevo_live_awaiting_external_detail'), elapsedLabel: null };
  }
  if (status === 'failed' && latest.status === 'failed') {
    return { tone: 'danger', spinning: false, icon: 'pi pi-times-circle', title: t('labels.coevo_live_failed_title', { step: stepDocLabel(latest.name) }), detail: latest.error ?? run.error ?? null, elapsedLabel: null };
  }
  return null;
});

const onRerunStep = async (stepName) => {
  if (!runForSelectedVersion.value || rerunningStep.value) return;
  const runId = String(runForSelectedVersion.value._id);
  const confirmed = await confirmDialog({
    title: t('labels.phase_rerun_ok', { step: stepName }),
    message: t('labels.phase_rerun_confirm', { step: stepName }),
    tone: 'primary',
  });
  if (!confirmed) return;
  rerunningStep.value = true;
  try {
    const updated = await agentApi.rerunStep(runId, stepName);
    if (updated) agentRunStore.upsert(updated);
    notify({ type: 'info', message: t('labels.phase_rerun_ok', { step: stepName }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.phase_rerun_ko') });
  } finally {
    rerunningStep.value = false;
  }
};

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled'];
const busyMutation = ref(false);
const canCancelActiveRun = computed(() => Boolean(runForSelectedVersion.value) && !TERMINAL_STATUSES.includes(runForSelectedVersion.value.status));
const cancelActiveRun = () => {
  const run = runForSelectedVersion.value;
  if (!run || busyMutation.value) return;
  emit('cancel', { runId: String(run._id) });
};

const sandboxProposal = computed(() => {
  if (!runForSelectedVersion.value) return null;
  return (runForSelectedVersion.value.proposals ?? []).find((p) => p.kind === 'sandbox_iteration' && !p.decision) ?? null;
});

const userTouchedTab = ref(false);
watch(sandboxProposal, (pending) => {
  if (userTouchedTab.value) return;
  if (pending) activeWorkspaceTab.value = 'sandbox';
});
const onWorkspaceTabChange = (val) => {
  userTouchedTab.value = true;
  activeWorkspaceTab.value = val;
};
watch(selectedVersionId, () => { userTouchedTab.value = false; });

const onLLMLaunch = async (branch) => {
  llmDialogOpen.value = false;
  launching.value = true;
  try {
    const created = await agentApi.createVersion(selectedLineId.value, {
      parentVersionId: null,
      intent: `AI proposal on ${branch}`,
      branch,
      origin: 'llm',
    });
    upsertVersion(created);
    selectedVersionId.value = String(created._id);
    activeWorkspaceTab.value = 'chat';
    notify({ type: 'positive', message: t('labels.version_created_ok', { label: created.label }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.coevo_create_run_error') });
  } finally {
    launching.value = false;
  }
};
</script>

<template>
  <div class="co-evo">
    <ConfirmPromptHost />

    <div class="co-evo__sidebar">
      <div class="co-evo__sidebar-head">
        <div class="co-evo__launch-row">
          <Button :label="t('labels.version_new_root_button')" icon="pi pi-plus" :disabled="!selectedLineId" class="co-evo__launch-btn" @click="createNewRootVersion" />
          <button type="button" class="co-evo__icon-btn" :disabled="!selectedLineId || launching" :title="t('labels.coevo_from_branch_tooltip')" @click="openFromBranchDialog">
            <i class="pi pi-sitemap" aria-hidden="true"></i>
          </button>
          <button type="button" class="co-evo__icon-btn co-evo__icon-btn--ai" :disabled="!selectedLineId || launching" :title="t('labels.coevo_propose_with_ai_tooltip')" @click="llmDialogOpen = true">
            <i class="pi pi-android" aria-hidden="true"></i>
          </button>
        </div>

        <Dialog v-model:visible="fromBranchDialog" modal class="co-evo__branch-dialog" :header="t('labels.coevo_from_branch_title')">
          <p class="co-evo__branch-help">{{ t('labels.coevo_from_branch_help') }}</p>
          <p v-if="!branchOptions.length && !branchLoading" class="co-evo__branch-banner">
            <i class="pi pi-info-circle" aria-hidden="true"></i> {{ t('labels.coevo_from_branch_empty_banner') }}
          </p>
          <Select
            v-model="selectedBranch"
            :options="branchOptions"
            option-value="name"
            option-label="name"
            filter
            :loading="branchLoading"
            :placeholder="t('labels.coevo_branch_field')"
            :empty-filter-message="t('labels.coevo_branches_empty')"
            class="co-evo__branch-select"
          />
          <template #footer>
            <Button text :label="t('labels.coevo_dialog_cancel')" @click="fromBranchDialog = false" />
            <Button :label="t('labels.coevo_dialog_create_plan')" :disabled="!selectedBranch" @click="launchFromBranch" />
          </template>
        </Dialog>

        <ChangeSetLLMDialog v-model="llmDialogOpen" :line-id="selectedLineId" @launch="onLLMLaunch" />
      </div>

      <p v-if="pendingCount" class="co-evo__pending-note">
        <i class="pi pi-clock" aria-hidden="true"></i> {{ t('labels.coevo_awaiting_approval', { n: pendingCount }) }}
      </p>

      <EsqueletoLista v-if="versionsLoading && !versions.length" :filas="4" class="co-evo__version-tree" />

      <VersionTree
        v-else
        :versions="versions"
        :selected-version-id="selectedVersionId"
        :cascade-failure-version-ids="cascadeFailureVersionIds"
        class="co-evo__version-tree"
        @select="onSelectVersion"
        @fork="onForkVersion"
        @archive="onArchiveVersion"
        @reset="onResetVersion"
        @delete="onDeleteVersion"
      />
    </div>

    <div class="co-evo__main">
      <div v-if="!selectedVersion && !versions.length" class="co-evo__empty">
        <i class="pi pi-sitemap" aria-hidden="true"></i>
        <div class="co-evo__empty-title">{{ t('labels.version_workspace_welcome') }}</div>
        <p class="co-evo__empty-hint">{{ t('labels.version_workspace_welcome_hint') }}</p>
        <Button icon="pi pi-send" :label="t('labels.version_new_root_button')" :disabled="!selectedLineId" @click="createNewRootVersion" />
      </div>

      <div v-else-if="!selectedVersion" class="co-evo__empty co-evo__empty--muted">
        <i class="pi pi-sitemap" aria-hidden="true"></i>
        <div class="co-evo__empty-title">{{ t('labels.version_no_selection') }}</div>
        <p class="co-evo__empty-hint">{{ t('labels.version_no_selection_hint') }}</p>
      </div>

      <div v-else class="co-evo__workspace">
        <div class="co-evo__run-header">
          <div class="co-evo__run-title-row">
            <i class="pi pi-android" aria-hidden="true"></i>
            <div>
              <div class="co-evo__run-title">v{{ selectedVersion.label }} · {{ selectedVersion.title || t('labels.version_untitled') }}</div>
              <div class="co-evo__run-meta">
                {{ t(`labels.version_origin_${selectedVersion.origin}`) }}
                <span>{{ selectedVersion.createdAt ? new Date(selectedVersion.createdAt).toLocaleString() : '' }}</span>
              </div>
            </div>
            <span class="co-evo__spacer"></span>
            <Tag :value="selectedVersion.branch" class="co-evo__branch-chip" />
            <Tag :value="t(`labels.version_status_${selectedVersion.status}`)" :style="{ background: selectedVersion.status === 'merged' ? 'var(--status-ok-solid)' : 'var(--p-agent-color)', color: 'var(--p-content-background)' }">
              <i v-if="selectedVersion.status === 'merged' && cascadeHasFailures" class="pi pi-exclamation-triangle" :title="t('labels.version_merged_with_failures_tooltip')" aria-hidden="true"></i>
            </Tag>
            <button v-if="canCancelActiveRun" type="button" class="co-evo__icon-btn co-evo__icon-btn--warn" :disabled="busyMutation" :title="t('labels.run_cancel_tooltip')" @click="cancelActiveRun">
              <i class="pi pi-stop-circle" aria-hidden="true"></i>
            </button>
            <Button
              v-if="!selectedVersionLocked && selectedVersion.status !== 'merged'"
              icon="pi pi-send"
              :label="selectedVersion.runId ? t('labels.version_repromote_button') : t('labels.version_promote_button')"
              :loading="promoting"
              :title="selectedVersion.runId ? t('labels.version_repromote_tooltip') : t('labels.version_promote_tooltip')"
              @click="onPromoteVersion"
            />
            <Tag v-else-if="selectedVersionLocked" :value="t('labels.version_locked_chip')" icon="pi pi-lock" :title="t('labels.version_locked_tooltip')" class="co-evo__locked-chip" />
          </div>

          <div v-if="activeStepInfo" class="co-evo__banner" :class="`co-evo__banner--${activeStepInfo.tone}`">
            <i :class="activeStepInfo.spinning ? 'pi pi-spin pi-spinner' : activeStepInfo.icon" aria-hidden="true"></i>
            <span class="co-evo__banner-title">{{ activeStepInfo.title }}</span>
            <span v-if="activeStepInfo.detail" class="co-evo__banner-detail">{{ activeStepInfo.detail }}</span>
            <span class="co-evo__spacer"></span>
            <span v-if="activeStepInfo.elapsedLabel" class="co-evo__banner-elapsed"><i class="pi pi-clock" aria-hidden="true"></i>{{ activeStepInfo.elapsedLabel }}</span>
          </div>
        </div>

        <p v-if="selectedVersionLocked" class="co-evo__locked-banner">
          <i class="pi pi-lock" aria-hidden="true"></i>
          <span>
            <strong>{{ t('labels.version_locked_banner_title') }}</strong><br />
            {{ t('labels.version_locked_banner_detail') }}
          </span>
        </p>

        <Tabs :value="activeWorkspaceTab" class="co-evo__tabs" @update:value="onWorkspaceTabChange">
          <TabList>
            <Tab value="chat"><i class="pi pi-comments" aria-hidden="true"></i> {{ t('labels.version_tab_chat') }}</Tab>
            <Tab value="plan" :disabled="!runForSelectedVersion"><i class="pi pi-sitemap" aria-hidden="true"></i> {{ t('labels.sandbox_tab_plan') }}</Tab>
            <Tab value="sandbox" :disabled="!runForSelectedVersion"><i class="pi pi-desktop" aria-hidden="true"></i> {{ t('labels.sandbox_tab') }}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="chat" class="co-evo__panel co-evo__panel--chat">
              <VersionChatPanel :version="selectedVersion" @request-fork="onForkVersion" />
            </TabPanel>
            <TabPanel value="plan" class="co-evo__panel">
              <p v-if="!runForSelectedVersion" class="co-evo__panel-empty">{{ t('labels.version_plan_not_started') }}</p>
              <template v-else>
                <ChangeSetPhaseRail :steps="runForSelectedVersion.steps ?? []" :run-status="runForSelectedVersion.status" :rerun-busy="rerunningStep" @rerun-step="onRerunStep" />
                <ChangeSetPlanApproval :run="runForSelectedVersion" :deciding-run-id="decidingRunId" :child-runs-by-id="childRunsById" :decide="onDecide" :refine="onRefine" :restore="onRestore" />
              </template>
            </TabPanel>
            <TabPanel value="sandbox" class="co-evo__panel">
              <p v-if="!runForSelectedVersion" class="co-evo__panel-empty">{{ t('labels.version_sandbox_not_started') }}</p>
              <SandboxTab
                v-else
                :run-id="String(runForSelectedVersion._id)"
                :run="runForSelectedVersion"
                :proposal="sandboxProposal"
                :decide="onDecide"
              />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>
    </div>
  </div>
</template>

<style scoped>
.co-evo {
  display: flex;
  height: 100%;
  min-height: 0;
}

.co-evo__sidebar {
  flex: 0 0 280px;
  width: 280px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--p-content-border-color);
  min-height: 0;
}

.co-evo__sidebar-head {
  padding: 14px 12px 8px;
}

.co-evo__launch-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.co-evo__launch-btn {
  flex: 1;
}

.co-evo__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
  background: transparent;
  color: var(--p-agent-color);
  cursor: pointer;
}

.co-evo__icon-btn:hover {
  background: var(--hover-veil);
}

.co-evo__icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.co-evo__icon-btn--ai {
  color: var(--status-warn-solid);
}

.co-evo__icon-btn--warn {
  color: var(--status-warn-solid);
  width: 32px;
  height: 32px;
}

.co-evo__pending-note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 6px 12px;
  font-size: 11.5px;
  color: var(--status-warn-solid);
  background: var(--status-warn-soft);
}

.co-evo__version-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--p-content-border-color);
}

.co-evo__branch-help {
  font-size: 12px;
  color: var(--p-text-muted-color);
  margin: 0 0 10px;
}

.co-evo__branch-banner {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  background: var(--p-agent-highlight-soft);
  border-radius: 5px;
}

.co-evo__branch-select {
  width: 100%;
}

.co-evo__main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 22px 24px;
}

.co-evo__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 32px;
  gap: 6px;
}

.co-evo__empty i {
  font-size: 48px;
  color: var(--p-agent-color);
  margin-bottom: 8px;
}

.co-evo__empty--muted i {
  color: var(--p-text-faint-color);
}

.co-evo__empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--p-text-color);
}

.co-evo__empty-hint {
  max-width: 460px;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
  margin: 0 0 10px;
}

.co-evo__workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.co-evo__run-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.co-evo__run-title-row > i {
  color: var(--p-agent-color);
  font-size: 20px;
}

.co-evo__run-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.co-evo__run-meta {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  display: flex;
  gap: 10px;
}

.co-evo__spacer {
  flex: 1;
}

.co-evo__branch-chip {
  font-size: 10.5px;
  background: transparent;
  border: 1px solid var(--p-content-border-color);
  color: var(--p-text-muted-color);
}

.co-evo__locked-chip {
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
}

.co-evo__banner {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--p-content-background);
}

.co-evo__banner--info,
.co-evo__banner--primary {
  background: var(--p-agent-color);
}

.co-evo__banner--warning {
  background: var(--status-warn-solid);
}

.co-evo__banner--danger {
  background: var(--status-bad-solid);
}

.co-evo__banner-title {
  font-weight: 600;
}

.co-evo__banner-detail {
  opacity: 0.9;
}

.co-evo__banner-elapsed {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0.9;
  font-size: 11px;
}

.co-evo__locked-banner {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--p-content-hover-background);
  color: var(--p-text-secondary-color);
  font-size: 12px;
}

.co-evo__tabs {
  margin-top: 16px;
}

.co-evo__panel {
  padding-top: 14px;
}

.co-evo__panel--chat {
  padding-top: 0;
}

.co-evo__panel-empty {
  padding: 16px 4px;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
}
</style>

<style>
.p-dialog.co-evo__branch-dialog {
  width: 420px;
  max-width: 92vw;
}
</style>
