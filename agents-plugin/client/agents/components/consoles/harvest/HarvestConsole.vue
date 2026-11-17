<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Select from 'primevue/select';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Dialog from 'primevue/dialog';
import Menu from 'primevue/menu';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import DatePicker from 'primevue/datepicker';

import agentApi from '../../../api/agentApi.js';
import { scope } from '../../../stores/scope.js';
import { fullDateTime } from '../../activity/format.js';
import { hasBlockedHarvest, runStatusLabel, runStatusStyle } from '../../activity/runStatus.js';

import AgentRunTimeline from './AgentRunTimeline.vue';
import HarvestReviewDialog from './HarvestReviewDialog.vue';
import HarvestOptionsDialog from './HarvestOptionsDialog.vue';
import HarvestMergeDialog from './HarvestMergeDialog.vue';
import RunHistoryDrawer from './RunHistoryDrawer.vue';
import MarkdownView from './MarkdownView.vue';
import HarvestToastHost from './HarvestToastHost.vue';
import { notify } from './notify.js';
import EsqueletoFichas from '../../common/EsqueletoFichas.vue';
import { changeTypeMeta, CHANGE_TYPE_META } from './changeTypeMeta.js';
import {
  canSplitMergedRun,
  filterCandidates,
  groupHarvestRunsByColumn,
  hasReviewProposal,
  isMergeableReviewRun,
  isMergedRun,
  launchedProductIds,
  mergeSourceCount,
  resolvedDispositions as resolvedDispositionsOf,
  riskParts,
  runChangeType,
  runProductNameParts,
  runSignature,
  suppressedSignatures as suppressedSignaturesOf,
} from './harvestBoard.js';

const props = defineProps({
  runs: { type: Array, default: () => [] },
  decidingRunId: { type: String, default: null },
  starting: { type: Boolean, default: false },
});

const emit = defineEmits(['launch', 'decide', 'refine', 'restore']);

const { t } = useI18n();

const lineId = computed(() => scope.lineId);
const selectedRunId = ref(null);
const dialogOpen = ref(false);
const reviewOpen = ref(false);

const sameLine = (run) => String(run.scope?.lineId ?? '') === String(lineId.value ?? '');
const byCreatedDesc = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

const harvestRuns = computed(() => props.runs.filter((r) => r.agentType === 'harvest' && sameLine(r)).sort(byCreatedDesc));
const minerRuns = computed(() => props.runs.filter((r) => r.agentType === 'variant-miner' && sameLine(r)).sort(byCreatedDesc));
const latestMiner = computed(() => minerRuns.value[0] ?? null);
const minerScanning = computed(() => ['queued', 'running'].includes(latestMiner.value?.status));

// El miner recoge en `errors` los productos cuya lectura en el host git fallo, pero
// su narracion solo habla de candidatos: sin esto, un token caducado se ve
// igual que "no hay divergencias".
const minerErrors = computed(() => {
  const paso = [...(latestMiner.value?.steps ?? [])].reverse().find((s) => s.name === 'detect-per-product');
  const errores = paso?.outputSummary?.errors;
  return Array.isArray(errores) ? errores : [];
});
const minerErrorNames = computed(() => minerErrors.value.map((e) => e?.name).filter(Boolean).join(', '));

const dispositions = ref([]);

const loadDispositions = async () => {
  if (!lineId.value) {
    dispositions.value = [];
    return;
  }
  try {
    dispositions.value = await agentApi.listDispositions({ lineId: lineId.value });
  } catch {
    dispositions.value = [];
  }
};

watch(lineId, loadDispositions, { immediate: true });

const suppressedSignatures = computed(() => suppressedSignaturesOf(dispositions.value));
const resolvedDispositions = computed(() => resolvedDispositionsOf(dispositions.value));

const filtersOpen = ref(false);
const filterTypes = ref([]);
const minCorroboration = ref(1);
const typeFilterOptions = computed(() => Object.entries(CHANGE_TYPE_META).map(([value]) => ({ value, label: changeTypeMeta(value).label })));
const corroborationOptions = computed(() => [
  { value: 1, label: t('labels.any') },
  { value: 2, label: t('labels.n_or_more_products', { n: 2 }) },
  { value: 3, label: t('labels.n_or_more_products', { n: 3 }) },
  { value: 5, label: t('labels.n_or_more_products', { n: 5 }) },
]);
const filtersActive = computed(() => filterTypes.value.length > 0 || minCorroboration.value > 1);
const clearFilters = () => {
  filterTypes.value = [];
  minCorroboration.value = 1;
};

const launchedIds = computed(() => launchedProductIds(harvestRuns.value));

const candidateCards = computed(() =>
  filterCandidates({
    candidates: latestMiner.value?.result?.candidates ?? [],
    launchedIds: launchedIds.value,
    suppressedSigs: suppressedSignatures.value,
    filterTypes: filterTypes.value,
    minCorroboration: minCorroboration.value,
  }),
);

const selectedCandidateSigs = reactive(new Set());
const toggleCandidateSelect = (c) => {
  if (selectedCandidateSigs.has(c.signature)) selectedCandidateSigs.delete(c.signature);
  else selectedCandidateSigs.add(c.signature);
};
const selectedCandidates = computed(() => candidateCards.value.filter((c) => selectedCandidateSigs.has(c.signature)));
const clearCandidateSelection = () => selectedCandidateSigs.clear();

const bulkActing = ref(false);
const defaultSnooze = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const bulkDispose = async (state) => {
  const items = [...selectedCandidates.value];
  if (!items.length || bulkActing.value) return;
  bulkActing.value = true;
  try {
    const extra = state === 'snoozed' ? { snoozeUntil: defaultSnooze() } : {};
    for (const c of items) {
      await applyDisposition(c, state, extra);
    }
    clearCandidateSelection();
  } finally {
    bulkActing.value = false;
  }
};
const bulkHarvestAsIs = () => {
  const items = [...selectedCandidates.value];
  for (const c of items) harvestAsIs(c);
  clearCandidateSelection();
};

const repChoice = reactive({});
const repProductId = (c) => repChoice[c.signature] ?? c.representativeProductId ?? null;
const repProductName = (c) => {
  const id = repProductId(c);
  const idx = (c.productIds ?? []).findIndex((p) => String(p) === String(id));
  return idx >= 0 ? c.products[idx] : c.representativeProductName;
};
const repOptions = (c) => (c.productIds ?? []).map((id, i) => ({ value: id, label: c.products?.[i] ?? String(id) }));

const previewCache = reactive({});
const loadPreview = async (productId) => {
  if (!productId || previewCache[productId]) return;
  previewCache[productId] = { loading: true, files: [], signals: null };
  try {
    const data = await agentApi.getHarvestPreview({ productId });
    previewCache[productId] = { loading: false, files: data.files ?? [], signals: data.signals ?? null };
  } catch {
    previewCache[productId] = { loading: false, files: [], signals: null, error: true };
  }
};

const columns = computed(() => groupHarvestRunsByColumn(harvestRuns.value));
const proposedRuns = computed(() => columns.value.proposed);
const reviewRuns = computed(() => columns.value.review);
const mergedRuns = computed(() => columns.value.merged);

const selectedRun = computed(() => props.runs.find((r) => r._id === selectedRunId.value) ?? null);

const fmtTime = fullDateTime;

const RISK_META = computed(() => ({
  high: { icon: 'pi pi-exclamation-triangle', color: 'var(--status-bad-solid)', label: t('labels.high_risk') },
  medium: { icon: 'pi pi-exclamation-circle', color: 'var(--status-warn-solid)', label: t('labels.risk') },
}));
const riskTooltip = (risk) => {
  const parts = riskParts(risk).map((p) =>
    p.kind === 'highTouch' ? `${t('labels.high_touch_files')}: ${p.files.join(', ')}` : t('labels.shares_files_with', { n: p.n }),
  );
  return parts.join(' · ') || t('labels.elevated_risk');
};

const runProductName = (run) => {
  const { productName, productId } = runProductNameParts(run);
  if (productName) return productName;
  if (productId) return t('labels.product_short_id_fallback', { id: String(productId).slice(-6) });
  return '—';
};

const scanPortfolio = () => {
  if (!lineId.value) return;
  emit('launch', { agentType: 'variant-miner', lineId: lineId.value, input: {} });
};

const launchHarvest = (c, steering) => {
  const productId = repProductId(c);
  if (!lineId.value || !productId) return;
  emit('launch', {
    agentType: 'harvest',
    lineId: lineId.value,
    productId,
    input: { steering: { ...steering, signature: c.signature } },
  });
};

const harvestAsIs = (c) => launchHarvest(c, { intent: 'as-is' });

const optionsOpen = ref(false);
const optionsCandidate = ref(null);
const openOptions = (c) => {
  optionsCandidate.value = c;
  optionsOpen.value = true;
};
const onOptionsLaunch = ({ steering }) => {
  if (optionsCandidate.value) launchHarvest(optionsCandidate.value, steering);
};

const applyDisposition = async (c, state, extra = {}) => {
  try {
    await agentApi.setDisposition({
      lineId: lineId.value,
      signature: c.signature,
      state,
      representativeProductId: repProductId(c),
      suggestedType: c.suggestedType,
      files: c.files,
      ...extra,
    });
    await loadDispositions();
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_save_disposition') });
  }
};

const restoreDisposition = async (d) => {
  try {
    await agentApi.deleteDisposition(d._id);
    await loadDispositions();
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_restore_candidate') });
  }
};

const action = reactive({ open: false, type: null, candidate: null, mrUrl: '', note: '', reason: '', snoozeUntil: null });
const openAction = (type, c) => {
  Object.assign(action, {
    open: true,
    type,
    candidate: c,
    mrUrl: '',
    note: '',
    reason: '',
    snoozeUntil: type === 'snooze' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
  });
};
const ACTION_META = computed(() => ({
  manual: { title: t('labels.mark_manually_harvested'), icon: 'pi pi-check-circle', color: 'var(--status-ok-solid)', confirm: t('labels.mark_harvested') },
  dismiss: { title: t('labels.dismiss_candidate'), icon: 'pi pi-ban', color: 'var(--status-bad-solid)', confirm: t('labels.dismiss') },
  snooze: { title: t('labels.snooze_candidate'), icon: 'pi pi-clock', color: 'var(--status-warn-solid)', confirm: t('labels.snooze') },
}));
const confirmAction = async () => {
  const c = action.candidate;
  if (!c) return;
  if (action.type === 'manual') {
    await applyDisposition(c, 'manually-harvested', { mrUrl: action.mrUrl.trim() || undefined, note: action.note.trim() || undefined });
  } else if (action.type === 'dismiss') {
    await applyDisposition(c, 'dismissed', { reason: action.reason.trim() || undefined });
  } else if (action.type === 'snooze') {
    const iso = action.snoozeUntil instanceof Date ? action.snoozeUntil.toISOString().slice(0, 10) : defaultSnooze();
    await applyDisposition(c, 'snoozed', { snoozeUntil: iso });
  }
  action.open = false;
};

const cardMenus = ref({});
const setCardMenuRef = (sig) => (el) => {
  if (el) cardMenus.value[sig] = el;
};
const toggleCardMenu = (event, c) => cardMenus.value[c.signature]?.toggle(event);
const cardMenuItems = (c) => [
  { label: t('labels.harvest_as_is'), icon: 'pi pi-bolt', disabled: !repProductId(c), command: () => harvestAsIs(c) },
  { label: t('labels.history'), icon: 'pi pi-history', command: () => openHistory(c.signature, repProductName(c)) },
  { separator: true },
  { label: t('labels.mark_manually_harvested'), icon: 'pi pi-check-circle', command: () => openAction('manual', c) },
  { label: t('labels.dismiss'), icon: 'pi pi-ban', command: () => openAction('dismiss', c) },
  { label: t('labels.snooze'), icon: 'pi pi-clock', command: () => openAction('snooze', c) },
];

const selectedReviewIds = reactive(new Set());
const toggleReviewSelect = (run) => {
  if (selectedReviewIds.has(run._id)) selectedReviewIds.delete(run._id);
  else selectedReviewIds.add(run._id);
};
const selectedReviewRuns = computed(() => reviewRuns.value.filter((r) => isMergeableReviewRun(r) && selectedReviewIds.has(r._id)));

const mergeOpen = ref(false);
const openMerge = () => {
  if (selectedReviewRuns.value.length >= 2) mergeOpen.value = true;
};
const onMerge = async ({ runIds, directive }) => {
  try {
    await agentApi.mergeProposals({ lineId: lineId.value, runIds, directive });
    selectedReviewIds.clear();
    notify({ type: 'positive', message: t('labels.merging_proposals') });
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_merge_proposals') });
  }
};

const splittingId = ref(null);
const splitMerged = async (run) => {
  splittingId.value = run._id;
  try {
    await agentApi.splitProposal(run._id);
    notify({ type: 'positive', message: t('labels.split_back_to_proposals') });
  } catch {
    notify({ type: 'negative', message: t('labels.could_not_split_merge') });
  } finally {
    splittingId.value = null;
  }
};

const openRun = (run) => {
  selectedRunId.value = run._id;
  if (hasReviewProposal(run)) reviewOpen.value = true;
  else dialogOpen.value = true;
};
const openMiner = () => {
  if (latestMiner.value) {
    selectedRunId.value = latestMiner.value._id;
    dialogOpen.value = true;
  }
};

const historyOpen = ref(false);
const historySignature = ref(null);
const historyName = ref('');
const historyRuns = computed(() => (historySignature.value ? harvestRuns.value.filter((r) => runSignature(r) === historySignature.value) : []));
const historyDispositions = computed(() => (historySignature.value ? dispositions.value.filter((d) => d.signature === historySignature.value) : []));
const openHistory = (signature, name) => {
  historySignature.value = signature;
  historyName.value = name ?? '';
  historyOpen.value = true;
};

const onDecide = (payload) => emit('decide', { runId: selectedRun.value?._id, ...payload });
const onRefine = (message) => emit('refine', { runId: selectedRun.value?._id, message });
const onRestore = ({ versionIndex }) => emit('restore', { runId: selectedRun.value?._id, versionIndex });

const runLabel = (run) => (hasBlockedHarvest(run) ? t('labels.harvest_status_blocked') : runStatusLabel(run));

const runColumns = computed(() => [
  { key: 'proposed', title: t('labels.kanban_proposed'), icon: 'pi pi-hourglass', hint: t('labels.kanban_proposed_hint'), runs: proposedRuns.value },
  { key: 'review', title: t('labels.kanban_in_review'), icon: 'pi pi-comment', hint: t('labels.kanban_in_review_hint'), runs: reviewRuns.value },
  { key: 'merged', title: t('labels.kanban_merged'), icon: 'pi pi-share-alt', hint: t('labels.kanban_merged_hint'), runs: mergedRuns.value },
]);
</script>

<template>
  <div class="harvest-board">
    <HarvestToastHost />

    <div class="harvest-board__controls">
      <Button
        icon="pi pi-compass"
        :label="t('labels.scan_portfolio')"
        :loading="starting || minerScanning"
        :disabled="!lineId"
        :title="t('labels.scan_portfolio_tooltip')"
        @click="scanPortfolio"
      />
      <Button
        v-if="latestMiner"
        text
        size="small"
        icon="pi pi-comment"
        :label="t('labels.miner_thinking')"
        @click="openMiner"
      />
      <div class="harvest-board__spacer"></div>
      <div v-if="latestMiner" class="harvest-board__last-scan">{{ t('labels.last_scan') }}: {{ fmtTime(latestMiner.createdAt) }}</div>
    </div>

    <div class="board">
      <div class="board__col">
        <div class="board__col-head" :title="t('labels.kanban_candidate_hint')">
          <i class="pi pi-lightbulb" aria-hidden="true"></i>
          <span class="board__col-title">{{ t('labels.kanban_candidate') }}</span>
          <span class="board__col-badge">{{ candidateCards.length }}</span>
        </div>
        <div class="board__col-body">
          <div v-if="latestMiner" class="cand-controls">
            <div class="cand-controls__row">
              <button type="button" class="link-btn" :class="{ 'link-btn--on': filtersActive }" @click="filtersOpen = !filtersOpen">
                <i class="pi pi-filter" aria-hidden="true"></i> {{ filtersActive ? t('labels.filtered') : t('labels.filter') }}
              </button>
              <div class="harvest-board__spacer"></div>
              <button v-if="filtersActive" type="button" class="icon-btn" :title="t('labels.clear_filters')" @click="clearFilters">
                <i class="pi pi-filter-slash" aria-hidden="true"></i>
              </button>
            </div>
            <div v-if="filtersOpen" class="cand-controls__panel">
              <Select
                v-model="filterTypes"
                :options="typeFilterOptions"
                option-label="label"
                option-value="value"
                multiple
                :placeholder="t('labels.change_type')"
                class="cand-controls__select"
              />
              <Select
                v-model="minCorroboration"
                :options="corroborationOptions"
                option-label="label"
                option-value="value"
                :placeholder="t('labels.corroboration')"
                class="cand-controls__select"
              />
            </div>
          </div>

          <div v-if="selectedCandidates.length" class="merge-bar">
            <i class="pi pi-check-square" aria-hidden="true"></i>
            <span class="merge-bar__label">{{ t('labels.n_selected', { n: selectedCandidates.length }) }}</span>
            <div class="harvest-board__spacer"></div>
            <button type="button" class="icon-btn icon-btn--accent" :disabled="bulkActing" :title="t('labels.harvest_as_is')" @click="bulkHarvestAsIs">
              <i class="pi pi-bolt" aria-hidden="true"></i>
            </button>
            <button type="button" class="icon-btn" :disabled="bulkActing" :title="t('labels.snooze_7_days')" @click="bulkDispose('snoozed')">
              <i class="pi pi-clock" aria-hidden="true"></i>
            </button>
            <button type="button" class="icon-btn icon-btn--bad" :disabled="bulkActing" :title="t('labels.dismiss')" @click="bulkDispose('dismissed')">
              <i class="pi pi-ban" aria-hidden="true"></i>
            </button>
            <button type="button" class="icon-btn" :title="t('labels.clear_selection')" @click="clearCandidateSelection">
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>

          <p v-if="!minerScanning && minerErrors.length" class="board__aviso" role="alert">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            {{ t('labels.miner_products_unreadable', { n: minerErrors.length, products: minerErrorNames }) }}
          </p>

          <div v-if="minerScanning" class="board__escaneando">
            <p class="board__escaneando-rotulo"><i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.scanning_short') }}</p>
            <EsqueletoFichas :fichas="2" />
          </div>
          <div v-else-if="!latestMiner" class="board__empty">{{ t('labels.run_scan_portfolio_to_mine') }}</div>
          <div v-else-if="!candidateCards.length" class="board__empty">{{ filtersActive ? t('labels.no_candidates_match_filters') : t('labels.no_open_candidates') }}</div>

          <div v-for="c in candidateCards" :key="c.signature" class="card" :class="{ 'card--selected': selectedCandidateSigs.has(c.signature) }">
            <div class="card__row">
              <Checkbox
                :model-value="selectedCandidateSigs.has(c.signature)"
                binary
                :title="t('labels.select_bulk_triage')"
                @update:model-value="toggleCandidateSelect(c)"
              />
              <span class="chip" :style="{ color: changeTypeMeta(c.suggestedType).color, borderColor: changeTypeMeta(c.suggestedType).color }">
                <i :class="changeTypeMeta(c.suggestedType).icon" aria-hidden="true"></i> {{ changeTypeMeta(c.suggestedType).label }}
              </span>
              <span class="chip" :class="c.corroborated ? 'chip--ok' : 'chip--neutral'">
                <i class="pi pi-users" aria-hidden="true"></i> {{ c.productCount }}/{{ c.totalProducts }}
              </span>
              <span
                v-if="RISK_META[c.risk?.level]"
                class="chip"
                :style="{ color: RISK_META[c.risk.level].color, borderColor: RISK_META[c.risk.level].color }"
                :title="riskTooltip(c.risk)"
              >
                <i :class="RISK_META[c.risk.level].icon" aria-hidden="true"></i> {{ RISK_META[c.risk.level].label }}
              </span>
              <div class="harvest-board__spacer"></div>
              <button type="button" class="icon-btn" @click="toggleCardMenu($event, c)">
                <i class="pi pi-ellipsis-v" aria-hidden="true"></i>
              </button>
              <Menu :ref="setCardMenuRef(c.signature)" :model="cardMenuItems(c)" popup />
            </div>

            <div class="card__files">
              <i class="pi pi-file" aria-hidden="true"></i>
              <span v-for="(f, i) in c.files.slice(0, 3)" :key="f">
                <code>{{ f }}</code><span v-if="i < Math.min(c.files.length, 3) - 1">, </span>
              </span>
              <span v-if="c.files.length > 3" class="card__more"> +{{ c.files.length - 3 }}</span>
            </div>
            <div class="card__products"><i class="pi pi-box" aria-hidden="true"></i>{{ c.products.join(', ') }}</div>

            <Accordion class="card__expand" @tab-open="loadPreview(repProductId(c))">
              <AccordionPanel value="0">
                <AccordionHeader>{{ t('labels.details') }}</AccordionHeader>
                <AccordionContent>
                  <div class="card__detail-label">{{ t('labels.files_count', { n: c.files.length }) }}</div>
                  <ul class="card__file-list">
                    <li v-for="f in c.files" :key="f"><code>{{ f }}</code></li>
                  </ul>

                  <div class="card__detail-label">{{ t('labels.representative_product') }}</div>
                  <div class="card__rep-options">
                    <label v-for="opt in repOptions(c)" :key="opt.value" class="card__rep-option">
                      <RadioButton
                        :model-value="repProductId(c)"
                        :value="opt.value"
                        size="small"
                        @update:model-value="(v) => { repChoice[c.signature] = v; loadPreview(v); }"
                      />
                      {{ opt.label }}
                    </label>
                  </div>

                  <div class="card__detail-label">{{ t('labels.diff_preview_for', { name: repProductName(c) }) }}</div>
                  <div v-if="previewCache[repProductId(c)]?.loading" class="card__diff-status">
                    <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> {{ t('labels.loading_diff') }}
                  </div>
                  <div v-else-if="previewCache[repProductId(c)]?.error" class="card__diff-status card__diff-status--bad">
                    {{ t('labels.could_not_load_diff_preview') }}
                  </div>
                  <template v-else-if="previewCache[repProductId(c)]">
                    <div v-for="pf in previewCache[repProductId(c)].files" :key="pf.path" class="card__diff">
                      <div class="card__diff-head"><code>{{ pf.path }}</code></div>
                      <pre class="card__diff-body">{{ pf.diff }}</pre>
                    </div>
                    <div v-if="!previewCache[repProductId(c)].files.length" class="card__diff-status">{{ t('labels.no_file_diffs') }}</div>
                  </template>
                </AccordionContent>
              </AccordionPanel>
            </Accordion>

            <Button
              class="card__harvest-btn"
              icon="pi pi-upload"
              :label="t('labels.harvest_arrow')"
              size="small"
              :disabled="!repProductId(c) || starting"
              :title="t('labels.set_harvest_options_for', { name: repProductName(c) || t('labels.the_representative_product') })"
              @click="openOptions(c)"
            />
          </div>

          <Accordion v-if="resolvedDispositions.length" class="resolved">
            <AccordionPanel value="0">
              <AccordionHeader>{{ t('labels.resolved_dismissed_count', { n: resolvedDispositions.length }) }}</AccordionHeader>
              <AccordionContent>
                <div v-for="d in resolvedDispositions" :key="d._id" class="card card--resolved">
                  <div class="card__row">
                    <span
                      class="chip"
                      :class="d.state === 'manually-harvested' ? 'chip--ok' : d.state === 'snoozed' ? 'chip--warn' : 'chip--neutral'"
                    >
                      <i :class="d.state === 'manually-harvested' ? 'pi pi-check-circle' : d.state === 'snoozed' ? 'pi pi-clock' : 'pi pi-ban'" aria-hidden="true"></i>
                      {{ d.state === 'manually-harvested' ? t('labels.manually_harvested') : d.state === 'snoozed' ? t('labels.snoozed_state') : t('labels.dismissed_state') }}
                    </span>
                    <div class="harvest-board__spacer"></div>
                    <button type="button" class="icon-btn" :title="t('labels.view_history')" @click="openHistory(d.signature)">
                      <i class="pi pi-history" aria-hidden="true"></i>
                    </button>
                    <button type="button" class="icon-btn icon-btn--accent" :title="t('labels.restore_to_candidates')" @click="restoreDisposition(d)">
                      <i class="pi pi-refresh" aria-hidden="true"></i>
                    </button>
                  </div>
                  <div v-if="d.suggestedType" class="card__meta-line">
                    <i :class="changeTypeMeta(d.suggestedType).icon" aria-hidden="true"></i> {{ changeTypeMeta(d.suggestedType).label }}
                  </div>
                  <div v-if="(d.files ?? []).length" class="card__files">
                    <span v-for="(f, i) in d.files.slice(0, 3)" :key="f"><code>{{ f }}</code><span v-if="i < Math.min(d.files.length, 3) - 1">, </span></span>
                    <span v-if="d.files.length > 3" class="card__more"> +{{ d.files.length - 3 }}</span>
                  </div>
                  <div v-if="d.reason" class="card__meta-line card__meta-line--quote">"{{ d.reason }}"</div>
                  <div v-if="d.note" class="card__meta-line">{{ d.note }}</div>
                  <div v-if="d.state === 'snoozed' && d.snoozeUntil" class="card__meta-line">{{ t('labels.until_label', { date: fmtTime(d.snoozeUntil) }) }}</div>
                  <a v-if="d.mrUrl" :href="d.mrUrl" target="_blank" rel="noopener noreferrer" class="card__mr-link">{{ t('labels.open_mr_arrow') }}</a>
                </div>
              </AccordionContent>
            </AccordionPanel>
          </Accordion>
        </div>
      </div>

      <div v-for="col in runColumns" :key="col.key" class="board__col">
        <div class="board__col-head" :title="col.hint">
          <i :class="col.icon" aria-hidden="true"></i>
          <span class="board__col-title">{{ col.title }}</span>
          <span class="board__col-badge">{{ col.runs.length }}</span>
        </div>
        <div class="board__col-body">
          <div v-if="col.key === 'review' && selectedReviewRuns.length >= 2" class="merge-bar">
            <i class="pi pi-share-alt" aria-hidden="true"></i>
            <span class="merge-bar__label">{{ t('labels.n_selected', { n: selectedReviewRuns.length }) }}</span>
            <div class="harvest-board__spacer"></div>
            <Button size="small" icon="pi pi-share-alt" :label="t('labels.merge')" @click="openMerge" />
            <button type="button" class="icon-btn" :title="t('labels.clear_selection')" @click="selectedReviewIds.clear()">
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>

          <div v-if="!col.runs.length" class="board__empty">{{ t('labels.board_column_empty') }}</div>
          <div
            v-for="run in col.runs"
            :key="run._id"
            class="card card--click"
            :class="{ 'card--active': run._id === selectedRunId, 'card--selected': selectedReviewIds.has(run._id) }"
            @click="openRun(run)"
          >
            <div class="card__row">
              <Checkbox
                v-if="col.key === 'review' && isMergeableReviewRun(run)"
                :model-value="selectedReviewIds.has(run._id)"
                binary
                :title="t('labels.select_to_merge')"
                @update:model-value="toggleReviewSelect(run)"
                @click.stop
              />
              <span class="card__title">{{ runProductName(run) }}</span>
              <div class="harvest-board__spacer"></div>
              <span class="card__status" :style="{ color: runStatusStyle(run).fg }">
                <span class="card__status-dot" :style="{ background: runStatusStyle(run).dot }" aria-hidden="true"></span>
                {{ runLabel(run) }}
              </span>
            </div>

            <div v-if="isMergedRun(run)" class="card__row">
              <span class="chip chip--accent"><i class="pi pi-share-alt" aria-hidden="true"></i> {{ t('labels.merged_from', { n: mergeSourceCount(run) }) }}</span>
              <Button
                v-if="canSplitMergedRun(run)"
                text
                size="small"
                icon="pi pi-sitemap"
                :label="t('labels.split')"
                :loading="splittingId === run._id"
                :title="t('labels.restore_original_proposals')"
                @click.stop="splitMerged(run)"
              />
            </div>

            <div class="card__row">
              <span v-if="runChangeType(run)" class="chip" :style="{ color: changeTypeMeta(runChangeType(run)).color, borderColor: changeTypeMeta(runChangeType(run)).color }">
                <i :class="changeTypeMeta(runChangeType(run)).icon" aria-hidden="true"></i> {{ changeTypeMeta(runChangeType(run)).label }}
              </span>
              <i v-if="['queued', 'running'].includes(run.status)" class="pi pi-spin pi-spinner" aria-hidden="true"></i>
              <a v-if="run.result?.mrUrl" :href="run.result.mrUrl" target="_blank" rel="noopener noreferrer" class="icon-btn" :title="t('labels.open_merge_request')" @click.stop>
                <i class="pi pi-external-link" aria-hidden="true"></i>
              </a>
            </div>
            <div class="card__time">{{ fmtTime(run.createdAt) }}</div>
          </div>
        </div>
      </div>
    </div>

    <Dialog v-model:visible="dialogOpen" modal class="run-dialog" :header="selectedRun ? (selectedRun.agentType === 'variant-miner' ? t('labels.variant_divergence_miner') : runProductName(selectedRun)) : t('labels.run_detail')">
      <template v-if="selectedRun">
        <MarkdownView v-if="selectedRun.agentType === 'variant-miner' && selectedRun.result?.markdown" :text="selectedRun.result.markdown" class="run-dialog__markdown" />
        <AgentRunTimeline :run="selectedRun" :busy="decidingRunId === selectedRun._id" @decide="onDecide" @refine="onRefine" @restore="onRestore" />
      </template>
    </Dialog>

    <HarvestReviewDialog v-model="reviewOpen" :run="selectedRun" :busy="decidingRunId === selectedRun?._id" @refine="onRefine" @restore="onRestore" @decide="onDecide" />

    <HarvestOptionsDialog v-model="optionsOpen" :line-id="lineId" :candidate="optionsCandidate" @launch="onOptionsLaunch" />

    <HarvestMergeDialog v-model="mergeOpen" :line-id="lineId" :runs="selectedReviewRuns" @launch="onMerge" />

    <RunHistoryDrawer
      v-model="historyOpen"
      :title="t('labels.candidate_history')"
      :subtitle="historyName"
      :runs="historyRuns"
      :dispositions="historyDispositions"
      :label-for="runProductName"
      @open-run="openRun"
    />

    <Dialog v-model:visible="action.open" modal class="action-dialog">
      <template #header>
        <i :class="ACTION_META[action.type]?.icon" :style="{ color: ACTION_META[action.type]?.color }" aria-hidden="true"></i>
        <span>{{ ACTION_META[action.type]?.title }}</span>
      </template>
      <template v-if="action.type === 'manual'">
        <label class="action-dialog__label" for="ad-mr">{{ t('labels.mr_url_optional') }}</label>
        <InputText id="ad-mr" v-model="action.mrUrl" class="action-dialog__field" />
        <label class="action-dialog__label" for="ad-note">{{ t('labels.note_optional') }}</label>
        <Textarea id="ad-note" v-model="action.note" auto-resize rows="2" class="action-dialog__field" />
      </template>
      <template v-else-if="action.type === 'dismiss'">
        <label class="action-dialog__label" for="ad-reason">{{ t('labels.reason_optional') }}</label>
        <Textarea id="ad-reason" v-model="action.reason" auto-resize rows="2" class="action-dialog__field" />
      </template>
      <template v-else-if="action.type === 'snooze'">
        <label class="action-dialog__label" for="ad-snooze">{{ t('labels.snooze_until') }}</label>
        <DatePicker id="ad-snooze" v-model="action.snoozeUntil" date-format="yy-mm-dd" show-icon size="small" class="action-dialog__field" />
      </template>
      <template #footer>
        <Button :label="t('labels.cancel')" text size="small" @click="action.open = false" />
        <Button :label="ACTION_META[action.type]?.confirm" size="small" @click="confirmAction" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.harvest-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 18px 20px 20px;
}

.harvest-board__spacer {
  flex: 1;
}

.harvest-board__controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.harvest-board__last-scan {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.board {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  overflow-x: auto;
}

.board__col {
  display: flex;
  flex-direction: column;
  min-width: 260px;
  flex: 1 1 0;
  min-height: 0;
}

.board__col-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 4px 10px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--p-text-dim-color);
  border-bottom: 1px solid var(--p-content-border-color);
  margin-bottom: 8px;
}

.board__col-badge {
  padding: 0 6px;
  border-radius: 20px;
  background: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
  font-size: 10.5px;
}

.board__col-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px;
}

.board__aviso {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 10px;
  padding: 9px 11px;
  font-size: 11.5px;
  color: var(--status-warn-solid);
  background: var(--status-warn-soft);
  border: 1px solid var(--status-warn-border);
  border-radius: 5px;
}

.board__escaneando {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.board__escaneando-rotulo {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.board__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--p-text-dim-color);
  font-size: 12px;
  padding: 8px 4px;
}

.card {
  padding: 10px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
  background: var(--p-content-background);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card--click {
  cursor: pointer;
}

.card--click:hover {
  background: var(--p-content-hover-background);
}

.card--active {
  outline: 2px solid var(--p-agent-color);
  outline-offset: -1px;
}

.card--selected {
  outline: 2px solid var(--p-agent-color);
  outline-offset: -1px;
}

.card--resolved {
  opacity: 0.92;
}

.card__row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  flex: none;
}

.card__status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}

.card__files {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.card__files i {
  color: var(--p-text-dim-color);
}

.card__more {
  color: var(--p-text-dim-color);
}

.card__products {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  display: flex;
  align-items: center;
  gap: 5px;
}

.card__products i {
  color: var(--p-text-dim-color);
}

.card__meta-line {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  display: flex;
  align-items: center;
  gap: 5px;
}

.card__meta-line--quote {
  font-style: italic;
}

.card__mr-link {
  font-size: 11.5px;
  color: var(--p-agent-color);
}

.card__time {
  font-size: 11px;
  color: var(--p-text-dim-color);
}

.card__harvest-btn {
  width: 100%;
  justify-content: center;
}

.card__expand :deep(.p-accordionheader) {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  padding: 4px 0;
  background: transparent;
  border: none;
}

.card__expand :deep(.p-accordioncontent-content) {
  padding: 6px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card__detail-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-dim-color);
  margin-top: 6px;
}

.card__file-list {
  margin: 2px 0 0;
  padding-left: 16px;
  max-height: 120px;
  overflow-y: auto;
  font-size: 11.5px;
  color: var(--p-text-secondary-color);
}

.card__rep-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card__rep-option {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
}

.card__diff-status {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  display: flex;
  align-items: center;
  gap: 6px;
}

.card__diff-status--bad {
  color: var(--status-bad-strong);
}

.card__diff {
  border: 1px solid var(--p-content-border-color);
  border-radius: 5px;
  overflow: hidden;
}

.card__diff-head {
  padding: 3px 7px;
  background: var(--p-content-hover-background);
  font-size: 11px;
}

.card__diff-body {
  margin: 0;
  padding: 5px 7px;
  max-height: 160px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre;
  font-family: 'Fira Code', 'Courier New', monospace;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 20px;
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.chip--ok {
  border-color: var(--status-ok-solid);
  color: var(--status-ok-solid);
}

.chip--warn {
  border-color: var(--status-warn-solid);
  color: var(--status-warn-solid);
}

.chip--neutral {
  border-color: var(--p-text-faint-color);
  color: var(--p-text-muted-color);
}

.chip--accent {
  border-color: var(--p-agent-color);
  color: var(--p-agent-color);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  flex: none;
}

.icon-btn:hover {
  background: var(--hover-veil);
}

.icon-btn--accent {
  color: var(--p-agent-color);
}

.icon-btn--bad {
  color: var(--status-bad-solid);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-text-muted-color);
  font-size: 11.5px;
  cursor: pointer;
}

.link-btn--on {
  color: var(--p-agent-color);
  background: var(--p-agent-highlight-soft);
}

.cand-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cand-controls__row {
  display: flex;
  align-items: center;
}

.cand-controls__panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 6px;
}

.cand-controls__select {
  width: 100%;
}

.merge-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--p-agent-highlight-soft);
  border: 1px solid var(--p-agent-highlight);
  color: var(--p-text-color);
  font-size: 11.5px;
}

.merge-bar__label {
  font-weight: 600;
}

.run-dialog__markdown {
  margin-bottom: 16px;
}

.action-dialog__label {
  display: block;
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin: 10px 0 4px;
}

.action-dialog__field {
  width: 100%;
}

.resolved {
  margin-top: 6px;
}

.resolved :deep(.p-accordionheader) {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.resolved :deep(.p-accordioncontent-content) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
}
</style>

<style>
.p-dialog.run-dialog {
  width: 760px;
  max-width: 96vw;
}

.p-dialog.action-dialog {
  width: 420px;
  max-width: 92vw;
}

.action-dialog .p-dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
