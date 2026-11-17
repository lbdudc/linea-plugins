<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Select from 'primevue/select';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Menu from 'primevue/menu';

import agentApi from '../../../api/agentApi.js';
import { notify } from '../harvest/notify.js';
import { autoAdjustForProposedFm } from './fmTreeSelection.js';
import FmTreeSelector from './FmTreeSelector.vue';

const props = defineProps({
  runId: { type: String, required: true },
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  initialFeatures: { type: Array, default: () => [] },
  initialTestImage: { type: String, default: '' },
  initialTestCommand: { type: String, default: '' },
  fmCurrent: { type: Object, default: null },
  fmProposed: { type: Object, default: null },
  status: { type: String, default: 'idle' },
  logLines: { type: Array, default: () => [] },
  mode: { type: String, default: 'proposal' },
  runDisabled: { type: Boolean, default: false },
});

const emit = defineEmits(['run', 'cancel']);
const { t } = useI18n();

const downloading = ref(false);
const branch = ref('main');
const featureSelection = ref([...props.initialFeatures]);
const overrideWithLineChanges = ref(true);
const testCommand = ref(props.initialTestCommand || '');
const testImage = ref(props.initialTestImage || '');
const logExpanded = ref(false);
const fmExpanded = ref(false);
const logContainer = ref(null);

const scrollToBottom = () => nextTick(() => {
  if (logContainer.value) logContainer.value.scrollTop = logContainer.value.scrollHeight;
});

watch(() => props.logLines.length, () => { if (logExpanded.value) scrollToBottom(); });
watch(logExpanded, (val) => { if (val) scrollToBottom(); });

watch(() => props.status, (s) => {
  if (s === 'running' || s === 'error' || s === 'failed') logExpanded.value = true;
});

const IMAGE_PRESETS = computed(() => [
  { label: t('labels.preset_local_label'), value: 'local', caption: t('labels.preset_local_caption') },
  { label: 'Node 20', value: 'node:20', caption: 'node:20' },
  { label: 'Node 22', value: 'node:22', caption: 'node:22' },
  { label: 'Maven + JDK 17', value: 'maven:3.9-eclipse-temurin-17', caption: 'maven:3.9-eclipse-temurin-17' },
  { label: 'Maven + JDK 21', value: 'maven:3.9-eclipse-temurin-21', caption: 'maven:3.9-eclipse-temurin-21' },
  { label: 'Gradle + JDK 21', value: 'gradle:8-jdk21', caption: 'gradle:8-jdk21' },
  { label: 'Python 3.12', value: 'python:3.12', caption: 'python:3.12' },
  { label: 'Go 1.22', value: 'golang:1.22', caption: 'golang:1.22' },
  { label: 'Rust 1.77', value: 'rust:1.77', caption: 'rust:1.77' },
]);
const imageMenuItems = computed(() => IMAGE_PRESETS.value.map((p) => ({
  label: p.label,
  command: () => { testImage.value = p.value; },
})));
const imageMenu = ref(null);

const activeFm = computed(() => props.fmProposed ?? props.fmCurrent);

watch(() => props.fmProposed, (newProp, oldProp) => {
  if (!newProp || oldProp || !props.fmCurrent) return;
  featureSelection.value = autoAdjustForProposedFm(featureSelection.value, props.fmCurrent, newProp);
}, { immediate: true });

const branchOptions = ref(['main']);
const branchLoading = ref(false);
let branchDebounce = null;

const onFilterBranch = (event) => {
  const q = event?.value ?? '';
  clearTimeout(branchDebounce);
  branchDebounce = setTimeout(async () => {
    branchLoading.value = true;
    try {
      const data = await agentApi.getPlaygroundBranches(props.runId, props.productId, q);
      const names = data.map((b) => b.name);
      branchOptions.value = names.length ? names : [branch.value];
    } catch {
    } finally {
      branchLoading.value = false;
    }
  }, 300);
};

const statusColor = computed(() => ({
  idle: 'var(--p-text-muted-color)',
  running: 'var(--p-agent-color)',
  passed: 'var(--status-ok-solid)',
  failed: 'var(--status-bad-solid)',
  error: 'var(--status-warn-solid)',
  cancelled: 'var(--p-text-muted-color)',
}[props.status] ?? 'var(--p-text-muted-color)'));

const statusIcon = computed(() => ({
  idle: 'pi pi-circle',
  running: 'pi pi-hourglass',
  passed: 'pi pi-check-circle',
  failed: 'pi pi-times-circle',
  error: 'pi pi-exclamation-circle',
  cancelled: 'pi pi-stop-circle',
}[props.status] ?? 'pi pi-circle'));

const statusLabel = computed(() => ({
  idle: t('labels.status_idle'),
  running: t('labels.status_running_long'),
  passed: t('labels.status_passed'),
  failed: t('labels.status_failed_long'),
  error: t('labels.status_error'),
  cancelled: t('labels.status_cancelled_long'),
}[props.status] ?? t('labels.status_idle')));

const running = computed(() => props.status === 'running');
const hasLog = computed(() => props.logLines.length > 0);
const selectedCount = computed(() => featureSelection.value.length);

const onRun = () => {
  emit('run', {
    productId: props.productId,
    branch: branch.value,
    featureSelection: featureSelection.value,
    overrideWithLineChanges: overrideWithLineChanges.value,
    testCommand: testCommand.value,
    testImage: testImage.value,
  });
};

defineExpose({
  triggerRun: () => { if (!running.value && !props.runDisabled) onRun(); },
});

const copyLog = async () => {
  const text = props.logLines.join('');
  try {
    await navigator.clipboard.writeText(text);
    notify({ type: 'positive', message: t('labels.log_copied') });
  } catch {
    notify({ type: 'negative', message: t('labels.log_copy_failed') });
  }
};

const downloadLog = () => {
  const text = props.logLines.join('');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(props.productName || 'product').replace(/[^a-z0-9]+/gi, '-')}-log-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const onDownload = async () => {
  downloading.value = true;
  try {
    const download = props.mode === 'plan_branch'
      ? agentApi.downloadPlaygroundBranchProduct
      : agentApi.downloadPlaygroundProduct;
    await download(
      props.runId,
      {
        productId: props.productId,
        branch: branch.value,
        featureSelection: featureSelection.value,
        overrideWithLineChanges: overrideWithLineChanges.value,
      },
      props.productName,
    );
  } catch {
    notify({ type: 'negative', message: t('labels.download_failed') });
  } finally {
    downloading.value = false;
  }
};

const saving = ref(false);
const onSaveSelection = async () => {
  saving.value = true;
  try {
    await agentApi.savePlaygroundSelection(props.runId, {
      productId: props.productId,
      featureSelection: featureSelection.value,
    });
    notify({ type: 'positive', message: t('labels.playground_save_ok', { n: featureSelection.value.length }) });
  } catch (err) {
    notify({ type: 'negative', message: err?.response?.data?.error ?? t('labels.playground_save_ko') });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div class="pg-row">
    <div class="pg-row__header">
      <div class="pg-row__name" :title="productName">{{ productName }}</div>

      <Select
        v-model="branch"
        :options="branchOptions"
        editable
        filter
        :loading="branchLoading"
        :placeholder="t('labels.branch')"
        class="pg-row__branch"
        @filter="onFilterBranch"
      />

      <Button
        text
        size="small"
        :icon="fmExpanded ? 'pi pi-angle-up' : 'pi pi-sliders-h'"
        :label="`${selectedCount} ${selectedCount !== 1 ? t('labels.feature_plural') : t('labels.feature_singular')}`"
        :title="fmExpanded ? t('labels.collapse_feature_selection') : t('labels.edit_feature_selection')"
        class="pg-row__fm-btn"
        @click="fmExpanded = !fmExpanded"
      />

      <div class="pg-row__override">
        <Checkbox v-model="overrideWithLineChanges" :binary="true" input-id="pg-override" />
        <label for="pg-override" :title="t('labels.override_tooltip')">{{ t('labels.override') }}</label>
      </div>

      <InputText v-model="testCommand" :placeholder="t('labels.auto_detect')" :aria-label="t('labels.test_cmd')" class="pg-row__cmd" />

      <div class="pg-row__image">
        <InputText v-model="testImage" :placeholder="t('labels.auto_detect')" :aria-label="t('labels.image')" class="pg-row__image-input" />
        <Button text size="small" icon="pi pi-angle-down" :title="t('labels.pick_preset_image')" @click="imageMenu?.toggle($event)" />
        <Menu ref="imageMenu" :model="imageMenuItems" popup />
      </div>

      <div class="pg-row__spacer"></div>

      <i :class="statusIcon" :style="{ color: statusColor }" :title="statusLabel" aria-hidden="true"></i>
      <span class="pg-row__status" :style="{ color: statusColor }">{{ statusLabel }}</span>

      <Button
        v-if="hasLog"
        text rounded size="small"
        :icon="logExpanded ? 'pi pi-angle-up' : 'pi pi-angle-down'"
        :title="logExpanded ? t('labels.hide_output') : t('labels.show_output')"
        @click="logExpanded = !logExpanded"
      />

      <Button
        text rounded size="small"
        icon="pi pi-bookmark"
        :loading="saving"
        :disabled="running || saving"
        :title="t('labels.playground_save_tooltip')"
        @click="onSaveSelection"
      />

      <Button
        text rounded size="small"
        icon="pi pi-download"
        :loading="downloading"
        :disabled="running || downloading"
        :title="t('labels.download_derived_zip')"
        @click="onDownload"
      />

      <Button
        size="small"
        icon="pi pi-play"
        :label="t('labels.run')"
        :loading="running"
        :disabled="running || downloading || runDisabled"
        :title="runDisabled ? t('labels.assume_pass_tooltip') : null"
        @click="onRun"
      />
      <Button
        v-if="running"
        text rounded size="small"
        icon="pi pi-stop-circle"
        :style="{ color: 'var(--status-bad-solid)' }"
        :title="t('labels.cancel_test_job')"
        @click="emit('cancel', productId)"
      />
    </div>

    <div v-if="fmExpanded" class="pg-row__fm">
      <div class="pg-row__fm-head">
        <i class="pi pi-sitemap" aria-hidden="true"></i>
        <span>{{ fmProposed ? t('labels.proposed_feature_model') : t('labels.current_feature_model') }}</span>
        <span v-if="fmProposed" class="pg-row__fm-badge">{{ t('labels.includes_new_feature') }}</span>
      </div>
      <FmTreeSelector v-model="featureSelection" :tree="activeFm" :disabled="running" />
    </div>

    <div v-if="hasLog && logExpanded" class="pg-row__log-wrapper">
      <div class="pg-row__log-actions">
        <i class="pi pi-desktop" aria-hidden="true"></i>
        <span>{{ logLines.length }} lines</span>
        <div class="pg-row__spacer"></div>
        <Button text size="small" icon="pi pi-copy" :label="t('labels.log_copy')" @click="copyLog" />
        <Button text size="small" icon="pi pi-download" :label="t('labels.log_download')" @click="downloadLog" />
      </div>
      <div ref="logContainer" class="pg-row__log">
        <pre class="pg-row__log-pre">{{ logLines.join('') }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pg-row {
  border-bottom: 1px solid var(--p-content-border-color);
}

.pg-row:last-child {
  border-bottom: none;
}

.pg-row__header {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 12px;
}

.pg-row__name {
  min-width: 110px;
  max-width: 150px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pg-row__branch {
  width: 150px;
  flex: none;
}

.pg-row__fm-btn {
  font-size: 11.5px;
  flex: none;
}

.pg-row__override {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  flex: none;
}

.pg-row__cmd {
  width: 140px;
  flex: none;
}

.pg-row__image {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.pg-row__image-input {
  width: 150px;
}

.pg-row__spacer {
  flex: 1;
}

.pg-row__status {
  font-size: 11.5px;
  min-width: 58px;
}

.pg-row__fm {
  padding: 8px 14px 12px;
  background: var(--p-content-hover-background);
  border-top: 1px solid var(--p-content-border-color);
  max-height: 300px;
  overflow-y: auto;
}

.pg-row__fm-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.pg-row__fm-badge {
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--p-agent-color);
  color: var(--p-agent-color);
  font-size: 10px;
}

.pg-row__log-wrapper {
  border-top: 1px solid #333;
  background: #1e1e1e;
}

.pg-row__log-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: #262626;
  border-bottom: 1px solid #333;
  font-size: 11px;
  color: #999;
}

.pg-row__log {
  max-height: 260px;
  overflow-y: auto;
  padding: 8px 12px;
}

.pg-row__log-pre {
  margin: 0;
  font-size: 11px;
  font-family: 'Fira Code', 'Consolas', monospace;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
