<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import Button from 'primevue/button';

import { changeTypeMeta } from './changeTypeMeta.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  lineId: { type: String, default: null },
  runs: { type: Array, default: () => [] },
});

const emit = defineEmits(['update:modelValue', 'launch']);

const { t } = useI18n();

const directive = ref('');

watch(() => props.modelValue, (open) => { if (open) directive.value = ''; });

const pendingProposal = (run) => (run.proposals ?? []).find((p) => p.kind === 'fm_patch' && !p.decision) ?? null;

const summaries = computed(() =>
  props.runs.map((run) => {
    const p = pendingProposal(run);
    return {
      id: run._id,
      title: p?.body?.title || p?.body?.featureName || t('labels.harvest_proposal'),
      changeType: p?.body?.changeType ?? null,
      fileCount: (p?.body?.fileEdits ?? []).length,
    };
  }),
);

const overlaps = computed(() => {
  const byPath = {};
  props.runs.forEach((run, idx) => {
    for (const e of pendingProposal(run)?.body?.fileEdits ?? []) {
      (byPath[e.path] ??= new Set()).add(idx + 1);
    }
  });
  return Object.entries(byPath)
    .filter(([, nums]) => nums.size > 1)
    .map(([path, nums]) => ({ path, sources: [...nums].sort((a, b) => a - b) }))
    .sort((a, b) => b.sources.length - a.sources.length);
});

const totalFiles = computed(() => {
  const set = new Set();
  for (const run of props.runs) {
    for (const e of pendingProposal(run)?.body?.fileEdits ?? []) set.add(e.path);
  }
  return set.size;
});

const launch = () => {
  emit('launch', { runIds: props.runs.map((r) => r._id), directive: directive.value.trim() });
  emit('update:modelValue', false);
};

const onClose = () => emit('update:modelValue', false);
</script>

<template>
  <Dialog :visible="modelValue" modal :header="t('labels.merge_n_proposals', { n: runs.length })" class="hm" @update:visible="$emit('update:modelValue', $event)">
    <p class="hm__hint">{{ t('labels.merge_agent_resynth_hint') }}</p>

    <div class="hm__label">{{ t('labels.source_proposals') }}</div>
    <ul class="hm__sources">
      <li v-for="(s, i) in summaries" :key="s.id" class="hm__source">
        <i :class="changeTypeMeta(s.changeType).icon" aria-hidden="true"></i>
        <div class="hm__source-body">
          <div class="hm__source-title"><strong>{{ i + 1 }}.</strong> {{ s.title }}</div>
          <div class="hm__source-meta">{{ changeTypeMeta(s.changeType).label }} · {{ s.fileCount }} {{ s.fileCount === 1 ? t('labels.file_singular') : t('labels.file_plural') }}</div>
        </div>
      </li>
    </ul>

    <div class="hm__label">{{ t('labels.overlap_preview') }}</div>
    <div v-if="!overlaps.length" class="hm__ok">
      <i class="pi pi-check-circle" aria-hidden="true"></i>
      {{ t('labels.no_file_overlap', { n: totalFiles, fileUnit: totalFiles === 1 ? t('labels.file_singular') : t('labels.file_plural') }) }}
    </div>
    <div v-else>
      <p class="hm__overlap-hint">{{ t('labels.files_overlap_call_out', { x: overlaps.length, y: totalFiles }) }}</p>
      <ul class="hm__overlaps">
        <li v-for="o in overlaps" :key="o.path" class="hm__overlap">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <code class="hm__overlap-path">{{ o.path }}</code>
          <span class="hm__overlap-sources">{{ t('labels.sources_label') }} {{ o.sources.join(', ') }}</span>
        </li>
      </ul>
    </div>

    <div class="hm__label">{{ t('labels.merge_directive_label') }}</div>
    <Textarea v-model="directive" auto-resize rows="3" :placeholder="t('labels.merge_directive_placeholder')" class="hm__textarea" />
    <p class="hm__hint">{{ t('labels.merge_directive_hint') }}</p>

    <template #footer>
      <Button :label="t('labels.cancel')" text size="small" @click="onClose" />
      <Button :label="t('labels.merge_proposals')" icon="pi pi-share-alt" size="small" :disabled="runs.length < 2" @click="launch" />
    </template>
  </Dialog>
</template>

<style scoped>
.hm__hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.hm__label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-text-dim-color);
  margin: 14px 0 5px;
}

.hm__label:first-of-type {
  margin-top: 0;
}

.hm__sources {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  max-height: 180px;
  overflow-y: auto;
}

.hm__source {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--p-content-hover-background);
}

.hm__source:last-child {
  border-bottom: none;
}

.hm__source i {
  color: var(--p-text-dim-color);
  margin-top: 2px;
}

.hm__source-body {
  min-width: 0;
  flex: 1;
}

.hm__source-title {
  font-size: 12.5px;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hm__source-meta {
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin-top: 2px;
}

.hm__ok {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
}

.hm__ok i {
  color: var(--status-ok-solid);
}

.hm__overlap-hint {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.hm__overlaps {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  max-height: 160px;
  overflow-y: auto;
}

.hm__overlap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--p-content-hover-background);
  font-size: 11.5px;
}

.hm__overlap:last-child {
  border-bottom: none;
}

.hm__overlap i {
  color: var(--status-warn-solid);
  flex: none;
}

.hm__overlap-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--p-content-hover-background);
  padding: 1px 5px;
  border-radius: 3px;
}

.hm__overlap-sources {
  color: var(--p-text-muted-color);
  flex: none;
}

.hm__textarea {
  width: 100%;
}
</style>

<style>
.p-dialog.hm {
  width: 480px;
  max-width: 94vw;
}

.hm .p-dialog-content {
  max-height: 70vh;
}
</style>
