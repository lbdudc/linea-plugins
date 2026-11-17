<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Timeline from 'primevue/timeline';
import { durationLabel, timeOfDay } from './format.js';

const props = defineProps({
  steps: { type: Array, default: () => [] },
});

const { t } = useI18n();

const stepState = (step) => {
  if (step.status === 'done') return 'done';
  if (step.status === 'running') return 'run';
  if (step.status === 'failed') return 'fail';
  if (step.status === 'pending' && step.kind === 'approval') return 'wait';
  return 'todo';
};

const stepDetail = (step) => {
  if (step.status === 'running') return t('labels.status_running_long');
  if (step.error) return step.error;
  if (step.outputSummary && typeof step.outputSummary === 'object') {
    return Object.entries(step.outputSummary)
      .filter(([, v]) => typeof v !== 'object')
      .map(([k, v]) => `${k}: ${v}`)
      .join('  ·  ');
  }
  return '';
};

const items = computed(() =>
  (props.steps ?? []).map((step) => ({
    step,
    state: stepState(step),
    detail: stepDetail(step),
    time: timeOfDay(step.startedAt ?? step.endedAt),
    duration: step.status !== 'running' ? durationLabel(step.durationMs) : null,
  })),
);
</script>

<template>
  <Timeline :value="items" align="left" class="pasos-linea">
    <template #marker="{ item }">
      <span class="paso-marca" :class="`paso-marca--${item.state}`" aria-hidden="true">
        <svg v-if="item.state === 'done'" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"></path></svg>
        <svg v-else-if="item.state === 'fail'" width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg>
        <svg v-else-if="item.state === 'wait'" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.2 2"></path></svg>
        <span v-else-if="item.state === 'run'" class="paso-marca__pulso" aria-hidden="true"></span>
      </span>
    </template>
    <template #content="{ item }">
      <div class="paso" :class="{ 'paso--fail': item.state === 'fail' }">
        <div class="paso__cabecera">
          <span class="paso__titulo">{{ item.step.name }}</span>
          <span class="paso__tiempo ident">{{ item.time }}</span>
        </div>
        <p v-if="item.detail" class="paso__detalle">{{ item.detail }}</p>
        <span v-if="item.duration" class="paso__duracion ident">{{ item.duration }}</span>
      </div>
    </template>
  </Timeline>
</template>

<style scoped>
.pasos-linea :deep(.p-timeline-event-opposite) {
  display: none;
  flex: 0;
}

.pasos-linea :deep(.p-timeline-event-separator) {
  width: 16px;
}

.pasos-linea :deep(.p-timeline-event-connector) {
  width: 2px;
  background: var(--p-content-hover-background);
}

.pasos-linea :deep(.p-timeline-event) {
  min-height: 0;
}

.pasos-linea :deep(.p-timeline-event-content) {
  padding-bottom: 20px;
}

.paso-marca {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  margin-top: 3px;
}

.paso-marca--done {
  border: 2px solid var(--status-ok-solid);
  background: var(--status-ok-solid);
  color: var(--p-primary-contrast-color);
}

.paso-marca--fail {
  border: 2px solid var(--status-bad-solid);
  background: var(--status-bad-solid);
  color: var(--p-primary-contrast-color);
}

.paso-marca--wait {
  border: 2px solid var(--status-warn-solid);
  background: transparent;
  color: var(--status-warn-solid);
}

.paso-marca--run {
  border: 2px solid var(--p-agent-color);
  background: transparent;
}

.paso-marca--todo {
  border: 2px solid var(--p-text-faint-color);
  background: transparent;
}

.paso-marca__pulso {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--p-agent-color);
  animation: paso-pulso 1.4s ease-in-out infinite;
}

@keyframes paso-pulso {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(1.3); }
}

.paso {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.paso__cabecera {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.paso__titulo {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--p-text-color);
}

.paso--fail .paso__titulo {
  color: var(--status-bad-strong);
}

.paso__tiempo {
  margin-left: auto;
  font-size: 11px;
  color: var(--p-text-faint-color);
  white-space: nowrap;
}

.paso__detalle {
  margin: 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}

.paso__duracion {
  font-size: 11px;
  color: var(--p-text-dim-color);
}
</style>
