<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import ToggleSwitch from 'primevue/toggleswitch';
import Select from 'primevue/select';
import ProgressSpinner from 'primevue/progressspinner';

import agentApi from '../../../api/agentApi.js';
import { notify } from '../harvest/notify.js';

const props = defineProps({
  lineId: { type: String, required: true },
  productId: { type: String, required: true },
});

const { t } = useI18n();

const policy = ref(null);
const loading = ref(true);
const saving = ref(false);

const SYNC_MODES = computed(() => [
  { label: t('labels.propose_and_wait'), value: 'propose_and_wait' },
  { label: t('labels.automatic_mode'), value: 'automatic' },
]);

const critical = computed({
  get: () => policy.value?.criticality === 'critical',
  set: (v) => save({ criticality: v ? 'critical' : 'normal' }),
});

const syncMode = computed({
  get: () => policy.value?.modes?.sync ?? 'propose_and_wait',
  set: (v) => save({ modes: { sync: v } }),
});

const save = async (patch) => {
  saving.value = true;
  try {
    policy.value = await agentApi.setPolicy({
      lineId: props.lineId,
      productId: props.productId,
      ...patch,
    });
  } catch (err) {
    notify({ type: 'negative', message: err.response?.data?.error ?? err.message });
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  try {
    policy.value = await agentApi.getPolicy({ lineId: props.lineId, productId: props.productId });
  } catch {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="pat">
    <Accordion :value="'0'">
      <AccordionPanel value="0">
        <AccordionHeader>
          <i class="pi pi-android" aria-hidden="true"></i>
          <span>{{ t('labels.agent_autonomy') }}</span>
        </AccordionHeader>
        <AccordionContent>
          <p class="pat__hint">{{ t('labels.agent_autonomy_hint') }}</p>

          <p class="pat__autosave">
            <i class="pi pi-bolt" aria-hidden="true"></i>
            {{ t('labels.agent_autonomy_autosave') }}
            <ProgressSpinner v-if="loading || saving" class="pat__spinner" stroke-width="6" />
          </p>

          <div class="pat__row">
            <div class="pat__row-text">
              <div class="pat__row-title">{{ t('labels.critical_product') }}</div>
              <div class="pat__row-desc">{{ t('labels.critical_product_hint') }}</div>
            </div>
            <ToggleSwitch v-model="critical" :disabled="loading || saving" />
          </div>

          <div class="pat__row">
            <div class="pat__row-text">
              <div class="pat__row-title">{{ t('labels.sync_agent_label') }}</div>
              <div class="pat__row-desc">{{ t('labels.sync_agent_hint') }}</div>
            </div>
            <Select
              v-model="syncMode"
              :options="SYNC_MODES"
              option-label="label"
              option-value="value"
              :disabled="loading || saving || critical"
              class="pat__select"
            />
          </div>

          <p v-if="critical" class="pat__banner">{{ t('labels.critical_banner') }}</p>
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
  </div>
</template>

<style scoped>
.pat__hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.pat__autosave {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 14px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.pat__spinner {
  width: 14px;
  height: 14px;
}

.pat__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 0;
  border-top: 1px solid var(--p-content-border-color);
}

.pat__row-text {
  min-width: 0;
}

.pat__row-title {
  font-size: 13px;
  color: var(--p-text-color);
}

.pat__row-desc {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.pat__select {
  min-width: 200px;
}

.pat__banner {
  margin: 12px 0 0;
  padding: 8px 10px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--status-warn-soft);
  color: var(--status-warn);
}
</style>
