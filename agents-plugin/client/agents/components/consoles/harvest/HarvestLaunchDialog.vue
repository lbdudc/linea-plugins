<script setup>
import { ref, shallowRef, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import RadioButton from 'primevue/radiobutton';
import DatePicker from 'primevue/datepicker';
import Checkbox from 'primevue/checkbox';
import Button from 'primevue/button';

import agentApi from '../../../api/agentApi.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  productId: { type: String, required: true },
});

const emit = defineEmits(['update:modelValue', 'launch']);

const { t } = useI18n();

const MODE_OPTIONS = computed(() => [
  { value: 'bigbang', label: t('labels.all_direct_changes'), caption: t('labels.all_direct_changes_caption'), icon: 'pi pi-history' },
  { value: 'last_harvest', label: t('labels.since_last_harvest'), caption: t('labels.since_last_harvest_caption'), icon: 'pi pi-refresh' },
  { value: 'date', label: t('labels.since_specific_date'), caption: t('labels.since_specific_date_caption'), icon: 'pi pi-calendar' },
  { value: 'commit', label: t('labels.since_specific_commit'), caption: t('labels.since_specific_commit_caption'), icon: 'pi pi-code' },
]);

const mode = shallowRef('bigbang');
const fromDate = shallowRef(null);
const fromCommit = shallowRef(null);
const dryRun = shallowRef(false);

const commits = ref([]);
const commitsLoading = shallowRef(false);
const commitsLoaded = shallowRef(false);
const commitsError = shallowRef(false);

const commitOptions = computed(() =>
  commits.value.map((c) => ({
    label: `${c.short_id} — ${c.title}`,
    caption: `${c.author_name} · ${new Date(c.created_at).toLocaleDateString()}`,
    value: c.id,
  })),
);

const canLaunch = computed(() => {
  if (mode.value === 'date') return fromDate.value != null;
  if (mode.value === 'commit') return fromCommit.value !== null;
  return true;
});

const loadCommits = async () => {
  commitsLoading.value = true;
  commitsError.value = false;
  try {
    commits.value = await agentApi.getHarvestCommits(props.productId);
    commitsLoaded.value = true;
  } catch {
    commitsError.value = true;
  } finally {
    commitsLoading.value = false;
  }
};

watch(mode, (val) => {
  if (val === 'commit' && !commitsLoaded.value && !commitsLoading.value) loadCommits();
});

watch(() => props.modelValue, (open) => {
  if (open) {
    mode.value = 'bigbang';
    fromDate.value = null;
    fromCommit.value = null;
    dryRun.value = false;
  }
});

const onLaunch = () => {
  const input = { fromMode: mode.value };
  if (mode.value === 'date' && fromDate.value) {
    input.fromDate = fromDate.value.toISOString().slice(0, 10);
  }
  if (mode.value === 'commit') input.fromRef = fromCommit.value;
  if (dryRun.value) input.dryRun = true;
  emit('launch', input);
  emit('update:modelValue', false);
};

const onClose = () => emit('update:modelValue', false);
</script>

<template>
  <Dialog
    :visible="modelValue"
    modal
    :header="t('labels.harvest_scope')"
    class="hld"
    @update:visible="$emit('update:modelValue', $event)"
  >
    <p class="hld__hint">{{ t('labels.harvest_changes_from') }}</p>

    <div class="hld__modes">
      <label
        v-for="opt in MODE_OPTIONS"
        :key="opt.value"
        class="hld__mode"
        :class="{ 'hld__mode--active': mode === opt.value }"
      >
        <RadioButton v-model="mode" :value="opt.value" size="small" />
        <span class="hld__mode-body">
          <span class="hld__mode-label">{{ opt.label }}</span>
          <span class="hld__mode-caption">{{ opt.caption }}</span>
        </span>
        <i :class="opt.icon" class="hld__mode-icon" aria-hidden="true"></i>
      </label>
    </div>

    <div v-if="mode === 'date'" class="hld__extra">
      <label class="hld__field-label" for="hld-date">{{ t('labels.from_date') }}</label>
      <DatePicker id="hld-date" v-model="fromDate" date-format="yy-mm-dd" show-icon size="small" />
    </div>

    <div v-if="mode === 'commit'" class="hld__extra">
      <label class="hld__field-label" for="hld-commit">{{ t('labels.from_commit_main') }}</label>
      <Select
        id="hld-commit"
        v-model="fromCommit"
        :options="commitOptions"
        option-label="label"
        option-value="value"
        :loading="commitsLoading"
        :placeholder="commitsError ? t('labels.failed_to_load_commits') : t('labels.no_commits_found')"
        class="hld__commit-select"
      >
        <template #option="{ option }">
          <div>
            <div class="hld__commit-label">{{ option.label }}</div>
            <div class="hld__commit-caption">{{ option.caption }}</div>
          </div>
        </template>
      </Select>
    </div>

    <div class="hld__dry">
      <Checkbox v-model="dryRun" input-id="hld-dry" binary />
      <label for="hld-dry" :title="t('labels.simulate_harvest_no_mr')">{{ t('labels.dry_run') }}</label>
    </div>

    <template #footer>
      <Button :label="t('labels.cancel')" text size="small" @click="onClose" />
      <Button :label="t('labels.run_harvest')" icon="pi pi-upload" size="small" :disabled="!canLaunch" @click="onLaunch" />
    </template>
  </Dialog>
</template>

<style scoped>
.hld__hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.hld__modes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hld__mode {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  cursor: pointer;
}

.hld__mode:hover {
  background: var(--hover-veil);
}

.hld__mode--active {
  border-color: var(--p-agent-color);
  background: var(--p-agent-highlight-soft);
}

.hld__mode-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.hld__mode-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
}

.hld__mode-caption {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.hld__mode-icon {
  color: var(--p-text-dim-color);
  flex: none;
}

.hld__extra {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 12px;
  padding-left: 34px;
}

.hld__field-label {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.hld__commit-select {
  max-width: 380px;
}

.hld__commit-label {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}

.hld__commit-caption {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.hld__dry {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--p-content-border-color);
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
}
</style>

<style>
.p-dialog.hld {
  width: 480px;
  max-width: 96vw;
}
</style>
