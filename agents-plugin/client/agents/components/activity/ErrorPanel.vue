<script setup>
import Button from 'primevue/button';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  message: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  cancelled: { type: Boolean, default: false },
  retryable: { type: Boolean, default: false },
});

defineEmits(['retry']);
const { t } = useI18n();
</script>

<template>
  <div class="error-panel" :class="{ 'error-panel--cancelado': props.cancelled }">
    <div class="error-panel__cabecera">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="error-panel__icono" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 8v5"></path>
        <path d="M12 16v.01"></path>
      </svg>
      <span class="error-panel__titulo">{{ props.cancelled ? t('labels.run_cancelled_title') : t('labels.run_failed_title') }}</span>
    </div>
    <p v-if="message" class="error-panel__mensaje ident">{{ message }}</p>
    <div class="error-panel__acciones">
      <Button
        :label="t('labels.retry_action')"
        size="small"
        class="error-panel__reintentar"
        :loading="busy"
        :disabled="!props.retryable"
        @click="$emit('retry')"
      />
      <Button :label="t('labels.view_full_log')" size="small" text disabled />
    </div>
  </div>
</template>

<style scoped>
.error-panel {
  border: 1px solid var(--status-bad-border);
  border-radius: 8px;
  background: var(--status-bad-soft);
  padding: 15px 17px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.error-panel--cancelado {
  border-color: var(--p-content-border-color);
  background: var(--hover-veil);
}

.error-panel--cancelado .error-panel__icono,
.error-panel--cancelado .error-panel__titulo {
  color: var(--p-text-muted-color);
}

.error-panel__cabecera {
  display: flex;
  align-items: center;
  gap: 10px;
}

.error-panel__icono {
  color: var(--status-bad-strong);
  flex-shrink: 0;
}

.error-panel__titulo {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--status-bad-strong);
}

.error-panel__mensaje {
  margin: 0;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  line-height: 1.6;
}

.error-panel__acciones {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.error-panel__reintentar {
  background: var(--p-agent-background);
  border-color: var(--p-agent-background);
  color: var(--p-primary-contrast-color);
}

.error-panel__reintentar:hover {
  background: var(--p-agent-hover-color);
  border-color: var(--p-agent-hover-color);
}

.error-panel__reintentar :deep(.p-button-label) {
  color: var(--p-primary-contrast-color);
}
</style>
