<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Timeline from 'primevue/timeline';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import Button from 'primevue/button';

import agentApi from '../../../api/agentApi.js';
import ProposalCard from '../../activity/ProposalCard.vue';
import RelevantMemories from '../../activity/RelevantMemories.vue';
import { pendingProposal, describeProposal, pauseReasonMeta } from '../../activity/proposalSummary.js';

import MarkdownView from './MarkdownView.vue';
import HarvestReviewDialog from './HarvestReviewDialog.vue';
import HarvestLaunchDialog from './HarvestLaunchDialog.vue';
import { notify } from './notify.js';

const props = defineProps({
  run: { type: Object, required: true },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['decide', 'refine', 'restore']);

const { t } = useI18n();

const reviewOpen = ref(false);

const rechecking = ref(false);
const recheckOutcome = ref(null);
const localHasConflicts = ref(null);
watch(() => props.run._id, () => { localHasConflicts.value = null; recheckOutcome.value = null; });

const stillConflicting = computed(() => {
  if (localHasConflicts.value !== null) return localHasConflicts.value;
  return props.run.result?.hasConflicts === true;
});

const recheckConflicts = async () => {
  rechecking.value = true;
  recheckOutcome.value = null;
  try {
    const { hasConflicts } = await agentApi.recheckConflict(props.run._id);
    if (hasConflicts === false) {
      localHasConflicts.value = false;
      recheckOutcome.value = 'clear';
    } else if (hasConflicts === true) {
      localHasConflicts.value = true;
      recheckOutcome.value = 'conflicting';
    } else {
      recheckOutcome.value = 'not_found';
    }
  } catch {
    recheckOutcome.value = null;
  } finally {
    rechecking.value = false;
  }
};

const showHarvestPointer = computed(() => props.run.agentType === 'sync' && props.run.result?.stage === 'update');
const harvestDialogOpen = ref(false);
const harvesting = ref(false);

const launchHarvest = async (input = {}) => {
  const productId = props.run.scope?.productId;
  if (!productId) return;
  harvesting.value = true;
  try {
    await agentApi.createRun({
      agentType: 'harvest',
      scope: { productId, lineId: props.run.scope?.lineId },
      input,
    });
    notify({ type: 'positive', message: t('labels.harvest_agent_started') });
  } catch (error) {
    notify({ type: 'negative', message: error.response?.data?.error ? t(error.response.data.error) : error.message });
  } finally {
    harvesting.value = false;
  }
};

const stepState = (step) => {
  if (step.status === 'done') return 'done';
  if (step.status === 'running') return 'run';
  if (step.status === 'failed') return 'fail';
  if (step.status === 'pending' && step.kind === 'approval') return 'wait';
  return 'todo';
};

const steps = computed(() => props.run.steps ?? []);

const pendingProposals = computed(() => (props.run.proposals ?? []).filter((p) => !p.decision));

const reviewProposal = computed(() =>
  pendingProposals.value.find(
    (p) =>
      (p.kind === 'fm_patch' && (p.body?.fileEdits?.length || p.body?.newModelUvl)) ||
      (p.kind === 'merge_resolution' && p.body?.fileEdits?.length),
  ),
);
const isResolution = computed(() => reviewProposal.value?.kind === 'merge_resolution');
const otherProposals = computed(() => pendingProposals.value.filter((p) => p !== reviewProposal.value));

const reviewDescription = computed(() => {
  const n = reviewProposal.value?.body?.fileEdits?.length || 0;
  const hint = isResolution.value ? t('labels.review_diffs_commit_hint') : t('labels.review_diffs_accept_hint');
  return reviewProposal.value?.body?.newModelUvl
    ? t('labels.file_changes_with_fm', { n, hint })
    : t('labels.file_changes_only', { n, hint });
});

const onRefine = (message) => emit('refine', { runId: props.run._id, message });
const onRestore = ({ versionIndex }) => emit('restore', { runId: props.run._id, versionIndex });
const onDecide = (payload) => {
  reviewOpen.value = false;
  emit('decide', { runId: props.run._id, ...payload });
};

const pending = computed(() => pendingProposal(props.run));
const pauseMeta = computed(() => pauseReasonMeta(pending.value?.pauseReason));
const proposalSummaryText = computed(() => describeProposal(pending.value));

const fmtDuration = (ms) => {
  if (!ms || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

const resultMarkdown = computed(() => {
  const r = props.run.result;
  return r && typeof r === 'object' && typeof r.markdown === 'string' ? r.markdown : null;
});

const resultScalars = computed(() => {
  const r = props.run.result;
  if (!r || typeof r !== 'object') return [];
  return Object.entries(r).filter(([k, v]) => k !== 'markdown' && v !== null && typeof v !== 'object');
});

const MARKDOWN_KEYS = ['markdown', 'plan'];

const stepMarkdown = (step) => {
  if (!step.outputSummary || typeof step.outputSummary !== 'object') return null;
  for (const key of MARKDOWN_KEYS) {
    if (typeof step.outputSummary[key] === 'string') return step.outputSummary[key];
  }
  return null;
};

const isUrl = (value) => typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));

const stepSubtitle = (step) => {
  if (step.status === 'running') return t('labels.running_lc');
  if (step.error) return step.error;
  if (step.outputSummary && typeof step.outputSummary === 'object') {
    return Object.entries(step.outputSummary)
      .filter(([k, v]) => !MARKDOWN_KEYS.includes(k) && typeof v !== 'object')
      .map(([k, v]) => `${k}: ${v}`)
      .join('  ·  ');
  }
  return '';
};

const loopTurns = (step) => (step.loop?.turns ?? []).filter((t) => (t.toolCalls?.length ?? 0) > 0);
const loopTurnCount = (step) => step.loop?.turn ?? 0;
const toolCallLabel = (call) => {
  const input = call.input ?? {};
  const hint = input.path ?? input.branch ?? Object.values(input).find((v) => typeof v === 'string');
  return hint ? `${call.name} → ${hint}` : call.name;
};

const timelineItems = computed(() => steps.value.map((step) => ({ step, state: stepState(step) })));
</script>

<template>
  <div class="art">
    <div v-if="showHarvestPointer" class="art__banner">
      <i class="pi pi-sitemap" aria-hidden="true"></i>
      <span class="art__banner-text">
        {{ t('labels.sync_harvest_pointer') }}
      </span>
      <Button
        :label="t('labels.launch_harvest')"
        icon="pi pi-upload"
        text
        size="small"
        :loading="harvesting"
        @click="harvestDialogOpen = true"
      />
    </div>

    <Timeline :value="timelineItems" align="left" class="art__pasos">
      <template #marker="{ item }">
        <span class="paso-marca" :class="`paso-marca--${item.state}`" aria-hidden="true">
          <svg v-if="item.state === 'done'" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"></path></svg>
          <svg v-else-if="item.state === 'fail'" width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg>
          <svg v-else-if="item.state === 'wait'" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.2 2"></path></svg>
          <span v-else-if="item.state === 'run'" class="paso-marca__pulso" aria-hidden="true"></span>
        </span>
      </template>
      <template #content="{ item }">
        <div class="paso" :class="{ 'paso--fail': item.state === 'fail' }">
          <div class="paso__cabecera">
            <span class="paso__titulo">{{ item.step.name }}</span>
            <span v-if="fmtDuration(item.step.durationMs) && item.step.status !== 'running'" class="paso__duracion ident">
              {{ fmtDuration(item.step.durationMs) }}
            </span>
          </div>
          <MarkdownView v-if="stepMarkdown(item.step)" :text="stepMarkdown(item.step)" class="paso__markdown" />
          <p v-else-if="stepSubtitle(item.step)" class="paso__detalle">{{ stepSubtitle(item.step) }}</p>

          <Accordion v-if="loopTurns(item.step).length" class="paso__loop">
            <AccordionPanel value="0">
              <AccordionHeader>{{ t('labels.investigation_turns', { n: loopTurnCount(item.step) }) }}</AccordionHeader>
              <AccordionContent>
                <template v-for="turn in loopTurns(item.step)" :key="turn.index">
                  <div v-for="(call, i) in turn.toolCalls" :key="`${turn.index}-${i}`" class="paso__loop-call">
                    <i :class="call.status === 'failed' ? 'pi pi-times-circle' : 'pi pi-bolt'" :style="{ color: call.status === 'failed' ? 'var(--status-bad-solid)' : 'var(--p-text-dim-color)' }" aria-hidden="true"></i>
                    <span class="paso__loop-name">{{ toolCallLabel(call) }}</span>
                    <span v-if="call.durationMs" class="paso__loop-dur ident">{{ fmtDuration(call.durationMs) }}</span>
                  </div>
                </template>
              </AccordionContent>
            </AccordionPanel>
          </Accordion>
        </div>
      </template>
    </Timeline>

    <div v-if="pending" class="art__decision">
      <div v-if="pauseMeta || proposalSummaryText" class="art__decision-head">
        <span v-if="pauseMeta" class="art__pausa-chip" :style="{ color: pauseMeta.color, borderColor: pauseMeta.color }">
          <i :class="pauseMeta.icon" aria-hidden="true"></i> {{ pauseMeta.label }}
        </span>
        <span v-if="proposalSummaryText" class="art__resumen">{{ proposalSummaryText }}</span>
      </div>
      <RelevantMemories
        :line-id="run.scope?.lineId ? String(run.scope.lineId) : null"
        :product-id="run.scope?.productId ? String(run.scope.productId) : null"
        :query="proposalSummaryText"
      />
    </div>

    <div v-if="otherProposals.length" class="art__proposals">
      <ProposalCard
        v-for="proposal in otherProposals"
        :key="proposal._id"
        :proposal="proposal"
        :busy="busy"
        @approve="onDecide({ proposalId: proposal._id, decision: 'approved' })"
        @reject="onDecide({ proposalId: proposal._id, decision: 'rejected' })"
      />
    </div>

    <div v-if="reviewProposal" class="art__review-card">
      <div class="art__review-head">
        <i :class="isResolution ? 'pi pi-sitemap' : 'pi pi-arrow-up-right'" aria-hidden="true"></i>
        <span class="art__review-title">{{ reviewProposal.body?.title || (isResolution ? t('labels.conflict_resolution_title') : t('labels.harvest_proposal_title')) }}</span>
        <span class="art__review-badge">{{ isResolution ? t('labels.product_scope_badge') : t('labels.line_scope_badge') }}</span>
      </div>
      <p class="art__review-desc">{{ reviewDescription }}</p>
      <Button :label="t('labels.review_changes')" icon="pi pi-eye" text size="small" @click="reviewOpen = true" />
    </div>

    <HarvestReviewDialog
      v-model="reviewOpen"
      :run="run"
      :busy="busy"
      @refine="onRefine"
      @restore="onRestore"
      @decide="onDecide"
    />

    <HarvestLaunchDialog
      v-if="run.scope?.productId"
      v-model="harvestDialogOpen"
      :product-id="String(run.scope.productId)"
      @launch="launchHarvest"
    />

    <div v-if="run.result" class="art__result">
      <div class="art__result-head">
        <i :class="stillConflicting ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'" :style="{ color: stillConflicting ? 'var(--status-bad-solid)' : 'var(--status-ok-solid)' }" aria-hidden="true"></i>
        <span class="art__result-title">{{ t('labels.result_label') }}</span>
      </div>

      <div v-if="stillConflicting" class="art__conflict-banner">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <span class="art__conflict-text">{{ t('labels.sync_conflicts_remain') }}</span>
        <Button :label="t('labels.recheck_git')" text size="small" :loading="rechecking" @click="recheckConflicts" />
        <Button v-if="run.result.mrUrl" :label="t('labels.open_mr_arrow')" icon="pi pi-external-link" text size="small" :href="run.result.mrUrl" target="_blank" as="a" />
      </div>
      <p
        v-if="recheckOutcome"
        class="art__recheck-outcome"
        :style="{ color: recheckOutcome === 'clear' ? 'var(--status-ok-solid)' : recheckOutcome === 'not_found' ? 'var(--p-text-muted-color)' : 'var(--status-bad-solid)' }"
      >
        {{
          recheckOutcome === 'clear' ? t('labels.recheck_clear')
          : recheckOutcome === 'not_found' ? t('labels.recheck_not_found')
            : t('labels.recheck_still_conflicting')
        }}
      </p>

      <MarkdownView v-if="resultMarkdown" :text="resultMarkdown" />
      <div v-if="resultScalars.length" class="art__scalars">
        <div v-for="pair in resultScalars" :key="pair[0]" class="art__scalar">
          <span class="art__scalar-label">{{ pair[0] }}:</span>
          <a v-if="isUrl(pair[1])" :href="pair[1]" target="_blank" rel="noopener noreferrer" class="art__scalar-url">{{ pair[1] }}</a>
          <span v-else class="art__scalar-value" :class="{ 'art__scalar-value--bad': pair[0] === 'hasConflicts' && pair[1] === true }">{{ pair[1] }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.art {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.art__banner {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  margin-bottom: 12px;
  font-size: 12.5px;
  color: var(--p-text-secondary-color);
  background: var(--p-content-hover-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}

.art__banner-text {
  flex: 1;
}

.paso-marca {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  margin-top: 3px;
}

.paso-marca--done { border: 2px solid var(--status-ok-solid); background: var(--status-ok-solid); color: var(--p-primary-contrast-color); }
.paso-marca--fail { border: 2px solid var(--status-bad-solid); background: var(--status-bad-solid); color: var(--p-primary-contrast-color); }
.paso-marca--wait { border: 2px solid var(--status-warn-solid); background: transparent; color: var(--status-warn-solid); }
.paso-marca--run { border: 2px solid var(--p-agent-color); background: transparent; }
.paso-marca--todo { border: 2px solid var(--p-content-border-color); background: transparent; }

.paso-marca__pulso {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--p-agent-color);
  animation: art-paso-pulso 1.4s ease-in-out infinite;
}

@keyframes art-paso-pulso {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(1.3); }
}

.art__pasos :deep(.p-timeline-event-opposite) { display: none; flex: 0; }
.art__pasos :deep(.p-timeline-event-separator) { width: 16px; }
.art__pasos :deep(.p-timeline-event-connector) { width: 2px; background: var(--p-content-hover-background); }
.art__pasos :deep(.p-timeline-event) { min-height: 0; }
.art__pasos :deep(.p-timeline-event-content) { padding-bottom: 18px; }

.paso {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.paso__cabecera {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.paso__titulo {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--p-text-color);
}

.paso--fail .paso__titulo {
  color: var(--status-bad-strong);
}

.paso__duracion {
  font-size: 11px;
  color: var(--p-text-dim-color);
}

.paso__detalle {
  margin: 0;
  font-size: 12.5px;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}

.paso__markdown {
  max-height: 320px;
  overflow-y: auto;
  border-left: 2px solid var(--p-agent-color);
  padding-left: 8px;
  opacity: 0.9;
}

.paso__loop {
  margin-top: 2px;
}

.paso__loop :deep(.p-accordionheader) {
  padding: 4px 6px;
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  background: transparent;
  border: none;
}

.paso__loop :deep(.p-accordioncontent-content) {
  padding: 2px 6px 6px 22px;
  border-left: 2px solid var(--p-content-border-color);
}

.paso__loop-call {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  padding: 2px 0;
}

.paso__loop-name {
  font-family: 'Fira Code', 'Courier New', monospace;
  color: var(--p-text-secondary-color);
  word-break: break-all;
}

.paso__loop-dur {
  font-size: 10.5px;
  color: var(--p-text-faint-color);
}

.art__decision {
  margin-top: 10px;
}

.art__decision-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 6px;
}

.art__pausa-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border: 1px solid;
  border-radius: 20px;
  font-size: 10.5px;
  flex: none;
}

.art__resumen {
  font-size: 12px;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.art__proposals {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.art__review-card {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
}

.art__review-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.art__review-head i {
  color: var(--p-agent-color);
}

.art__review-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
  flex: 1;
}

.art__review-badge {
  font-size: 10.5px;
  padding: 2px 8px;
  border: 1px solid var(--p-text-faint-color);
  border-radius: 20px;
  color: var(--p-text-muted-color);
}

.art__review-desc {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.art__result {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-background);
  max-height: 420px;
  overflow-y: auto;
}

.art__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.art__result-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
}

.art__conflict-banner {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--status-bad-strong);
  background: var(--status-bad-soft);
  border: 1px solid var(--status-bad-border);
  border-radius: 6px;
}

.art__conflict-text {
  flex: 1;
}

.art__recheck-outcome {
  font-size: 11.5px;
  margin: 0 0 8px;
}

.art__scalars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.art__scalar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.art__scalar-label {
  font-weight: 500;
  white-space: nowrap;
}

.art__scalar-url {
  color: var(--p-agent-color);
  word-break: break-all;
}

.art__scalar-value--bad {
  color: var(--status-bad-strong);
  font-weight: 500;
}
</style>
