<script setup>
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';

const props = defineProps({
  agentType: { type: String, default: null },
  modelValue: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue']);
const { t } = useI18n();

const DEFAULTS = { featureName: '', annotate: false, mode: 'migration', proposedModelUvl: '', dryRun: false };

const modeOptions = computed(() => MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })));

const form = reactive({ ...DEFAULTS, ...props.modelValue });

watch(
  () => props.modelValue,
  (v) => Object.assign(form, { ...DEFAULTS, ...v }),
  { deep: true },
);

watch(form, () => emit('update:modelValue', { ...form }), { deep: true });

const DRY_RUN_AGENTS = new Set(['harvest', 'fm-constraint-advisor']);

const MODE_OPTIONS = [
  { value: 'migration', labelKey: 'labels.form_mode_migration' },
  { value: 'impact', labelKey: 'labels.form_mode_impact' },
];
</script>

<template>
  <div class="aif">
    <!-- feature-location -->
    <template v-if="agentType === 'feature-location'">
      <div class="aif__field aif__field--grow">
        <InputText v-model="form.featureName" :placeholder="t('labels.form_feature_name_placeholder')" class="aif__input" />
        <label class="aif__label">{{ t('labels.form_feature_name') }}</label>
      </div>
      <div class="aif__field aif__field--inline">
        <Checkbox v-model="form.annotate" :binary="true" input-id="aif-annotate" />
        <label for="aif-annotate">{{ t('labels.form_annotate') }}</label>
      </div>
    </template>

    <!-- evolution -->
    <template v-else-if="agentType === 'evolution'">
      <div class="aif__field">
        <Select
          v-model="form.mode"
          :options="modeOptions"
          option-label="label"
          option-value="value"
          class="aif__select"
        />
        <label class="aif__label">{{ t('labels.form_mode') }}</label>
      </div>
      <div v-if="form.mode === 'impact'" class="aif__field aif__field--grow aif__field--block">
        <Textarea v-model="form.proposedModelUvl" rows="5" class="aif__textarea" />
        <label class="aif__label">{{ t('labels.form_proposed_uvl') }}</label>
        <p class="aif__hint">{{ t('labels.form_proposed_uvl_hint') }}</p>
      </div>
    </template>

    <p v-else class="aif__empty">{{ t('labels.config_no_inputs') }}</p>

    <div v-if="DRY_RUN_AGENTS.has(agentType)" class="aif__dry-run">
      <ToggleSwitch v-model="form.dryRun" input-id="aif-dry-run" />
      <label for="aif-dry-run">{{ t('labels.form_dry_run') }}</label>
      <span class="aif__hint">{{ t('labels.form_dry_run_tooltip') }}</span>
    </div>
  </div>
</template>

<style scoped>
.aif {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.aif__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.aif__field--grow {
  flex: 1;
  min-width: 200px;
}

.aif__field--inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.aif__field--block {
  flex-basis: 100%;
}

.aif__label {
  order: -1;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.aif__input,
.aif__select,
.aif__textarea {
  width: 100%;
}

.aif__empty {
  margin: 0;
  font-size: 12px;
  color: var(--p-text-dim-color);
}

.aif__dry-run {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 6px;
}

.aif__hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}
</style>
