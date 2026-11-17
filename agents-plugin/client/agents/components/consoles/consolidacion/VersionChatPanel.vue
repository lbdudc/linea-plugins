<script setup>
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';

import agentApi from '../../../api/agentApi.js';

import HarvestDiffView from '../harvest/HarvestDiffView.vue';
import { notify } from '../harvest/notify.js';

import { buildProposalDiffFiles } from './proposalDiffFiles.js';

const props = defineProps({
  version: { type: Object, default: null },
});

const emit = defineEmits(['request-fork']);

const { t } = useI18n();

const messages = ref([]);
const input = shallowRef('');
const sending = shallowRef(false);
const loading = shallowRef(false);
const logEl = ref(null);

const selectedDiffKey = shallowRef(null);

const loadHistory = async () => {
  if (!props.version?._id) { messages.value = []; return; }
  loading.value = true;
  try {
    messages.value = await agentApi.getVersionChat(props.version._id);
    await nextTick();
    scrollToBottom();
  } catch {
    messages.value = [];
  } finally {
    loading.value = false;
  }
};

watch(() => props.version?._id, loadHistory, { immediate: true });

const scrollToBottom = () => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight; };

const hasProposal = (msg) => Boolean(msg?.proposalSnapshot?.newModelUvl || msg?.proposalSnapshot?.fileEdits?.length);

const activeProposalMsg = computed(() => {
  if (selectedDiffKey.value) return messages.value.find((m) => String(m._id) === selectedDiffKey.value) ?? null;
  const withProposal = messages.value.filter((m) => hasProposal(m) && m.role === 'assistant');
  return withProposal[withProposal.length - 1] ?? null;
});

const diffFiles = computed(() => {
  const snap = activeProposalMsg.value?.proposalSnapshot;
  if (!snap) return [];
  return buildProposalDiffFiles({
    newModelUvl: snap.newModelUvl,
    fileEdits: snap.fileEdits,
    fmLabel: t('labels.feature_model'),
  });
});

const selectedFileKey = shallowRef(null);
watch(diffFiles, (files) => {
  if (files.length && !files.some((f) => f.key === selectedFileKey.value)) selectedFileKey.value = files[0].key;
});
const selectedFile = computed(() => diffFiles.value.find((f) => f.key === selectedFileKey.value) ?? diffFiles.value[0] ?? null);

async function send() {
  const text = input.value.trim();
  if (!text || sending.value || !props.version?._id) return;

  messages.value.push({ _id: `tmp-${Date.now()}`, role: 'user', text, createdAt: new Date() });
  input.value = '';
  sending.value = true;
  await nextTick();
  scrollToBottom();

  try {
    const result = await agentApi.sendVersionChatMessage(props.version._id, text);
    await loadHistory();
    if (result?.assistantMessage?._id) selectedDiffKey.value = String(result.assistantMessage._id);
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.version_chat_error') });
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
</script>

<template>
  <div v-if="!version" class="chat-panel chat-panel--empty">
    <i class="pi pi-comments" aria-hidden="true"></i>
    <p>{{ t('labels.version_chat_no_version') }}</p>
  </div>

  <div v-else class="chat-panel">
    <div class="chat-panel__conversation">
      <div class="chat-panel__header">
        <i class="pi pi-android" aria-hidden="true"></i>
        <span class="chat-panel__version">v{{ version.label }}</span>
        <Tag :value="version.branch" class="chat-panel__branch" />
        <span class="chat-panel__spacer"></span>
        <Button text size="small" icon="pi pi-directions-alt" :label="t('labels.version_chat_fork_button')" :title="t('labels.version_chat_fork_tooltip')" @click="emit('request-fork', version)" />
        <button type="button" class="chat-panel__icon-btn" :title="t('labels.version_chat_reload')" @click="loadHistory">
          <i class="pi pi-refresh" aria-hidden="true"></i>
        </button>
      </div>

      <div ref="logEl" class="chat-panel__log">
        <p v-if="loading" class="chat-panel__status">{{ t('labels.version_chat_loading') }}</p>
        <p v-else-if="!messages.length" class="chat-panel__status">{{ t('labels.version_chat_empty_hint') }}</p>

        <div
          v-for="msg in messages"
          :key="msg._id"
          class="chat-panel__msg"
          :class="{
            'chat-panel__msg--user': msg.role === 'user',
            'chat-panel__msg--assistant': msg.role === 'assistant',
            'chat-panel__msg--system': msg.role === 'system',
          }"
          @click="hasProposal(msg) ? (selectedDiffKey = String(msg._id)) : null"
        >
          <i :class="msg.role === 'user' ? 'pi pi-user' : msg.role === 'system' ? 'pi pi-info-circle' : 'pi pi-android'" class="chat-panel__msg-icon" aria-hidden="true"></i>
          <div class="chat-panel__msg-body">
            <div class="chat-panel__msg-text">{{ msg.text }}</div>
            <div v-if="hasProposal(msg)" class="chat-panel__msg-badge">
              <i class="pi pi-file-edit" aria-hidden="true"></i> {{ t('labels.version_chat_view_proposal') }}
            </div>
          </div>
        </div>

        <div v-if="sending" class="chat-panel__msg chat-panel__msg--assistant">
          <i class="pi pi-spin pi-spinner chat-panel__msg-icon" aria-hidden="true"></i>
          <div class="chat-panel__msg-body chat-panel__status">{{ t('labels.version_chat_thinking') }}</div>
        </div>
      </div>

      <div class="chat-panel__input">
        <InputText v-model="input" class="chat-panel__input-field" :placeholder="t('labels.version_chat_placeholder')" :disabled="sending" @keydown="onEnter" />
        <Button icon="pi pi-send" rounded text :disabled="!input.trim() || sending" :loading="sending" @click="send" />
      </div>
    </div>

    <div class="chat-panel__diff">
      <div v-if="!diffFiles.length" class="chat-panel__diff-empty">
        <i class="pi pi-file-edit" aria-hidden="true"></i>
        <p>{{ t('labels.version_chat_diff_empty') }}</p>
      </div>
      <div v-else class="chat-panel__diff-body">
        <div class="chat-panel__diff-files">
          <p class="chat-panel__diff-files-header">{{ t('labels.llm_dialog_changed_files') }}</p>
          <button v-for="f in diffFiles" :key="f.key" type="button" class="chat-panel__diff-file" :class="{ 'chat-panel__diff-file--active': f.key === selectedFileKey }" @click="selectedFileKey = f.key">
            <span class="chat-panel__diff-file-label">{{ f.label }}</span>
            <Tag :value="f.action === 'create' ? t('labels.llm_dialog_new_badge') : t('labels.llm_dialog_mod_badge')" :style="{ background: f.action === 'create' ? 'var(--status-ok-solid)' : 'var(--p-text-muted-color)', color: 'var(--p-content-background)' }" class="chat-panel__diff-file-badge" />
          </button>
        </div>
        <div class="chat-panel__diff-view">
          <HarvestDiffView v-if="selectedFile" :old-text="selectedFile.old" :new-text="selectedFile.new" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  height: 100%;
  min-height: 600px;
}

.chat-panel--empty {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--p-text-faint-color);
  text-align: center;
}

.chat-panel--empty i {
  font-size: 48px;
  margin-bottom: 12px;
}

.chat-panel--empty p {
  margin: 0;
  font-size: 12.5px;
}

.chat-panel__conversation {
  width: 420px;
  min-width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--p-content-border-color);
}

.chat-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-content-border-color);
}

.chat-panel__header i {
  color: var(--p-agent-color);
}

.chat-panel__version {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
}

.chat-panel__branch {
  font-size: 10.5px;
  background: transparent;
  border: 1px solid var(--p-content-border-color);
  color: var(--p-text-muted-color);
}

.chat-panel__spacer {
  flex: 1;
}

.chat-panel__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
}

.chat-panel__icon-btn:hover {
  background: var(--hover-veil);
}

.chat-panel__log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 14px;
}

.chat-panel__status {
  font-size: 12px;
  color: var(--p-text-dim-color);
  margin: 6px 0;
}

.chat-panel__msg {
  display: flex;
  gap: 8px;
  margin: 6px 0;
  padding: 6px 8px;
  border-radius: 8px;
}

.chat-panel__msg--user {
  background: var(--p-content-hover-background);
}

.chat-panel__msg--assistant {
  background: var(--p-agent-highlight-soft);
  cursor: pointer;
}

.chat-panel__msg--assistant:hover {
  background: var(--p-agent-highlight);
}

.chat-panel__msg--system {
  background: var(--status-warn-soft);
  color: var(--status-warn-solid);
}

.chat-panel__msg-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.chat-panel__msg--assistant .chat-panel__msg-icon {
  color: var(--p-agent-color);
}

.chat-panel__msg-body {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--p-text-secondary-color);
}

.chat-panel__msg-text {
  white-space: pre-wrap;
}

.chat-panel__msg-badge {
  font-size: 10.5px;
  margin-top: 4px;
  color: var(--p-agent-color);
}

.chat-panel__input {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px;
  background: var(--p-content-hover-background);
}

.chat-panel__input-field {
  flex: 1;
}

.chat-panel__diff {
  flex: 1;
  min-width: 0;
  display: flex;
}

.chat-panel__diff-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--p-text-faint-color);
  text-align: center;
}

.chat-panel__diff-empty i {
  font-size: 44px;
  margin-bottom: 10px;
}

.chat-panel__diff-empty p {
  margin: 0;
  font-size: 12px;
}

.chat-panel__diff-body {
  flex: 1;
  min-width: 0;
  display: flex;
}

.chat-panel__diff-files {
  width: 220px;
  min-width: 180px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--p-content-border-color);
}

.chat-panel__diff-files-header {
  padding: 9px 12px 4px;
  margin: 0;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-dim-color);
}

.chat-panel__diff-file {
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

.chat-panel__diff-file:hover {
  background: var(--hover-veil);
}

.chat-panel__diff-file--active {
  background: var(--p-agent-highlight-soft);
}

.chat-panel__diff-file-label {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-panel__diff-file-badge {
  flex: none;
  font-size: 9px;
}

.chat-panel__diff-view {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
</style>
