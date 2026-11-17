<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Drawer from 'primevue/drawer';
import { runStatusLabel, runStatusStyle } from '../../activity/runStatus.js';

const { t } = useI18n();

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: () => '' },
  subtitle: { type: String, default: '' },
  runs: { type: Array, default: () => [] },
  dispositions: { type: Array, default: () => [] },
  labelFor: { type: Function, default: (r) => r?.agentType ?? 'run' },
});

const emit = defineEmits(['update:modelValue', 'open-run']);

const fmtTime = (d) => (d ? new Date(d).toLocaleString() : '');
const sortedRuns = computed(() => [...props.runs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
const sortedDispositions = computed(() =>
  [...props.dispositions].sort((a, b) => new Date(b.decidedAt ?? b.updatedAt ?? 0) - new Date(a.decidedAt ?? a.updatedAt ?? 0)),
);

const dispMeta = (s) => {
  const map = {
    'manually-harvested': { icon: 'pi pi-check-circle', color: 'var(--status-ok-solid)', label: t('labels.manually_harvested') },
    snoozed: { icon: 'pi pi-clock', color: 'var(--status-warn-solid)', label: t('labels.snoozed_state') },
    dismissed: { icon: 'pi pi-ban', color: 'var(--p-text-dim-color)', label: t('labels.dismissed_state') },
  };
  return map[s] ?? { icon: 'pi pi-question-circle', color: 'var(--p-text-dim-color)', label: s };
};

const pickRun = (run) => {
  emit('open-run', run);
  emit('update:modelValue', false);
};
</script>

<template>
  <Drawer
    :visible="modelValue"
    position="right"
    class="rhd"
    @update:visible="$emit('update:modelValue', $event)"
  >
    <template #header>
      <div>
        <div class="rhd__title">{{ title }}</div>
        <div v-if="subtitle" class="rhd__subtitle">{{ subtitle }}</div>
      </div>
    </template>

    <template v-if="sortedDispositions.length">
      <div class="rhd__section-label">{{ t('labels.triage_label') }}</div>
      <ul class="rhd__list">
        <li v-for="d in sortedDispositions" :key="d._id" class="rhd__disp">
          <i :class="dispMeta(d.state).icon" :style="{ color: dispMeta(d.state).color }" aria-hidden="true"></i>
          <div class="rhd__disp-body">
            <div class="rhd__disp-label">{{ dispMeta(d.state).label }}</div>
            <div class="rhd__disp-time">{{ fmtTime(d.decidedAt ?? d.updatedAt) }}</div>
            <div v-if="d.reason || d.note" class="rhd__disp-note">{{ d.reason || d.note }}</div>
          </div>
          <a v-if="d.mrUrl" :href="d.mrUrl" target="_blank" rel="noopener noreferrer" class="rhd__disp-mr">{{ t('labels.mr_arrow') }}</a>
        </li>
      </ul>
      <div class="rhd__sep"></div>
    </template>

    <div class="rhd__section-label">{{ t('labels.runs_count', { n: sortedRuns.length }) }}</div>
    <p v-if="!sortedRuns.length" class="rhd__empty">{{ t('labels.no_runs_yet') }}</p>
    <ul v-else class="rhd__list">
      <li v-for="run in sortedRuns" :key="run._id">
        <button type="button" class="rhd__run" @click="pickRun(run)">
          <span class="rhd__run-label">{{ labelFor(run) }}</span>
          <span class="rhd__run-time">{{ fmtTime(run.createdAt) }}</span>
          <span class="rhd__run-status" :style="{ color: runStatusStyle(run).fg }">
            <span class="rhd__run-dot" :style="{ background: runStatusStyle(run).dot }" aria-hidden="true"></span>
            {{ runStatusLabel(run) }}
          </span>
        </button>
      </li>
    </ul>
  </Drawer>
</template>

<style scoped>
.rhd__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.rhd__subtitle {
  font-size: 12px;
  color: var(--p-text-muted-color);
  margin-top: 2px;
}

.rhd__section-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--p-text-dim-color);
  margin: 4px 0 8px;
}

.rhd__list {
  list-style: none;
  margin: 0 0 4px;
  padding: 0;
}

.rhd__disp {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.rhd__disp-body {
  flex: 1;
  min-width: 0;
}

.rhd__disp-label {
  font-size: 12.5px;
  color: var(--p-text-color);
}

.rhd__disp-time,
.rhd__disp-note {
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin-top: 1px;
}

.rhd__disp-mr {
  font-size: 11px;
  color: var(--p-agent-color);
  flex: none;
}

.rhd__sep {
  border-top: 1px solid var(--p-content-border-color);
  margin: 10px 0;
}

.rhd__empty {
  font-size: 12px;
  color: var(--p-text-dim-color);
  padding: 6px 2px;
}

.rhd__run {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 2px;
  border: 0;
  border-bottom: 1px solid var(--p-content-hover-background);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--p-text-color);
}

.rhd__run:hover {
  background: var(--hover-veil);
}

.rhd__run-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rhd__run-time {
  font-size: 11px;
  color: var(--p-text-dim-color);
  flex: none;
}

.rhd__run-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  flex: none;
}

.rhd__run-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
</style>

<style>
.p-drawer.rhd {
  width: 380px;
  max-width: 96vw;
}
</style>
