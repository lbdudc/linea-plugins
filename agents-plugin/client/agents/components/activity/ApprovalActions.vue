<script setup>
import Button from 'primevue/button';
import { useI18n } from 'vue-i18n';

defineProps({
  decision: { type: String, default: null },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['approve', 'reject']);
const { t } = useI18n();
</script>

<template>
  <div v-if="!decision" class="acciones">
    <Button :label="t('labels.approve')" size="small" class="acciones__aprobar" :loading="busy" @click="emit('approve')" />
    <Button :label="t('labels.refine_with_agent')" size="small" outlined disabled />
    <div class="acciones__relleno"></div>
    <Button :label="t('labels.reject')" size="small" outlined class="acciones__rechazar" :disabled="busy" @click="emit('reject')" />
  </div>
  <div v-else class="decision" :class="`decision--${decision}`">
    <span class="decision__punto" aria-hidden="true"></span>
    <span class="decision__texto">
      {{ decision === 'rejected' ? t('labels.decision_rejected') : decision === 'auto' ? t('labels.decision_auto') : t('labels.decision_approved') }}
    </span>
  </div>
</template>

<style scoped>
.acciones {
  display: flex;
  align-items: center;
  gap: 8px;
}

.acciones__relleno {
  flex-grow: 1;
}

.acciones__aprobar {
  background: var(--status-ok-solid);
  border-color: var(--status-ok-solid);
  color: var(--p-primary-contrast-color);
}

.acciones__aprobar:hover {
  filter: brightness(1.08);
}

.acciones__aprobar :deep(.p-button-label) {
  color: var(--p-primary-contrast-color);
}

.acciones__rechazar {
  border-color: var(--status-bad-border);
  color: var(--status-bad-strong);
}

.decision {
  display: flex;
  align-items: center;
  gap: 9px;
}

.decision__punto {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--status-ok-strong);
}

.decision--rejected .decision__punto {
  background: var(--status-bad-strong);
}

.decision__texto {
  font-size: 12.5px;
  color: var(--status-ok-strong);
}

.decision--rejected .decision__texto {
  color: var(--status-bad-strong);
}
</style>
