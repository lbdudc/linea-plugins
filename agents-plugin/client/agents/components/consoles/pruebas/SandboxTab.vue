<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Button from 'primevue/button';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import Textarea from 'primevue/textarea';

import agentApi from '../../../api/agentApi.js';
import { notify } from '../harvest/notify.js';
import {
  anyEditDirty,
  buildCommitPayload,
  displayFiles,
  isEditDirty,
  isPathDirty,
  isPendingCreate,
  isSandboxComplete,
  normalizeNewPath,
} from './sandboxState.js';
import PlaygroundTab from './PlaygroundTab.vue';

const props = defineProps({
  runId: { type: String, required: true },
  run: { type: Object, required: true },
  proposal: { type: Object, default: null },
  decide: { type: Function, default: null },
});

const { t } = useI18n();

const loading = ref(true);
const planBranch = ref(null);
const fmPath = ref('src/platform/model.uvl');
const fmType = ref('UVL');
const fmContent = ref('');
const initialFm = ref('');

const fileEdits = ref([]);

const branchFiles = ref([]);
const branchLoadError = ref(false);
const activeEditIdx = ref(null);

const playgroundRef = ref(null);
const committing = ref(false);
const loadingFile = ref(false);

const fmDirty = computed(() => fmContent.value !== initialFm.value);
const codeDirty = computed(() => anyEditDirty(fileEdits.value));
const anyDirty = computed(() => fmDirty.value || codeDirty.value);
const canDecide = computed(() => Boolean(props.proposal) && !committing.value);

const serverSaysFinished = ref(false);
const sandboxComplete = computed(() => isSandboxComplete(props.run, serverSaysFinished.value));

const activeEdit = computed(() => (activeEditIdx.value == null ? null : fileEdits.value[activeEditIdx.value] ?? null));

const shownFiles = computed(() => displayFiles(branchFiles.value, fileEdits.value));

const stateError = ref(null);
const stateErrorStatus = ref(null);
const isMock = ref(false);

const loadBranchFiles = async () => {
  try {
    const { files } = await agentApi.getSandboxFiles(props.runId);
    branchFiles.value = Array.isArray(files) ? files.filter((p) => p !== fmPath.value) : [];
    branchLoadError.value = false;
  } catch {
    branchFiles.value = [];
    branchLoadError.value = true;
  }
};

const loadState = async () => {
  loading.value = true;
  stateError.value = null;
  stateErrorStatus.value = null;
  try {
    const state = await agentApi.getSandboxState(props.runId);
    planBranch.value = state.planBranch;
    fmPath.value = state.fm?.path ?? fmPath.value;
    fmType.value = state.fm?.type ?? fmType.value;
    fmContent.value = state.fm?.content ?? '';
    initialFm.value = fmContent.value;
    fileEdits.value = [];
    activeEditIdx.value = null;
    isMock.value = Boolean(state.mock);
    serverSaysFinished.value = Boolean(state.sandboxFinished);
    if (!serverSaysFinished.value) await loadBranchFiles();
  } catch (err) {
    stateErrorStatus.value = err?.response?.status ?? null;
    stateError.value = err?.response?.data?.error ?? err?.message ?? String(err);
    notify({ type: 'negative', message: t('labels.sandbox_error_state') });
  } finally {
    loading.value = false;
  }
};

onMounted(loadState);

const newFilePath = ref('');

const addFile = () => {
  const path = normalizeNewPath(newFilePath.value);
  if (!path || path === 'src/') return;
  const existing = fileEdits.value.findIndex((e) => e.path === path);
  if (existing >= 0) {
    activeEditIdx.value = existing;
    newFilePath.value = '';
    return;
  }
  fileEdits.value.push({ path, action: 'create', newContent: '', _originalContent: undefined });
  activeEditIdx.value = fileEdits.value.length - 1;
  newFilePath.value = '';
};

const removeEdit = (idx) => {
  fileEdits.value.splice(idx, 1);
  if (activeEditIdx.value === idx) activeEditIdx.value = null;
  else if (activeEditIdx.value != null && activeEditIdx.value > idx) activeEditIdx.value -= 1;
};

const openExistingFile = async (path) => {
  const existingIdx = fileEdits.value.findIndex((e) => e.path === path);
  if (existingIdx >= 0) {
    activeEditIdx.value = existingIdx;
    return;
  }
  loadingFile.value = true;
  try {
    const { content } = await agentApi.getSandboxFile(props.runId, path);
    fileEdits.value.push({ path, action: 'update', newContent: content, _originalContent: content });
    activeEditIdx.value = fileEdits.value.length - 1;
  } catch {
    notify({ type: 'negative', message: t('labels.sandbox_load_file_error') });
  } finally {
    loadingFile.value = false;
  }
};

const onCommit = async () => {
  if (!anyDirty.value || committing.value) return;
  committing.value = true;
  try {
    const payload = {
      ...buildCommitPayload({ fmContent: fmContent.value, initialFm: initialFm.value, fileEdits: fileEdits.value }),
      message: `Sandbox iteration on ${planBranch.value}`,
    };
    await agentApi.commitSandboxIteration(props.runId, payload);
    notify({ type: 'positive', message: t('labels.sandbox_commit_ok') });
    await loadState();
    playgroundRef.value?.refreshFm?.();
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.sandbox_commit_ko') });
  } finally {
    committing.value = false;
  }
};

const onApprove = () => {
  if (!canDecide.value || !props.decide) return;
  props.decide({ runId: String(props.run._id), proposalId: String(props.proposal._id), decision: 'approved' });
};

const onReject = () => {
  if (!canDecide.value || !props.decide) return;
  props.decide({ runId: String(props.run._id), proposalId: String(props.proposal._id), decision: 'rejected' });
};

const activeTab = ref('fm');
</script>

<template>
  <div class="sbx">
    <div class="sbx__head">
      <i class="pi pi-desktop" aria-hidden="true"></i>
      <span class="sbx__title">{{ t('labels.sandbox_title') }}</span>
      <span v-if="planBranch" class="sbx__chip"><i class="pi pi-sitemap" aria-hidden="true"></i>{{ planBranch }}</span>
      <span v-if="isMock" class="sbx__chip sbx__chip--mock" :title="t('labels.sandbox_mock_tooltip')">
        <i class="pi pi-info-circle" aria-hidden="true"></i>{{ t('labels.sandbox_mock_chip') }}
      </span>
      <span v-if="anyDirty" class="sbx__badge">{{ t('labels.sandbox_unsaved') }}</span>
      <div class="sbx__spacer"></div>
      <Button text size="small" icon="pi pi-refresh" :label="t('labels.sandbox_reload')" :disabled="loading || committing" @click="loadState" />
      <Button size="small" icon="pi pi-save" :label="t('labels.sandbox_commit')" :loading="committing" :disabled="!anyDirty || loading" @click="onCommit" />
      <Button
        v-if="proposal"
        outlined size="small" icon="pi pi-times"
        :style="{ color: 'var(--status-bad-solid)', borderColor: 'var(--status-bad-solid)' }"
        :label="t('labels.sandbox_reject')"
        :disabled="!canDecide"
        @click="onReject"
      />
      <Button
        v-if="proposal"
        size="small" icon="pi pi-check"
        :style="{ background: 'var(--status-ok-solid)', borderColor: 'var(--status-ok-solid)' }"
        :label="t('labels.sandbox_approve')"
        :disabled="!canDecide || anyDirty"
        :title="anyDirty ? t('labels.sandbox_commit_pending') : null"
        @click="onApprove"
      />
    </div>

    <p v-if="!proposal && !loading && !stateError && !sandboxComplete" class="sbx__hint">
      <i class="pi pi-info-circle" aria-hidden="true"></i>{{ t('labels.sandbox_no_proposal_hint') }}
    </p>

    <div v-if="sandboxComplete && !loading" class="sbx__completed">
      <i class="pi pi-check-circle" aria-hidden="true"></i>
      <div class="sbx__completed-title">{{ t('labels.sandbox_completed_title') }}</div>
      <div class="sbx__completed-detail">{{ t('labels.sandbox_completed_detail') }}</div>
    </div>

    <div v-else-if="stateError && !loading" class="sbx__unavailable">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      <div class="sbx__unavailable-title">{{ t('labels.sandbox_error_state') }}</div>
      <div class="sbx__unavailable-detail">
        <span v-if="stateErrorStatus === 409">{{ t('labels.sandbox_no_branch_hint') }}</span>
        <span v-else>{{ stateError }}</span>
      </div>
      <Button size="small" icon="pi pi-refresh" :label="t('labels.sandbox_reload')" @click="loadState" />
    </div>

    <template v-else>
      <Tabs v-model:value="activeTab" class="sbx__tabs">
        <TabList>
          <Tab value="fm"><i class="pi pi-sitemap" aria-hidden="true"></i> {{ t('labels.sandbox_tab_fm') }}</Tab>
          <Tab value="code"><i class="pi pi-code" aria-hidden="true"></i> {{ t('labels.sandbox_tab_code') }}</Tab>
          <Tab value="playground"><i class="pi pi-play-circle" aria-hidden="true"></i> {{ t('labels.sandbox_tab_playground') }}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="fm" class="sbx__panel-fm">
            <p v-if="loading" class="sbx__loading">{{ t('labels.sandbox_loading_fm') }}</p>
            <template v-else>
              <div class="sbx__fm-head">
                <i class="pi pi-file" aria-hidden="true"></i>
                <span>{{ fmPath }} <span class="sbx__fm-type">({{ fmType }})</span></span>
                <span v-if="fmDirty" class="sbx__badge">{{ t('labels.sandbox_pending_edit') }}</span>
              </div>
              <Textarea v-model="fmContent" class="sbx__fm-textarea" spellcheck="false" />
            </template>
          </TabPanel>

          <TabPanel value="code" class="sbx__panel-code">
            <div class="sbx__code-body">
              <div class="sbx__filelist">
                <div class="sbx__filelist-head">
                  <i class="pi pi-folder-open" aria-hidden="true"></i>
                  <span>{{ t('labels.sandbox_existing_files') }}</span>
                  <div class="sbx__spacer"></div>
                  <Button text rounded size="small" icon="pi pi-refresh" :title="t('labels.sandbox_reload')" @click="loadBranchFiles" />
                </div>
                <div class="sbx__filelist-body">
                  <p v-if="loadingFile" class="sbx__loading-file"><i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.sandbox_loading_state') }}</p>
                  <p v-if="branchLoadError && !branchFiles.length" class="sbx__load-error">{{ t('labels.sandbox_load_file_error') }}</p>
                  <button
                    v-for="path in shownFiles"
                    :key="path"
                    type="button"
                    class="sbx__file-item"
                    :class="{ 'sbx__file-item--active': activeEdit?.path === path }"
                    @click="openExistingFile(path)"
                  >
                    <i :class="isPendingCreate(path, fileEdits) ? 'pi pi-plus-circle' : 'pi pi-file'" :style="{ color: isPendingCreate(path, fileEdits) ? 'var(--status-ok-solid)' : 'var(--p-text-dim-color)' }" aria-hidden="true"></i>
                    <span class="sbx__file-label">{{ path }}</span>
                    <span v-if="isPendingCreate(path, fileEdits)" class="sbx__file-badge sbx__file-badge--new">{{ t('labels.sandbox_new_file_badge') }}</span>
                    <span v-else-if="isPathDirty(path, fileEdits)" class="sbx__file-badge">{{ t('labels.sandbox_pending_edit') }}</span>
                  </button>
                </div>
                <div class="sbx__filelist-foot">
                  <input
                    v-model="newFilePath"
                    type="text"
                    class="sbx__new-file-input"
                    :placeholder="t('labels.sandbox_new_file_path')"
                    @keyup.enter="addFile"
                  />
                  <Button size="small" icon="pi pi-plus" :label="t('labels.sandbox_add_file')" :disabled="!newFilePath.trim()" @click="addFile" />
                </div>
              </div>

              <div class="sbx__editor">
                <div v-if="!activeEdit" class="sbx__editor-empty">
                  <i class="pi pi-file-edit" aria-hidden="true"></i>
                  <span>{{ t('labels.sandbox_no_files') }}</span>
                </div>
                <template v-else>
                  <div class="sbx__editor-head">
                    <i :class="activeEdit.action === 'create' ? 'pi pi-plus-circle' : 'pi pi-pencil'" :style="{ color: activeEdit.action === 'create' ? 'var(--status-ok-solid)' : 'var(--p-agent-color)' }" aria-hidden="true"></i>
                    <span>{{ activeEdit.path }}</span>
                    <span v-if="isEditDirty(activeEdit)" class="sbx__badge">{{ t('labels.sandbox_pending_edit') }}</span>
                    <div class="sbx__spacer"></div>
                    <Button text size="small" icon="pi pi-trash" :label="t('labels.sandbox_remove')" :style="{ color: 'var(--status-bad-solid)' }" @click="removeEdit(activeEditIdx)" />
                  </div>
                  <Textarea
                    v-if="activeEditIdx !== null"
                    v-model="fileEdits[activeEditIdx].newContent"
                    class="sbx__code-textarea"
                    spellcheck="false"
                  />
                </template>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="playground" class="sbx__panel-playground">
            <PlaygroundTab ref="playgroundRef" mode="plan_branch" :run-id="runId" :run="run" />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </template>
  </div>
</template>

<style scoped>
.sbx {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.sbx__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-content-border-color);
  border-radius: 6px 6px 0 0;
}

.sbx__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
}

.sbx__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--p-agent-color);
  color: var(--p-agent-color);
  font-size: 11px;
}

.sbx__chip--mock {
  border-color: var(--status-serious);
  color: var(--status-serious);
}

.sbx__badge {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--status-warn-solid);
  color: var(--p-content-background);
  font-size: 10.5px;
}

.sbx__spacer {
  flex: 1;
}

.sbx__hint {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 8px 14px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  background: var(--p-agent-highlight-soft);
}

.sbx__completed,
.sbx__unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px 20px;
  text-align: center;
}

.sbx__completed {
  color: var(--status-ok-strong);
}

.sbx__completed i {
  font-size: 36px;
  color: var(--status-ok-solid);
}

.sbx__completed-title {
  font-size: 13px;
  font-weight: 600;
}

.sbx__completed-detail,
.sbx__unavailable-detail {
  font-size: 12px;
  color: var(--p-text-muted-color);
  max-width: 460px;
}

.sbx__unavailable i {
  font-size: 36px;
  color: var(--status-warn-solid);
}

.sbx__unavailable-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
}

.sbx__tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sbx__tabs :deep(.p-tabpanels) {
  flex: 1;
  min-height: 0;
  padding: 0;
}

.sbx__tabs :deep(.p-tabpanel) {
  height: 100%;
  min-height: 0;
}

.sbx__panel-fm {
  padding: 12px 14px;
}

.sbx__loading,
.sbx__loading-file,
.sbx__load-error {
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.sbx__fm-head {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
}

.sbx__fm-type {
  color: var(--p-text-dim-color);
}

.sbx__fm-textarea,
.sbx__code-textarea {
  width: 100%;
  min-height: 460px;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12.5px;
}

.sbx__panel-code {
  min-height: 560px;
}

.sbx__code-body {
  display: flex;
  align-items: stretch;
  min-height: 560px;
  height: 100%;
}

.sbx__filelist {
  width: 280px;
  min-width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--p-content-border-color);
  display: flex;
  flex-direction: column;
  max-height: 560px;
}

.sbx__filelist-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-content-border-color);
  font-size: 11.5px;
  color: var(--p-text-secondary-color);
  flex-shrink: 0;
}

.sbx__filelist-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.sbx__file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 0;
  border-bottom: 1px solid var(--p-content-hover-background);
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  color: var(--p-text-secondary-color);
  cursor: pointer;
}

.sbx__file-item:hover {
  background: var(--hover-veil);
}

.sbx__file-item--active {
  background: var(--p-agent-highlight-soft);
}

.sbx__file-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sbx__file-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--status-warn-solid);
  color: var(--p-content-background);
  font-size: 9.5px;
}

.sbx__file-badge--new {
  background: var(--status-ok-solid);
}

.sbx__filelist-foot {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.sbx__new-file-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font-size: 12px;
}

.sbx__editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sbx__editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
  color: var(--p-text-dim-color);
  font-size: 12px;
}

.sbx__editor-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-content-border-color);
  font-size: 12px;
  color: var(--p-text-secondary-color);
}

.sbx__editor .sbx__code-textarea {
  flex: 1;
  margin: 8px;
  border-radius: 4px;
}

.sbx__panel-playground {
  min-height: 480px;
}
</style>
