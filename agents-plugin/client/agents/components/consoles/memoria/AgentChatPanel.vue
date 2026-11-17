<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';

import agentApi from '../../../api/agentApi.js';
import MarkdownView from '../harvest/MarkdownView.vue';

const props = defineProps({
  lineId: { type: String, required: true },
});

const { t } = useI18n();

const threads = ref([]);
const threadOptions = computed(() => threads.value.map((th) => ({ label: th.title || t('labels.configuration'), value: th._id })));
const threadId = ref(null);
const messages = ref([]);
const input = ref('');
const sending = ref(false);
const scroller = ref(null);

const scrollToBottom = async () => {
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
};

const loadThreads = async () => {
  try {
    threads.value = await agentApi.knowledgeThreads({ lineId: props.lineId });
  } catch {
  }
};

const openThread = async (id) => {
  if (!id) return;
  threadId.value = id;
  try {
    const msgs = await agentApi.knowledgeMessages(id);
    messages.value = msgs.map((m) => ({ role: m.role, content: m.content }));
  } catch {
    messages.value = [];
  }
  scrollToBottom();
};

const newChat = () => {
  threadId.value = null;
  messages.value = [];
};

const send = async () => {
  const content = input.value.trim();
  if (!content || sending.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content });
  scrollToBottom();
  sending.value = true;
  try {
    const r = await agentApi.knowledgeAsk({ lineId: props.lineId, threadId: threadId.value, content });
    threadId.value = r.threadId;
    messages.value.push({ role: 'assistant', content: r.reply });
    loadThreads();
  } catch (err) {
    messages.value.push({ role: 'assistant', content: `**Error:** ${err.response?.data?.error ?? err.message}` });
  } finally {
    sending.value = false;
    scrollToBottom();
  }
};

onMounted(loadThreads);
</script>

<template>
  <div class="acp">
    <div class="acp__header">
      <i class="pi pi-comments" aria-hidden="true"></i>
      <span class="acp__title">{{ t('labels.ask_the_spl') }}</span>
      <div class="acp__spacer"></div>
      <Select
        v-if="threads.length"
        :model-value="threadId"
        :options="threadOptions"
        option-label="label"
        option-value="value"
        :placeholder="t('labels.history')"
        class="acp__history"
        @update:model-value="openThread"
      />
      <Button text size="small" icon="pi pi-plus" :label="t('labels.new')" :disabled="!threadId && !messages.length" @click="newChat" />
    </div>

    <div ref="scroller" class="acp__messages">
      <p v-if="!messages.length" class="acp__hint">{{ t('labels.ask_anything_hint') }}</p>
      <div v-for="(m, i) in messages" :key="i" class="acp__msg" :class="m.role === 'user' ? 'acp__msg--user' : 'acp__msg--assistant'">
        <div class="acp__bubble">
          <MarkdownView v-if="m.role === 'assistant'" :text="m.content" />
          <span v-else>{{ m.content }}</span>
        </div>
      </div>
      <div v-if="sending" class="acp__msg acp__msg--assistant">
        <div class="acp__bubble acp__bubble--thinking"><i class="pi pi-spin pi-spinner" aria-hidden="true"></i></div>
      </div>
    </div>

    <div class="acp__input-row">
      <InputText v-model="input" class="acp__input" :placeholder="t('labels.ask_about_this_spl')" :disabled="sending" @keyup.enter="send" />
      <Button icon="pi pi-send" :loading="sending" :disabled="!input.trim()" @click="send" />
    </div>
  </div>
</template>

<style scoped>
.acp {
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  background: var(--p-content-background);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.acp__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.acp__header i {
  color: var(--p-agent-color);
}

.acp__title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--p-text-color);
}

.acp__spacer {
  flex: 1;
}

.acp__history {
  min-width: 150px;
}

.acp__messages {
  flex: 1;
  min-height: 220px;
  max-height: 480px;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.acp__hint {
  text-align: center;
  color: var(--p-text-muted-color);
  font-size: 12.5px;
  padding: 24px 0;
}

.acp__msg {
  display: flex;
}

.acp__msg--user {
  justify-content: flex-end;
}

.acp__msg--assistant {
  justify-content: flex-start;
}

.acp__bubble {
  max-width: 82%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.5;
}

.acp__msg--user .acp__bubble {
  background: var(--p-agent-background);
  color: var(--p-primary-contrast-color);
}

.acp__msg--assistant .acp__bubble {
  background: var(--p-surface-ground);
  color: var(--p-text-color);
}

.acp__bubble--thinking {
  color: var(--p-text-muted-color);
}

.acp__input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--p-content-border-color);
}

.acp__input {
  flex: 1;
}
</style>
