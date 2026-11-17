<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { AGENT_DOCS, STEP_KIND_META } from './changesetDocs.js';
import { buildPhases, canRerun, fmtDuration } from './changesetPhases.js';

const props = defineProps({
  steps: { type: Array, default: () => [] },
  runStatus: { type: String, default: null },
  rerunBusy: { type: Boolean, default: false },
});

const emit = defineEmits(['rerun-step']);

const { t } = useI18n();

const rerunEnabled = computed(() => canRerun(props.runStatus));

const stepDocs = AGENT_DOCS.changeset?.steps ?? {};

const STEP_ICON_STATUS = {
  pending: 'pi pi-circle',
  running: 'pi pi-spin pi-spinner',
  done: 'pi pi-check',
  failed: 'pi pi-times',
  skipped: 'pi pi-minus',
};

const STEP_BUBBLE_COLOR = {
  pending: 'var(--p-text-faint-color)',
  running: 'var(--p-agent-color)',
  done: 'var(--status-ok-solid)',
  failed: 'var(--status-bad-solid)',
  skipped: 'var(--p-text-faint-color)',
};

const phases = computed(() =>
  buildPhases(props.steps).map((phase) => {
    const doc = stepDocs[phase.name] ?? null;
    const kindMeta = phase.kind ? (STEP_KIND_META[phase.kind] ?? {}) : {};
    return {
      ...phase,
      get label() { return doc?.label ?? phase.name; },
      get description() { return doc?.description ?? ''; },
      kindLabel: kindMeta.label ?? '',
      kindColor: kindMeta.color ?? 'var(--p-text-dim-color)',
    };
  }),
);

const durationLabel = (ms) => fmtDuration(ms);

const tooltipFor = (phase) => `${phase.label}\n${phase.description}${phase.kindLabel ? `\n${phase.kindLabel}` : ''}`;
</script>

<template>
  <div class="phase-rail">
    <div v-for="(phase, idx) in phases" :key="phase.name" class="phase-rail__step" :class="`phase-rail__step--${phase.status}`">
      <div v-if="idx > 0" class="phase-rail__connector"></div>

      <div class="phase-rail__bubble" :style="{ background: STEP_BUBBLE_COLOR[phase.status] }" :title="tooltipFor(phase)">
        <i :class="STEP_ICON_STATUS[phase.status]" aria-hidden="true"></i>
      </div>

      <div class="phase-rail__text" :title="tooltipFor(phase)">
        <div class="phase-rail__label">
          {{ phase.label }}
          <span v-if="phase.durationMs" class="phase-rail__dur">{{ durationLabel(phase.durationMs) }}</span>
        </div>
        <div v-if="phase.status === 'failed' && phase.error" class="phase-rail__error">{{ phase.error }}</div>
      </div>

      <button
        v-if="rerunEnabled && phase.status !== 'pending'"
        type="button"
        class="phase-rail__rerun"
        :disabled="rerunBusy"
        :title="t('labels.phase_rerun_tooltip', { step: phase.label })"
        @click.stop="emit('rerun-step', phase.name)"
      >
        <i class="pi pi-replay" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.phase-rail {
  display: flex;
  align-items: flex-start;
  overflow-x: auto;
  padding: 8px 0 4px;
}

.phase-rail__step {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 88px;
  max-width: 110px;
}

.phase-rail__connector {
  position: absolute;
  top: 11px;
  right: calc(50% + 11px);
  width: calc(100% - 22px);
  height: 2px;
  background: var(--p-content-border-color);
}

.phase-rail__bubble {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  color: var(--p-content-background);
  font-size: 11px;
}

.phase-rail__step--running .phase-rail__bubble {
  box-shadow: 0 0 0 3px var(--p-agent-highlight);
}

.phase-rail__text {
  margin-top: 6px;
  text-align: center;
  padding: 0 4px;
}

.phase-rail__label {
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 96px;
  color: var(--p-text-color);
}

.phase-rail__dur {
  font-size: 10.5px;
  opacity: 0.65;
  font-weight: 400;
  margin-left: 3px;
}

.phase-rail__error {
  font-size: 10.5px;
  margin-top: 2px;
  max-width: 96px;
  white-space: normal;
  word-break: break-word;
  color: var(--status-bad-strong);
}

.phase-rail__rerun {
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-agent-color);
  opacity: 0.6;
  cursor: pointer;
}

.phase-rail__rerun:hover {
  opacity: 1;
  background: var(--hover-veil);
}

.phase-rail__rerun:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
