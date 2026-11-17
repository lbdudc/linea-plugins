<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const MODES = computed(() => [
  { value: 'manual', label: t('labels.autonomy_mode_manual'), desc: t('labels.autonomy_mode_manual_hint') },
  { value: 'semi', label: t('labels.autonomy_mode_semi'), desc: t('labels.autonomy_mode_semi_hint') },
  { value: 'automatic', label: t('labels.autonomy_mode_automatic'), desc: t('labels.autonomy_mode_automatic_hint') },
]);

const props = defineProps({
  modelValue: { type: String, default: 'semi' },
  disabled: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue']);

function elegir(mode) {
  if (props.disabled || props.saving || mode === props.modelValue) return;
  emit('update:modelValue', mode);
}
</script>

<template>
  <div class="autonomy">
    <div class="autonomy__header">
      <span class="autonomy__titulo rotulo">{{ t('labels.agent_autonomy') }}</span>
      <div class="autonomy__regla" aria-hidden="true"></div>
    </div>

    <p v-if="disabled" class="autonomy__nota">
      {{ t('labels.autonomy_disabled_note') }}
    </p>

    <div class="autonomy__grid" role="radiogroup" :aria-label="t('labels.autonomy_radiogroup_aria')" :class="{ 'autonomy__grid--disabled': disabled }">
      <button
        v-for="m in MODES"
        :key="m.value"
        type="button"
        class="autonomy__card"
        role="radio"
        :aria-checked="modelValue === m.value"
        :disabled="disabled"
        :class="{ 'autonomy__card--activa': modelValue === m.value }"
        @click="elegir(m.value)"
      >
        <div class="autonomy__card-cabecera">
          <span class="autonomy__radio" aria-hidden="true">
            <span v-if="modelValue === m.value" class="autonomy__radio-punto"></span>
          </span>
          <span class="autonomy__card-label">{{ m.label }}</span>
        </div>
        <span class="autonomy__card-desc">{{ m.desc }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.autonomy {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 26px;
}

.autonomy__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.autonomy__regla {
  flex-grow: 1;
  height: 1px;
  background: var(--p-content-hover-background);
}

.autonomy__nota {
  margin: 0;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.autonomy__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  max-width: 860px;
}

.autonomy__grid--disabled {
  opacity: 0.55;
}

.autonomy__card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 7px;
  background: var(--p-content-background);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.autonomy__card:disabled {
  cursor: default;
}

.autonomy__card--activa {
  border-color: var(--p-agent-background);
  background: var(--p-agent-highlight-soft);
}

.autonomy__card-cabecera {
  display: flex;
  align-items: center;
  gap: 9px;
}

.autonomy__radio {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1.5px solid var(--p-text-faint-color);
  display: flex;
  align-items: center;
  justify-content: center;
}

.autonomy__card--activa .autonomy__radio {
  border-color: var(--p-agent-color);
}

.autonomy__radio-punto {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--p-agent-color);
}

.autonomy__card-label {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--p-text-secondary-color);
}

.autonomy__card--activa .autonomy__card-label {
  color: var(--p-text-color);
}

.autonomy__card-desc {
  font-size: 12px;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}
</style>
