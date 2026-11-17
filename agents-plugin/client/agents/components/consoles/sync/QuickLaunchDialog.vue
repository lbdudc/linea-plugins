<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Checkbox from 'primevue/checkbox';
import ToggleSwitch from 'primevue/toggleswitch';
import Button from 'primevue/button';

import { scope } from '../../../stores/scope.js';
import { agentCopy } from '../../catalog/agentCatalogCopy.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  agents: { type: Array, default: () => [] },
  starting: { type: Boolean, default: false },
  createRun: { type: Function, required: true },
});
const emit = defineEmits(['update:modelValue', 'launched']);

const { t } = useI18n();

const close = (value) => emit('update:modelValue', value);

const DRY_RUN_AGENTS = new Set(['harvest', 'fm-constraint-advisor']);

const agentTitle = (type) => agentCopy(type)?.name ?? props.agents.find((a) => a.type === type)?.title ?? type;

const form = ref({
  agentType: null,
  featureName: '',
  annotate: false,
  mode: 'migration',
  proposedModelUvl: '',
  dryRun: false,
});

watch(
  () => form.value.agentType,
  () => {
    form.value.featureName = '';
    form.value.annotate = false;
    form.value.mode = 'migration';
    form.value.proposedModelUvl = '';
    form.value.dryRun = false;
  },
);

const lineScopedAgents = computed(() => props.agents.filter((a) => a.scope === 'line'));

const agentOptions = computed(() => lineScopedAgents.value.map((a) => ({ label: agentTitle(a.type), value: a.type })));

const modeOptions = computed(() => [
  { label: t('labels.form_mode_migration'), value: 'migration' },
  { label: t('labels.form_mode_impact'), value: 'impact' },
]);

watch(
  () => props.agents,
  (list) => {
    if (form.value.agentType) return;
    const firstLineAgent = list.find((a) => a.scope === 'line');
    if (firstLineAgent) form.value.agentType = firstLineAgent.type;
  },
  { immediate: true },
);

const buildInput = () => {
  let input = {};
  switch (form.value.agentType) {
    case 'feature-location':
      input = { featureName: form.value.featureName.trim(), annotate: form.value.annotate };
      break;
    case 'evolution': {
      input = { mode: form.value.mode };
      if (form.value.mode === 'impact') input.proposedModelUvl = form.value.proposedModelUvl.trim();
      break;
    }
  }
  if (form.value.dryRun) input.dryRun = true;
  return input;
};

const isLaunchDisabled = computed(() => {
  if (!form.value.agentType || !scope.lineId) return true;
  if (form.value.agentType === 'feature-location' && !form.value.featureName.trim()) return true;
  if (form.value.agentType === 'evolution' && form.value.mode === 'impact' && !form.value.proposedModelUvl.trim()) return true;
  return false;
});

const startRun = async () => {
  if (!form.value.agentType || !scope.lineId) return;
  const run = await props.createRun({
    agentType: form.value.agentType,
    scope: { lineId: scope.lineId },
    input: buildInput(),
  });
  if (run) {
    close(false);
    emit('launched', run);
  }
};
</script>

<template>
  <Dialog :visible="modelValue" modal class="qld" @update:visible="close">
    <template #header>
      <i class="pi pi-send" aria-hidden="true"></i>
      <span class="qld__title">{{ t('labels.quick_launch') }}</span>
    </template>

    <div class="qld__row">
      <Select
        v-model="form.agentType"
        :options="agentOptions"
        option-label="label"
        option-value="value"
        :placeholder="t('labels.form_agent')"
        class="qld__field"
      />
    </div>

    <template v-if="form.agentType === 'feature-location'">
      <div class="qld__row">
        <InputText
          v-model="form.featureName"
          :placeholder="t('labels.form_feature_name_placeholder')"
          class="qld__field"
        />
      </div>
      <p class="qld__hint">{{ t('labels.form_feature_name_hint') }}</p>
      <label class="qld__row qld__row--check">
        <Checkbox v-model="form.annotate" binary />
        <span>{{ t('labels.form_annotate') }}</span>
      </label>
    </template>

    <template v-else-if="form.agentType === 'evolution'">
      <div class="qld__row">
        <Select
          v-model="form.mode"
          :options="modeOptions"
          option-label="label"
          option-value="value"
          class="qld__field"
        />
      </div>
      <div v-if="form.mode === 'impact'" class="qld__row">
        <Textarea v-model="form.proposedModelUvl" auto-resize rows="6" class="qld__field" :placeholder="t('labels.form_proposed_uvl_hint')" />
      </div>
    </template>

    <label v-if="DRY_RUN_AGENTS.has(form.agentType)" class="qld__row qld__row--check">
      <ToggleSwitch v-model="form.dryRun" />
      <span>{{ t('labels.form_dry_run') }}</span>
    </label>

    <template #footer>
      <Button :label="t('labels.dialog_cancel')" text @click="close(false)" />
      <Button
        icon="pi pi-play"
        :label="form.dryRun ? t('labels.btn_dry_run') : t('labels.btn_run')"
        :loading="starting"
        :disabled="isLaunchDisabled"
        @click="startRun"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.qld__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.qld__row {
  margin-bottom: 12px;
}

.qld__row--check {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
}

.qld__field {
  width: 100%;
}

.qld__hint {
  margin: -8px 0 12px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}
</style>

<style>
.p-dialog.qld {
  width: 560px;
  max-width: 92vw;
}

.qld .p-dialog-header {
  display: flex;
  align-items: center;
  gap: 9px;
}
</style>
