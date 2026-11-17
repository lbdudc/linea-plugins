<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';

import agentApi from '../../../api/agentApi.js';

import HarvestDiffView from '../harvest/HarvestDiffView.vue';
import { notify } from '../harvest/notify.js';

import { buildProposalDiffFiles } from './proposalDiffFiles.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  lineId: { type: String, default: null },
});

const emit = defineEmits(['update:modelValue', 'launch']);

const { t } = useI18n();

const sessionId = shallowRef(null);
const proposal = ref(null);
const validation = ref(null);
const modelInfo = ref(null);

const messages = ref([]);
const input = shallowRef('');
const sending = shallowRef(false);
const committing = shallowRef(false);
const logEl = ref(null);

const selectedKey = shallowRef(null);

const patchFiles = computed(() => {
  const p = proposal.value;
  if (!p) return [];
  return buildProposalDiffFiles({
    newModelUvl: p.newModelUvl,
    fileEdits: p.fileEdits,
    fmLabel: t('labels.feature_model'),
    fmPath: modelInfo.value?.path ?? 'model.uvl',
    fmOld: modelInfo.value?.content ?? '',
  });
});

const selectedFile = computed(() => patchFiles.value.find((f) => f.key === selectedKey.value) ?? patchFiles.value[0] ?? null);

const validationColor = computed(() => {
  const v = validation.value;
  if (!v?.validated) return 'var(--p-text-dim-color)';
  return v.valid ? 'var(--status-ok-solid)' : 'var(--status-bad-solid)';
});
const validationText = computed(() => {
  const v = validation.value;
  if (!v?.validated) return t('labels.llm_dialog_fm_none');
  if (v.valid) return t('labels.llm_dialog_fm_valid', { n: v.checked });
  return t('labels.llm_dialog_fm_broken', { n: v.broken?.length ?? 0 });
});

const canCommit = computed(
  () => Boolean(proposal.value) && Boolean(proposal.value.fileEdits?.length || proposal.value.newModelUvl)
    && (validation.value?.validated ? validation.value.valid : true),
);

watch(() => props.modelValue, (open) => { if (open) reset(); });
watch(patchFiles, (files) => { if (files.length) selectedKey.value = files[0].key; });
watch(messages, async () => {
  await nextTick();
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
}, { deep: true });

function reset() {
  sessionId.value = null;
  proposal.value = null;
  validation.value = null;
  modelInfo.value = null;
  messages.value = [];
  input.value = '';
  selectedKey.value = null;
}

async function send() {
  const text = input.value.trim();
  if (!text || sending.value) return;

  messages.value.push({ role: 'user', text });
  input.value = '';
  sending.value = true;

  try {
    let result;
    if (!sessionId.value) {
      result = await agentApi.startChangesetProposal(props.lineId, text);
      sessionId.value = result.sessionId;
      modelInfo.value = result.modelInfo;
    } else {
      result = await agentApi.refineChangesetProposal(props.lineId, sessionId.value, text);
    }

    if (result.proposal) {
      proposal.value = result.proposal;
      validation.value = result.validation;
      messages.value.push({ role: 'assistant', text: result.proposal.reasoning ?? t('labels.llm_dialog_proposal_updated') });
    } else {
      messages.value.push({ role: 'assistant', text: result.llmText ?? t('labels.llm_dialog_no_proposal') });
    }
  } catch {
    messages.value.push({ role: 'error', text: t('labels.llm_dialog_request_failed') });
    notify({ type: 'negative', message: t('labels.llm_dialog_request_failed') });
  } finally {
    sending.value = false;
  }
}

function onEnter(e) {
  if (e.key !== 'Enter') return;
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  send();
}

async function commit() {
  if (!canCommit.value || committing.value) return;
  committing.value = true;
  try {
    const { branch } = await agentApi.commitChangesetProposal(props.lineId, sessionId.value);
    emit('update:modelValue', false);
    emit('launch', branch);
  } catch {
    notify({ type: 'negative', message: t('labels.llm_dialog_commit_failed') });
  } finally {
    committing.value = false;
  }
}
</script>

<template>
  <Dialog :visible="modelValue" modal class="csp" @update:visible="emit('update:modelValue', $event)">
    <template #header>
      <div class="csp__head">
        <i class="pi pi-android" aria-hidden="true"></i>
        <span>{{ t('labels.llm_dialog_title') }}</span>
      </div>
    </template>
    <template #closeicon>
      <i class="pi pi-times" :title="t('labels.llm_dialog_close')" aria-hidden="true"></i>
    </template>

    <div class="csp__body">
      <div class="csp__chat">
        <div ref="logEl" class="csp__log">
          <p v-if="!messages.length" class="csp__hint">{{ t('labels.llm_dialog_hint') }}</p>
          <div v-for="(msg, i) in messages" :key="i" class="csp__msg">
            <i
              :class="[
                msg.role === 'user' ? 'pi pi-user' : msg.role === 'error' ? 'pi pi-exclamation-circle' : 'pi pi-android',
                'csp__msg-icon',
                { 'csp__msg-icon--error': msg.role === 'error', 'csp__msg-icon--assistant': msg.role === 'assistant' },
              ]"
              aria-hidden="true"
            ></i>
            <span class="csp__msg-text">{{ msg.text }}</span>
          </div>
          <div v-if="sending" class="csp__thinking"><i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.llm_dialog_generating') }}</div>
        </div>

        <Tag v-if="validation" :value="validationText" :icon="validation.valid || !validation.validated ? 'pi pi-check-circle' : 'pi pi-times-circle'" :style="{ background: validationColor, color: 'var(--p-content-background)' }" class="csp__validation" />

        <div class="csp__input-row">
          <InputText
            v-model="input"
            class="csp__input"
            :placeholder="sessionId ? t('labels.llm_dialog_placeholder_refine') : t('labels.llm_dialog_placeholder_start')"
            :disabled="sending || committing"
            @keydown="onEnter"
          />
          <Button icon="pi pi-send" rounded text :disabled="!input.trim() || sending || committing" :loading="sending" @click="send" />
        </div>

        <div class="csp__actions">
          <Button text :label="t('labels.llm_dialog_cancel')" @click="emit('update:modelValue', false)" />
          <span class="csp__spacer"></span>
          <Button
            icon="pi pi-send"
            :label="t('labels.llm_dialog_create')"
            :disabled="!canCommit"
            :loading="committing"
            :title="!canCommit ? t('labels.llm_dialog_create_disabled') : null"
            @click="commit"
          />
        </div>
      </div>

      <div class="csp__diff-panel">
        <div v-if="!patchFiles.length" class="csp__diff-empty">
          <i class="pi pi-file-edit" aria-hidden="true"></i>
          <p>{{ t('labels.llm_dialog_diff_empty') }}</p>
        </div>
        <div v-else class="csp__diff-body">
          <div class="csp__files">
            <p class="csp__files-header">{{ t('labels.llm_dialog_changed_files') }}</p>
            <button
              v-for="f in patchFiles"
              :key="f.key"
              type="button"
              class="csp__file"
              :class="{ 'csp__file--active': f.key === selectedKey }"
              @click="selectedKey = f.key"
            >
              <span class="csp__file-label">{{ f.label }}</span>
              <Tag :value="f.action === 'create' ? t('labels.llm_dialog_new_badge') : t('labels.llm_dialog_mod_badge')" :style="{ background: f.action === 'create' ? 'var(--status-ok-solid)' : 'var(--p-text-muted-color)', color: 'var(--p-content-background)' }" class="csp__file-badge" />
            </button>
          </div>
          <div class="csp__diff">
            <HarvestDiffView v-if="selectedFile" :old-text="selectedFile.old" :new-text="selectedFile.new" />
          </div>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.csp__head {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.csp__head i {
  color: var(--p-agent-color);
}

.csp__body {
  display: flex;
  height: 100%;
  min-height: 0;
}

.csp__chat {
  width: 380px;
  min-width: 300px;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-right: 1px solid var(--p-content-border-color);
  min-height: 0;
}

.csp__log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-bottom: 10px;
}

.csp__hint {
  font-size: 12px;
  color: var(--p-text-dim-color);
  margin: 4px 0;
}

.csp__msg {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 8px;
  line-height: 1.5;
}

.csp__msg-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.csp__msg-icon--assistant {
  color: var(--p-agent-color);
}

.csp__msg-icon--error {
  color: var(--status-bad-solid);
}

.csp__msg-text {
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
  white-space: pre-wrap;
}

.csp__thinking {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.csp__validation {
  margin-bottom: 10px;
  align-self: flex-start;
}

.csp__input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.csp__input {
  flex: 1;
}

.csp__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.csp__spacer {
  flex: 1;
}

.csp__diff-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.csp__diff-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--p-text-faint-color);
  text-align: center;
}

.csp__diff-empty i {
  font-size: 48px;
  margin-bottom: 12px;
}

.csp__diff-empty p {
  font-size: 12.5px;
  margin: 0;
}

.csp__diff-body {
  flex: 1;
  min-width: 0;
  display: flex;
}

.csp__files {
  width: 220px;
  min-width: 180px;
  flex: none;
  overflow-y: auto;
  border-right: 1px solid var(--p-content-border-color);
}

.csp__files-header {
  padding: 9px 12px 4px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-dim-color);
  margin: 0;
}

.csp__file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  text-align: left;
  font: inherit;
  cursor: pointer;
  color: var(--p-text-secondary-color);
}

.csp__file:hover {
  background: var(--hover-veil);
}

.csp__file--active {
  background: var(--p-agent-highlight-soft);
}

.csp__file-label {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csp__file-badge {
  flex: none;
  font-size: 9px;
}

.csp__diff {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
</style>

<style>
.p-dialog.csp {
  width: 100vw;
  height: 100vh;
  max-height: 100vh;
  border-radius: 0;
}

.csp .p-dialog-content {
  padding: 0;
  height: 100%;
  min-height: 0;
}
</style>
