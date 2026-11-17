<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Menu from 'primevue/menu';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';

import { connect as conectarSocket } from '../../../boot/ws.js';
import agentApi from '../../../api/agentApi.js';
import { buildPatch, downloadText } from '../../activity/diffUtils.js';

import HarvestDiffView from './HarvestDiffView.vue';
import MarkdownView from './MarkdownView.vue';
import PlaygroundTab from '../pruebas/PlaygroundTab.vue';
import { changeTypeMeta, CHANGE_TYPE_META } from './changeTypeMeta.js';
import { notify } from './notify.js';
import { buildFileList, buildPatchFiles, buildReclassifyMessage, seedChatFromSteps } from './harvestReview.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  run: { type: Object, default: null },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['update:modelValue', 'refine', 'decide', 'restore']);

const { t } = useI18n();

const REVIEW_KINDS = ['fm_patch', 'merge_resolution'];

const proposal = computed(() => (props.run?.proposals ?? []).find((p) => REVIEW_KINDS.includes(p.kind) && !p.decision) ?? null);

const isResolution = computed(() => proposal.value?.kind === 'merge_resolution');
const acceptLabel = computed(() => (isResolution.value ? t('labels.accept_commit_resolution') : t('labels.accept_open_mr')));
const headIcon = computed(() => (isResolution.value ? 'pi pi-sitemap' : 'pi pi-arrow-up-right'));

const validation = computed(() => proposal.value?.body?.validation ?? null);
const validationLoading = ref(false);

const runValidation = async () => {
  if (validationLoading.value || !props.run?._id) return;
  validationLoading.value = true;
  try {
    await agentApi.validateSync(props.run._id);
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_run_validation') });
  } finally {
    validationLoading.value = false;
  }
};

const patchFiles = computed(() => buildPatchFiles(proposal.value?.body));
const files = computed(() => buildFileList(proposal.value?.body, patchFiles.value));

const versions = computed(() => proposal.value?.body?.versions ?? []);
const restoring = ref(false);
const versionsMenu = ref(null);
const versionMenuItems = computed(() =>
  versions.value.map((v, i) => ({
    label: v.label || t('labels.version_default', { n: i + 1 }),
    command: () => restore(i),
  })),
);
const restore = (versionIndex) => {
  if (restoring.value) return;
  restoring.value = true;
  emit('restore', { versionIndex });
};

const downloadPatch = () => {
  const patch = buildPatch(patchFiles.value);
  if (!patch) {
    notify({ type: 'warning', message: t('labels.no_file_changes_to_export') });
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadText(`agent-${proposal.value?.kind ?? 'changes'}-${stamp}.patch`, patch);
};

const launchingChangeset = ref(false);
const launchAsChangeset = async () => {
  if (launchingChangeset.value || !props.run?._id) return;
  launchingChangeset.value = true;
  try {
    await agentApi.harvestToChangeset(props.run._id);
    emit('update:modelValue', false);
    notify({ type: 'positive', message: t('labels.hrd_changeset_started') });
  } catch {
    notify({ type: 'negative', message: t('labels.hrd_changeset_start_error') });
  } finally {
    launchingChangeset.value = false;
  }
};

const selectedKey = ref(null);
const selectedFile = computed(() => files.value.find((f) => f.key === selectedKey.value) ?? files.value[0] ?? null);
const selectedFileNoChange = computed(() => {
  const s = selectedFile.value?.stats;
  return Boolean(s) && !s.added && !s.deleted;
});

const threeWay = ref(false);
const canThreeWay = computed(() => isResolution.value && Boolean(selectedFile.value) && selectedFile.value.theirs != null);

const editing = ref(false);
const editText = ref('');
const savingEdit = ref(false);
const canEdit = computed(() => Boolean(selectedFile.value) && !selectedFile.value.isOverview && selectedFile.value.key !== '__fm__');
const startEdit = () => {
  if (!canEdit.value) return;
  editText.value = selectedFile.value.new ?? '';
  editing.value = true;
};
const cancelEdit = () => {
  editing.value = false;
};
const saveEdit = async () => {
  if (savingEdit.value || !props.run?._id || !selectedFile.value) return;
  savingEdit.value = true;
  try {
    await agentApi.editProposalFile(props.run._id, { path: selectedFile.value.path, newContent: editText.value });
    editing.value = false;
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_save_manual_edit') });
  } finally {
    savingEdit.value = false;
  }
};

const CONF_BADGE = computed(() => ({
  exact: { color: 'var(--status-ok-solid)', label: t('labels.conf_exact_label'), tip: t('labels.conf_exact_tip') },
  manual: { color: 'var(--p-agent-color)', label: t('labels.conf_manual_label'), tip: t('labels.conf_manual_tip') },
  ai: { color: 'var(--status-warn-solid)', label: t('labels.conf_ai_label'), tip: t('labels.conf_ai_tip') },
}));
const confBadge = (c) => CONF_BADGE.value[c] ?? CONF_BADGE.value.ai;

watch(
  files,
  (f) => {
    if (f.length && !f.find((x) => x.key === selectedKey.value)) selectedKey.value = f[0].key;
  },
  { immediate: true },
);

watch(selectedKey, () => {
  editing.value = false;
});

const messages = ref([]);
const input = ref('');
const sending = ref(false);
const chatScroll = ref(null);

const scrollChat = async () => {
  await nextTick();
  if (chatScroll.value) chatScroll.value.scrollTop = chatScroll.value.scrollHeight;
};

const seedChat = () => {
  messages.value = seedChatFromSteps(props.run?.steps, () => t('labels.proposal_updated'));
};

onMounted(seedChat);
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      seedChat();
      scrollChat();
    }
  },
);

const send = () => {
  const msg = input.value.trim();
  if (!msg || sending.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content: msg });
  sending.value = true;
  scrollChat();
  emit('refine', msg);
};

watch(
  () => proposal.value?.body,
  (nv, ov) => {
    if (!nv || nv === ov) return;
    if (sending.value) {
      messages.value.push({ role: 'assistant', content: t('labels.proposal_updated_review_diffs') });
      sending.value = false;
      scrollChat();
    }
    restoring.value = false;
  },
);

const decide = (decision) => emit('decide', { proposalId: proposal.value?._id, decision });

const RECLASS_TYPES = ['new-optional-feature', 'extend-existing-feature', 'bugfix-to-generated'];
const reclassOptions = computed(() => RECLASS_TYPES.map((ty) => ({ value: ty, label: changeTypeMeta(ty).label, icon: CHANGE_TYPE_META[ty]?.icon })));
const reclassOpen = ref(false);
const reclassType = ref(null);
const reclassFeature = ref(null);
const reclassFeatures = ref([]);
const reclassFeatureFilter = ref('');
const reclassFeaturesLoading = ref(false);

const lineId = computed(() => props.run?.scope?.lineId ?? null);
const showReclass = computed(() => !isResolution.value);
const reclassFilteredFeatures = computed(() => {
  const q = reclassFeatureFilter.value.trim().toLowerCase();
  if (!q) return reclassFeatures.value;
  return reclassFeatures.value.filter((f) => f.toLowerCase().includes(q));
});

const loadReclassFeatures = async () => {
  if (!lineId.value || reclassFeatures.value.length || reclassFeaturesLoading.value) return;
  reclassFeaturesLoading.value = true;
  try {
    const { features } = await agentApi.getLineFeatures({ lineId: lineId.value });
    reclassFeatures.value = Array.isArray(features) ? features : [];
  } catch {
  } finally {
    reclassFeaturesLoading.value = false;
  }
};

const toggleReclass = () => {
  reclassOpen.value = !reclassOpen.value;
  if (reclassOpen.value) loadReclassFeatures();
};

const rePropose = () => {
  if (sending.value) return;
  const message = buildReclassifyMessage({
    changeType: reclassType.value,
    targetFeature: reclassFeature.value,
    translateDirective: (ty) => t('labels.hrd_reclassify_directive', { type: ty }),
    translateTargeting: (f) => t('labels.hrd_targeting_feature_directive', { feature: f }),
    translateSuffix: () => t('labels.revise_proposal_accordingly'),
  });
  if (!message) {
    notify({ type: 'warning', message: t('labels.pick_change_type_or_target_feature') });
    return;
  }
  messages.value.push({ role: 'user', content: message });
  sending.value = true;
  scrollChat();
  emit('refine', message);
};

const activeTab = ref('review');

const valOpen = ref(true);
const testOpen = ref(true);

const testStatus = ref('idle');
const testJobId = ref(null);
const testLog = ref([]);
const testLogEl = ref(null);

const testHistory = computed(() => proposal.value?.body?.testHistory ?? []);
const expandedAttempts = ref(new Set());
const toggleAttempt = (i) => {
  const s = new Set(expandedAttempts.value);
  if (s.has(i)) s.delete(i);
  else s.add(i);
  expandedAttempts.value = s;
};

const scrollTestLog = async () => {
  await nextTick();
  if (testLogEl.value) testLogEl.value.scrollTop = testLogEl.value.scrollHeight;
};

const runTest = async () => {
  if (testStatus.value === 'running' || !props.run?._id) return;
  testStatus.value = 'running';
  testLog.value = [];
  testJobId.value = null;
  try {
    const { jobId } = await agentApi.testProposal(props.run._id);
    testJobId.value = jobId;
  } catch {
    testStatus.value = 'error';
    testLog.value.push(`${t('labels.test_could_not_start')}\n`);
    scrollTestLog();
  }
};

const onPlaygroundLog = ({ jobId, line }) => {
  if (jobId !== testJobId.value) return;
  testLog.value.push(line);
  scrollTestLog();
};
const onPlaygroundDone = ({ jobId, exitCode, passed }) => {
  if (jobId !== testJobId.value) return;
  testStatus.value = passed ? 'passed' : 'failed';
  testLog.value.push(`\n${t('labels.test_exit_code', { code: exitCode })}\n`);
  scrollTestLog();
};
const onPlaygroundError = ({ jobId, productId: pid, message }) => {
  const isOurs = jobId ? jobId === testJobId.value : pid === String(props.run?.scope?.productId);
  if (!isOurs) return;
  testStatus.value = 'error';
  testLog.value.push(`\n${t('labels.test_error_log', { message })}\n`);
  scrollTestLog();
};

onMounted(() => {
  conectarSocket().on('playground:log', onPlaygroundLog);
  conectarSocket().on('playground:done', onPlaygroundDone);
  conectarSocket().on('playground:error', onPlaygroundError);
});
onBeforeUnmount(() => {
  conectarSocket().off('playground:log', onPlaygroundLog);
  conectarSocket().off('playground:done', onPlaygroundDone);
  conectarSocket().off('playground:error', onPlaygroundError);
});

watch(
  () => proposal.value?.body,
  (nv, ov) => {
    if (nv && nv !== ov) {
      testStatus.value = 'idle';
      testLog.value = [];
      testJobId.value = null;
    }
  },
);
</script>

<template>
  <Dialog
    :visible="modelValue"
    modal
    maximized
    class="hr"
    @update:visible="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="hr__head">
        <i :class="headIcon" aria-hidden="true"></i>
        <span class="hr__head-title">{{ proposal?.body?.title || t('labels.review_changes') }}</span>
      </div>
    </template>
    <template #closeicon>
      <i class="pi pi-times" :title="t('labels.close')" aria-hidden="true"></i>
    </template>

    <div class="hr__toolbar">
      <Button text size="small" icon="pi pi-download" :label="t('labels.patch')" :disabled="!patchFiles.length" :title="t('labels.download_patch_tooltip')" @click="downloadPatch" />
      <template v-if="versions.length">
        <Button text size="small" icon="pi pi-history" :label="t('labels.versions_n', { n: versions.length })" :loading="restoring" @click="versionsMenu?.toggle($event)" />
        <Menu ref="versionsMenu" :model="versionMenuItems" popup />
      </template>
    </div>

    <Tabs v-model:value="activeTab" class="hr__tabs">
      <TabList>
        <Tab value="review"><i class="pi pi-eye" aria-hidden="true"></i> {{ t('labels.review') }}</Tab>
        <Tab v-if="!isResolution" value="playground"><i class="pi pi-desktop" aria-hidden="true"></i> {{ t('labels.playground') }}</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="review" class="hr__body">
          <div class="hr__files">
            <button
              v-for="f in files"
              :key="f.key"
              type="button"
              class="hr__file"
              :class="{ 'hr__file--active': f.key === selectedFile?.key }"
              @click="selectedKey = f.key"
            >
              <i :class="f.isOverview ? 'pi pi-align-left' : f.key === '__fm__' ? 'pi pi-sitemap' : 'pi pi-file'" aria-hidden="true"></i>
              <span class="hr__file-body">
                <span class="hr__file-label">{{ f.isOverview ? t('labels.overview_label') : f.label ?? f.path }}</span>
                <span class="hr__file-meta">
                  {{ f.action }}
                  <template v-if="f.stats && (f.stats.added || f.stats.deleted)">
                    <span class="hr__stat hr__stat--add">+{{ f.stats.added }}</span>
                    <span class="hr__stat hr__stat--del">-{{ f.stats.deleted }}</span>
                  </template>
                  <span v-else-if="f.stats" class="hr__stat hr__stat--none">{{ t('labels.no_changes_badge') }}</span>
                </span>
              </span>
              <Tag
                v-if="f.confidence && (isResolution || f.confidence === 'manual')"
                :value="confBadge(f.confidence).label"
                :style="{ color: confBadge(f.confidence).color, borderColor: confBadge(f.confidence).color }"
                class="hr__conf-badge"
                :title="confBadge(f.confidence).tip"
              />
            </button>
            <p v-if="!files.length" class="hr__files-empty">{{ t('labels.no_file_changes_proposed') }}</p>
          </div>

          <div class="hr__diff">
            <div class="hr__diff-head">
              <span class="hr__diff-head-title">{{ selectedFile ? (selectedFile.isOverview ? t('labels.overview_label') : selectedFile.label ?? selectedFile.path) : t('labels.select_a_file') }}</span>
              <div class="hr__spacer"></div>
              <Button
                v-if="canThreeWay && !editing"
                text
                size="small"
                :icon="threeWay ? 'pi pi-table' : 'pi pi-sort-alt'"
                :label="threeWay ? t('labels.three_way_short') : t('labels.two_way_short')"
                :title="threeWay ? t('labels.show_ours_to_proposed') : t('labels.compare_3way')"
                @click="threeWay = !threeWay"
              />
              <Button v-if="canEdit && !editing" text size="small" icon="pi pi-pencil" :label="t('labels.edit_label')" :title="t('labels.author_file_hand')" @click="startEdit" />
              <template v-if="editing">
                <Button text size="small" icon="pi pi-times" :label="t('labels.cancel')" :disabled="savingEdit" @click="cancelEdit" />
                <Button size="small" icon="pi pi-save" :label="t('labels.save_manual_edit')" :loading="savingEdit" @click="saveEdit" />
              </template>
            </div>
            <div class="hr__diff-body">
              <MarkdownView v-if="selectedFile && selectedFile.isOverview" :text="proposal?.body?.markdown || ''" class="hr__overview" />
              <textarea v-else-if="editing" v-model="editText" class="hr__editor" spellcheck="false"></textarea>
              <template v-else-if="selectedFile">
                <div v-if="selectedFileNoChange" class="hr__nochange"><i class="pi pi-info-circle" aria-hidden="true"></i>{{ t('labels.no_line_changes_in_file') }}</div>
                <HarvestDiffView :old-text="selectedFile.old" :new-text="selectedFile.new" :theirs-text="selectedFile.theirs" :three-way="threeWay && canThreeWay" />
              </template>
            </div>
          </div>

          <div class="hr__chat">
            <div class="hr__chat-head">{{ t('labels.refine_with_agent') }}</div>

            <template v-if="showReclass">
              <div class="hr__section">
                <div class="hr__section-head" @click="toggleReclass">
                  <span>{{ t('labels.re_classify') }}</span>
                  <div class="hr__spacer"></div>
                  <i :class="reclassOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" aria-hidden="true"></i>
                </div>
                <template v-if="reclassOpen">
                  <div class="hr__section-body">
                    <Select
                      v-model="reclassType"
                      :options="reclassOptions"
                      option-label="label"
                      option-value="value"
                      show-clear
                      :placeholder="t('labels.change_type')"
                      class="hr__section-field"
                    >
                      <template #option="{ option }">
                        <i :class="option.icon" aria-hidden="true"></i> {{ option.label }}
                      </template>
                    </Select>
                    <Select
                      v-model="reclassFeature"
                      :options="reclassFilteredFeatures"
                      editable
                      filter
                      show-clear
                      :loading="reclassFeaturesLoading"
                      :placeholder="t('labels.target_feature')"
                      :empty-filter-message="t('labels.no_matching_feature')"
                      class="hr__section-field"
                    />
                    <Button size="small" icon="pi pi-refresh" :label="t('labels.re_propose')" :disabled="sending || (!reclassType && !reclassFeature)" @click="rePropose" />
                  </div>
                </template>
              </div>
            </template>

            <template v-if="isResolution || proposal?.body?.newModelUvl">
              <div class="hr__section">
                <div class="hr__section-head" @click="valOpen = !valOpen">
                  <span>{{ t('labels.validation_label') }}</span>
                  <Tag
                    v-if="valOpen && validation"
                    :value="validation.fm?.valid ? t('labels.valid_label') : t('labels.invalid_label')"
                    :style="{ color: validation.fm?.valid ? 'var(--status-ok-solid)' : 'var(--status-bad-solid)', borderColor: validation.fm?.valid ? 'var(--status-ok-solid)' : 'var(--status-bad-solid)' }"
                  />
                  <div class="hr__spacer"></div>
                  <button type="button" class="icon-btn" :title="t('labels.rerun_fm_validation')" @click.stop="runValidation">
                    <i :class="validationLoading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" aria-hidden="true"></i>
                  </button>
                  <i :class="valOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" aria-hidden="true"></i>
                </div>
                <template v-if="valOpen">
                  <div v-if="validation" class="hr__section-body">
                    <i :class="validation.fm?.valid ? 'pi pi-check-circle' : 'pi pi-times-circle'" :style="{ color: validation.fm?.valid ? 'var(--status-ok-solid)' : 'var(--status-bad-solid)' }" aria-hidden="true"></i>
                    <div>
                      <div class="hr__val-line">{{ validation.fm?.valid ? t('labels.feature_model_valid') : t('labels.feature_model_invalid') }}</div>
                      <div v-for="v in validation.fm?.violations ?? []" :key="v" class="hr__val-violation">{{ v }}</div>
                    </div>
                  </div>
                  <div v-else class="hr__section-empty">{{ t('labels.not_yet_validated') }}</div>
                </template>
              </div>
            </template>

            <template v-if="isResolution">
              <div class="hr__section">
                <div class="hr__section-head" @click="testOpen = !testOpen">
                  <span>{{ t('labels.test_product_label') }}</span>
                  <Tag v-if="testStatus === 'passed'" :value="t('labels.test_passed_badge')" style="color: var(--status-ok-solid); border-color: var(--status-ok-solid)" />
                  <Tag v-else-if="testStatus === 'failed'" :value="t('labels.test_failed_badge')" style="color: var(--status-bad-solid); border-color: var(--status-bad-solid)" />
                  <Tag v-else-if="testStatus === 'error'" :value="t('labels.test_error_badge')" style="color: var(--status-warn-solid); border-color: var(--status-warn-solid)" />
                  <div class="hr__spacer"></div>
                  <button type="button" class="icon-btn" :title="t('labels.run_tests_proposed_edits')" @click.stop="runTest">
                    <i :class="testStatus === 'running' ? 'pi pi-spin pi-spinner' : 'pi pi-play'" aria-hidden="true"></i>
                  </button>
                  <i :class="testOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" aria-hidden="true"></i>
                </div>
                <template v-if="testOpen">
                  <div v-if="testHistory.length" class="hr__test-history">
                    <div class="hr__test-history-label">{{ t('labels.auto_resolution_attempts') }}</div>
                    <div v-for="(h, i) in testHistory" :key="i">
                      <div class="hr__test-attempt" @click="toggleAttempt(i)">
                        <Tag :value="h.passed ? t('labels.pass_label') : t('labels.fail_label')" :style="{ color: h.passed ? 'var(--status-ok-solid)' : 'var(--status-bad-solid)', borderColor: h.passed ? 'var(--status-ok-solid)' : 'var(--status-bad-solid)' }" />
                        <span>{{ t('labels.attempt_files', { n: h.attempt, count: h.fileCount }) }}</span>
                        <div class="hr__spacer"></div>
                        <i :class="expandedAttempts.has(i) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" aria-hidden="true"></i>
                      </div>
                      <pre v-if="expandedAttempts.has(i) && h.log" class="hr__test-pre">{{ h.log }}</pre>
                    </div>
                  </div>
                  <div v-if="testLog.length" ref="testLogEl" class="hr__test-log"><pre class="hr__test-pre">{{ testLog.join('') }}</pre></div>
                  <div v-else-if="!testHistory.length && testStatus === 'idle'" class="hr__section-empty">{{ t('labels.not_yet_tested') }}</div>
                </template>
              </div>
            </template>

            <div ref="chatScroll" class="hr__chat-msgs">
              <p class="hr__chat-hint">{{ t('labels.refine_chat_hint') }}</p>
              <div v-for="(m, i) in messages" :key="i" class="hr-msg" :class="`hr-msg--${m.role}`">
                <div class="hr-msg__bubble">{{ m.content }}</div>
              </div>
              <div v-if="sending" class="hr-msg hr-msg--assistant">
                <div class="hr-msg__bubble"><i class="pi pi-spin pi-spinner" aria-hidden="true"></i></div>
              </div>
            </div>
            <div class="hr__chat-input">
              <InputText v-model="input" class="hr__chat-input-field" :placeholder="t('labels.ask_for_change')" :disabled="sending" @keyup.enter="send" />
              <Button icon="pi pi-send" :disabled="!input.trim() || sending" @click="send" />
            </div>
          </div>
        </TabPanel>

        <TabPanel v-if="!isResolution" value="playground" class="hr__playground">
          <PlaygroundTab
            v-if="activeTab === 'playground'"
            :run-id="String(run?._id)"
            :run="run"
            :proposal="proposal"
          />
        </TabPanel>
      </TabPanels>
    </Tabs>

    <template #footer>
      <Button text :style="{ color: 'var(--status-bad-solid)' }" icon="pi pi-times" :label="t('labels.reject')" :disabled="busy || sending || launchingChangeset" @click="decide('rejected')" />
      <Button
        v-if="!isResolution"
        text
        icon="pi pi-sitemap"
        :label="t('labels.create_changeset_from_harvest')"
        :loading="launchingChangeset"
        :disabled="busy || sending || !proposal"
        :title="t('labels.create_changeset_from_harvest_tooltip')"
        @click="launchAsChangeset"
      />
      <Button :style="{ background: 'var(--status-ok-solid)', borderColor: 'var(--status-ok-solid)' }" icon="pi pi-check" :label="acceptLabel" :loading="busy" :disabled="sending || launchingChangeset" @click="decide('approved')" />
    </template>
  </Dialog>
</template>

<style scoped>
.hr__head {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--p-text-color);
}

.hr__head i {
  color: var(--p-agent-color);
}

.hr__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--p-content-border-color);
  flex: none;
}

.hr__tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.hr__tabs :deep(.p-tabpanels) {
  flex: 1;
  min-height: 0;
  padding: 0;
}

.hr__tabs :deep(.p-tabpanel) {
  height: 100%;
  min-height: 0;
}

.hr__body {
  display: flex;
  height: 100%;
  min-height: 0;
}

.hr__playground {
  height: 100%;
  min-height: 0;
}

.hr__spacer {
  flex: 1;
}

.hr__files {
  width: 240px;
  flex: none;
  overflow-y: auto;
  border-right: 1px solid var(--p-content-border-color);
}

.hr__file {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-bottom: 1px solid var(--p-content-hover-background);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--p-text-secondary-color);
}

.hr__file:hover {
  background: var(--hover-veil);
}

.hr__file--active {
  background: var(--p-agent-highlight-soft);
}

.hr__file i {
  flex: none;
  color: var(--p-text-dim-color);
}

.hr__file-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hr__file-label {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hr__file-meta {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.hr__stat {
  font-family: 'Fira Code', 'Courier New', monospace;
  font-weight: 600;
  margin-left: 6px;
}

.hr__stat--add {
  color: var(--diff-add-text);
}

.hr__stat--del {
  color: var(--diff-del-text);
}

.hr__stat--none {
  color: var(--p-text-dim-color);
  font-style: italic;
  font-weight: 500;
}

.hr__conf-badge {
  flex: none;
  font-size: 9px;
}

.hr__files-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--p-text-dim-color);
}

.hr__diff {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.hr__diff-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.hr__diff-head-title {
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hr__diff-body {
  flex: 1;
  overflow: auto;
  padding: 8px 0;
}

.hr__overview {
  padding: 0 16px;
}

.hr__nochange {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  font-size: 12px;
  color: var(--p-text-muted-color);
  border-bottom: 1px solid var(--p-content-border-color);
}

.hr__editor {
  width: 100%;
  height: 100%;
  min-height: 320px;
  border: none;
  outline: none;
  resize: none;
  padding: 8px 14px;
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre;
  overflow: auto;
  background: var(--p-content-background);
  color: var(--p-text-color);
}

.hr__chat {
  width: 340px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--p-content-border-color);
}

.hr__chat-head {
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
  border-bottom: 1px solid var(--p-content-border-color);
}

.hr__section {
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-content-hover-background);
  font-size: 12px;
}

.hr__section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--p-text-color);
}

.hr__section-head:hover {
  background: var(--hover-veil);
}

.hr__section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 10px;
}

.hr__section-field {
  width: 100%;
}

.hr__section-empty {
  padding: 0 12px 10px;
  font-size: 11.5px;
  color: var(--p-text-dim-color);
}

.hr__val-line {
  font-size: 12px;
  color: var(--p-text-secondary-color);
}

.hr__val-violation {
  font-size: 11.5px;
  color: var(--status-bad-strong);
  margin-top: 3px;
}

.hr__test-history {
  padding: 0 12px 6px;
}

.hr__test-history-label {
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin-bottom: 4px;
}

.hr__test-attempt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  cursor: pointer;
  font-size: 11.5px;
}

.hr__test-log {
  padding: 0 12px 10px;
  max-height: 140px;
  overflow-y: auto;
}

.hr__test-pre {
  font-size: 10.5px;
  font-family: 'Fira Code', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  color: var(--p-text-secondary-color);
}

.hr__chat-msgs {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.hr__chat-hint {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--p-text-dim-color);
}

.hr-msg {
  display: flex;
}

.hr-msg--user {
  justify-content: flex-end;
}

.hr-msg__bubble {
  max-width: 88%;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  white-space: pre-wrap;
}

.hr-msg--user .hr-msg__bubble {
  background: var(--p-agent-background);
  color: var(--p-primary-contrast-color);
}

.hr-msg--assistant .hr-msg__bubble {
  background: var(--p-content-hover-background);
  color: var(--p-text-secondary-color);
}

.hr__chat-input {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--p-content-border-color);
  flex: none;
}

.hr__chat-input-field {
  flex: 1;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--hover-veil);
}
</style>

<style>
.hr .p-dialog-content {
  display: flex;
  flex-direction: column;
  padding: 0;
  min-height: 0;
}
</style>
