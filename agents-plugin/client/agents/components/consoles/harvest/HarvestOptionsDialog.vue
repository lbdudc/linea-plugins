<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import RadioButton from 'primevue/radiobutton';
import Textarea from 'primevue/textarea';
import Button from 'primevue/button';

import agentApi from '../../../api/agentApi.js';
import { CHANGE_TYPE_META, changeTypeMeta } from './changeTypeMeta.js';
import { notify } from './notify.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  lineId: { type: String, default: null },
  candidate: { type: Object, default: null },
});

const emit = defineEmits(['update:modelValue', 'launch']);

const { t } = useI18n();

const STEERABLE_TYPES = ['new-optional-feature', 'extend-existing-feature', 'bugfix-to-generated'];
const changeTypeOptions = computed(() =>
  STEERABLE_TYPES.map((ty) => ({
    value: ty,
    label: CHANGE_TYPE_META[ty] ? changeTypeMeta(ty).label : ty,
    icon: CHANGE_TYPE_META[ty]?.icon ?? 'pi pi-question-circle',
  })),
);

const intent = ref('as-is');
const changeType = ref(null);
const targetFeature = ref(null);
const directive = ref('');

const features = ref([]);
const featureFilter = ref('');
const featuresLoading = ref(false);

const showTargetFeature = computed(() => changeType.value === 'extend-existing-feature' || intent.value === 'aggregate');

const risk = computed(() => props.candidate?.risk ?? null);
const showRisk = computed(() => risk.value && (risk.value.level === 'high' || risk.value.level === 'medium'));

const filteredFeatures = computed(() => {
  const q = featureFilter.value.trim().toLowerCase();
  if (!q) return features.value;
  return features.value.filter((f) => f.toLowerCase().includes(q));
});

const loadFeatures = async () => {
  if (!props.lineId || features.value.length || featuresLoading.value) return;
  featuresLoading.value = true;
  try {
    const { features: list } = await agentApi.getLineFeatures({ lineId: props.lineId });
    features.value = Array.isArray(list) ? list : [];
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_load_line_features') });
  } finally {
    featuresLoading.value = false;
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    intent.value = 'as-is';
    changeType.value = STEERABLE_TYPES.includes(props.candidate?.suggestedType) ? props.candidate.suggestedType : null;
    targetFeature.value = null;
    directive.value = '';
    featureFilter.value = '';
    loadFeatures();
  },
);

const launch = () => {
  emit('launch', {
    steering: {
      intent: intent.value,
      changeType: changeType.value ?? null,
      targetFeature: showTargetFeature.value ? targetFeature.value ?? null : null,
      directive: directive.value.trim(),
    },
  });
  emit('update:modelValue', false);
};

const onClose = () => emit('update:modelValue', false);
</script>

<template>
  <Dialog :visible="modelValue" modal :header="t('labels.harvest_options')" class="ho" @update:visible="$emit('update:modelValue', $event)">
    <p v-if="candidate" class="ho__subject">
      {{ t('labels.steering_harvest_of') }} <strong>{{ candidate.representativeProductName || t('labels.the_representative_product') }}</strong>
      ({{ candidate.fileCount }} {{ candidate.fileCount === 1 ? t('labels.file_singular') : t('labels.file_plural') }})
    </p>

    <div v-if="showRisk" class="ho__risk" :class="risk.level === 'high' ? 'ho__risk--high' : 'ho__risk--medium'">
      <i :class="risk.level === 'high' ? 'pi pi-exclamation-triangle' : 'pi pi-exclamation-circle'" aria-hidden="true"></i>
      <span>
        <strong>{{ risk.level === 'high' ? t('labels.high_risk_harvest') : t('labels.elevated_risk_harvest') }}.</strong>
        <template v-if="risk.highTouch?.length"> {{ t('labels.touches_build_ci_config') }}: <code>{{ risk.highTouch.join(', ') }}</code>.</template>
        <template v-if="risk.sharedWith"> {{ t('labels.shares_files_with_others', { n: risk.sharedWith }) }}</template>
        {{ t('labels.review_diff_before_launch') }}
      </span>
    </div>

    <div class="ho__body">
      <div class="ho__label">{{ t('labels.intent_label') }}</div>
      <div class="ho__intent">
        <label class="ho__radio">
          <RadioButton v-model="intent" value="aggregate" size="small" />
          {{ t('labels.aggregate_into_platform') }}
        </label>
        <label class="ho__radio">
          <RadioButton v-model="intent" value="as-is" size="small" />
          {{ t('labels.harvest_as_is') }}
        </label>
      </div>
      <p class="ho__hint">
        {{ intent === 'aggregate' ? t('labels.intent_aggregate_hint') : t('labels.intent_as_is_hint') }}
      </p>

      <div class="ho__label">{{ t('labels.change_type') }}</div>
      <Select
        v-model="changeType"
        :options="changeTypeOptions"
        option-label="label"
        option-value="value"
        show-clear
        :placeholder="t('labels.let_agent_decide')"
        class="ho__select"
      >
        <template #option="{ option }">
          <div class="ho__option">
            <i :class="option.icon" aria-hidden="true"></i>
            <span>{{ option.label }}</span>
          </div>
        </template>
      </Select>

      <template v-if="showTargetFeature">
        <div class="ho__label">{{ t('labels.target_feature') }}</div>
        <Select
          v-model="targetFeature"
          :options="filteredFeatures"
          :loading="featuresLoading"
          editable
          filter
          show-clear
          :placeholder="t('labels.feature_to_extend')"
          :empty-filter-message="t('labels.no_matching_feature')"
          class="ho__select"
          @filter="(e) => (featureFilter = e.value)"
        />
        <p class="ho__hint">{{ t('labels.target_feature_hint') }}</p>
      </template>

      <div class="ho__label">{{ t('labels.directive_label') }}</div>
      <Textarea v-model="directive" auto-resize rows="3" :placeholder="t('labels.directive_placeholder')" class="ho__textarea" />
    </div>

    <template #footer>
      <Button :label="t('labels.cancel')" text size="small" @click="onClose" />
      <Button :label="t('labels.launch_harvest')" icon="pi pi-upload" size="small" @click="launch" />
    </template>
  </Dialog>
</template>

<style scoped>
.ho__subject {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.ho__risk {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}

.ho__risk--high {
  color: var(--status-bad-strong);
  background: var(--status-bad-soft);
  border: 1px solid var(--status-bad-border);
}

.ho__risk--medium {
  color: var(--status-warn-solid);
  background: var(--status-warn-soft);
  border: 1px solid var(--status-warn-border);
}

.ho__risk code {
  background: var(--p-content-hover-background);
  padding: 1px 4px;
  border-radius: 3px;
}

.ho__label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-text-dim-color);
  margin: 12px 0 5px;
}

.ho__label:first-child {
  margin-top: 0;
}

.ho__intent {
  display: flex;
  gap: 16px;
}

.ho__radio {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
}

.ho__hint {
  margin: 5px 0 0;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.ho__select,
.ho__textarea {
  width: 100%;
}

.ho__option {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>

<style>
.p-dialog.ho {
  width: 460px;
  max-width: 94vw;
}

.ho .p-dialog-content {
  max-height: 70vh;
}
</style>
