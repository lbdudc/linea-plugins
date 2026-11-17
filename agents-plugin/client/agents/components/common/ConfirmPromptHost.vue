<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';

import { confirmPromptState, resolveConfirmPrompt } from './confirmPrompt.js';

const { t } = useI18n();

const TONE_ICON = {
  primary: 'pi pi-question-circle',
  warning: 'pi pi-exclamation-triangle',
  danger: 'pi pi-trash',
  neutral: 'pi pi-info-circle',
};
const TONE_COLOR = {
  primary: 'var(--p-agent-color)',
  warning: 'var(--status-warn-solid)',
  danger: 'var(--status-bad-solid)',
  neutral: 'var(--p-text-muted-color)',
};

const icon = computed(() => TONE_ICON[confirmPromptState.tone] ?? TONE_ICON.primary);
const color = computed(() => TONE_COLOR[confirmPromptState.tone] ?? TONE_COLOR.primary);

const onCancel = () => resolveConfirmPrompt(null);
const onOk = () => resolveConfirmPrompt(confirmPromptState.kind === 'prompt' ? (confirmPromptState.value ?? '') : true);
</script>

<template>
  <Dialog
    :visible="confirmPromptState.open"
    modal
    class="confirm-prompt"
    :closable="false"
    @update:visible="(v) => { if (!v) onCancel(); }"
  >
    <template #header>
      <div class="confirm-prompt__head">
        <i :class="icon" :style="{ color }" aria-hidden="true"></i>
        <span>{{ confirmPromptState.title }}</span>
      </div>
    </template>

    <p class="confirm-prompt__message">{{ confirmPromptState.message }}</p>
    <InputText
      v-if="confirmPromptState.kind === 'prompt'"
      v-model="confirmPromptState.value"
      class="confirm-prompt__field"
      :placeholder="confirmPromptState.placeholder"
      autofocus
      @keyup.enter="onOk"
    />

    <template #footer>
      <Button text :label="t('labels.dialog_cancel')" @click="onCancel" />
      <Button :label="t('labels.dialog_ok')" :style="{ background: color, borderColor: color }" @click="onOk" />
    </template>
  </Dialog>
</template>

<style scoped>
.confirm-prompt__head {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.confirm-prompt__message {
  margin: 0;
  font-size: 13px;
  color: var(--p-text-secondary-color);
  white-space: pre-line;
}

.confirm-prompt__field {
  width: 100%;
  margin-top: 12px;
}
</style>

<style>
.p-dialog.confirm-prompt {
  width: 420px;
  max-width: 92vw;
}
</style>
