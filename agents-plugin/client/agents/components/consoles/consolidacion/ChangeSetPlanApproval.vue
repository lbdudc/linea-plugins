<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import Tag from 'primevue/tag';

import MarkdownView from '../harvest/MarkdownView.vue';

import ChangeSetProductMatrix from './ChangeSetProductMatrix.vue';
import { AUTONOMY_MODES, autonomyModeMeta, EDIT_CLASS_META, editClassMeta } from './changesetConstants.js';
import { buildApprovalMeta, deriveMatrixMode } from './changesetApproval.js';

const props = defineProps({
  run: { type: Object, required: true },
  decidingRunId: { type: String, default: null },
  decide: { type: Function, default: null },
  refine: { type: Function, default: null },
  restore: { type: Function, default: null },
  childRunsById: { type: Object, default: () => ({}) },
});

const { t } = useI18n();
const tc = (key, count, params = {}) => t(key, params, count);

const planProposal = computed(() => (props.run.proposals ?? []).find((p) => p.kind === 'plan_approval' && !p.decision));

const anyPlanProposal = computed(() => (props.run.proposals ?? []).find((p) => p.kind === 'plan_approval'));

const plan = computed(() => anyPlanProposal.value?.body?.plan ?? props.run.result?.ledger?.plan ?? null);

const editClass = computed(() => plan.value?.editClass ?? props.run.result?.editClass ?? null);
const editMeta = computed(() => editClassMeta(editClass.value));
const isKnownEditClass = computed(() => editClass.value != null && Object.prototype.hasOwnProperty.call(EDIT_CLASS_META, editClass.value));

const stats = computed(() => plan.value?.stats ?? null);
const cascade = computed(() => plan.value?.cascade ?? []);

const matrixMode = computed(() => deriveMatrixMode({
  hasPendingPlanProposal: Boolean(planProposal.value),
  runStatus: props.run.status,
}));

const isPlanning = computed(() => matrixMode.value === 'planning');
const isDecided = computed(() => !planProposal.value);
const isBusy = computed(() => props.decidingRunId === String(props.run._id));

const autonomyDefault = ref(planProposal.value?.body?.autonomyDefault ?? 'semi');
const autonomyPerProduct = ref({});
const autonomyMeta = computed(() => autonomyModeMeta(autonomyDefault.value));

const overrides = ref({});
watch(
  [() => String(props.run?._id ?? ''), () => String(planProposal.value?._id ?? '')],
  () => {
    overrides.value = {};
    autonomyPerProduct.value = {};
  },
);

const onApprove = () => {
  if (!planProposal.value || !props.decide) return;
  props.decide({
    runId: String(props.run._id),
    proposalId: String(planProposal.value._id),
    decision: 'approved',
    meta: buildApprovalMeta({
      overrides: overrides.value,
      autonomyDefault: autonomyDefault.value,
      autonomyPerProduct: autonomyPerProduct.value,
    }),
  });
};

const onReject = () => {
  if (!planProposal.value || !props.decide) return;
  props.decide({ runId: String(props.run._id), proposalId: String(planProposal.value._id), decision: 'rejected' });
};

const testReviewProposal = computed(() => (props.run.proposals ?? []).find((p) => p.kind === 'test_review' && !p.decision));

const onApproveTests = () => {
  if (!testReviewProposal.value || !props.decide) return;
  props.decide({ runId: String(props.run._id), proposalId: String(testReviewProposal.value._id), decision: 'approved' });
};
const onRejectTests = () => {
  if (!testReviewProposal.value || !props.decide) return;
  props.decide({ runId: String(props.run._id), proposalId: String(testReviewProposal.value._id), decision: 'rejected' });
};

const verifyMarkdown = computed(() => props.run.result?.verifyMarkdown ?? null);
const sandbox = computed(() => props.run.result?.sandbox ?? null);
const sandboxSummary = computed(() => {
  const s = sandbox.value;
  if (!s || s.skipped) return null;
  return s.summary ?? null;
});

const decidedAutonomy = computed(
  () => anyPlanProposal.value?.body?.decisionMeta?.autonomy?.default ?? props.run.autonomyMode ?? null,
);
</script>

<template>
  <div class="plan-approval">
    <div v-if="editClass" class="plan-approval__banner" :style="{ borderLeftColor: editMeta.color }">
      <i :class="editMeta.icon" :style="{ color: editMeta.color }" aria-hidden="true"></i>
      <div>
        <div class="plan-approval__banner-title">{{ isKnownEditClass ? t(`labels.edit_class_${editClass}_label`) : editClass }}</div>
        <div class="plan-approval__banner-detail">{{ isKnownEditClass ? t(`labels.edit_class_${editClass}_detail`) : '' }}</div>
      </div>
      <span v-if="run.result?.origin || run.input?.origin" class="plan-approval__origin-chip">{{ run.result?.origin ?? run.input?.origin }}</span>
    </div>

    <div v-if="stats" class="plan-approval__stats">
      <Tag v-if="stats.migrate" :value="`${stats.migrate} ${tc('labels.plan_stat_migration', stats.migrate, { n: stats.migrate })}`" :style="{ color: 'var(--chart-4)', borderColor: 'var(--chart-4)' }" class="plan-approval__stat" />
      <Tag v-if="stats.regen" :value="`${stats.regen} ${tc('labels.plan_stat_regen', stats.regen, { n: stats.regen })}`" :style="{ color: 'var(--chart-1)', borderColor: 'var(--chart-1)' }" class="plan-approval__stat" />
      <Tag v-if="stats.likelyConflict" :value="`⚠️ ${stats.likelyConflict} ${tc('labels.plan_stat_conflict', stats.likelyConflict, { n: stats.likelyConflict })}`" :style="{ color: 'var(--status-warn-solid)', borderColor: 'var(--status-warn-solid)' }" class="plan-approval__stat" />
      <Tag v-if="stats.critical" :value="`🔴 ${stats.critical} ${t('labels.plan_stat_critical')}`" :style="{ color: 'var(--status-bad-solid)', borderColor: 'var(--status-bad-solid)' }" class="plan-approval__stat" />
      <Tag v-if="stats.skip" :value="`${stats.skip} ${t('labels.plan_stat_unaffected')}`" :style="{ color: 'var(--p-text-dim-color)', borderColor: 'var(--p-text-dim-color)' }" class="plan-approval__stat" />
    </div>

    <div v-if="isPlanning" class="plan-approval__autonomy">
      <div class="plan-approval__autonomy-intro">{{ t('labels.plan_autonomy_intro') }}</div>
      <div class="plan-approval__autonomy-options">
        <button
          v-for="mode in AUTONOMY_MODES"
          :key="mode.value"
          type="button"
          class="plan-approval__autonomy-btn"
          :class="{ 'plan-approval__autonomy-btn--active': autonomyDefault === mode.value }"
          :style="autonomyDefault === mode.value ? { background: mode.color, borderColor: mode.color } : null"
          :title="mode.description"
          @click="autonomyDefault = mode.value"
        >
          <i :class="mode.icon" aria-hidden="true"></i> {{ mode.label }}
        </button>
      </div>
      <div class="plan-approval__autonomy-hint">
        <span v-if="autonomyDefault === 'manual'">{{ t('labels.plan_autonomy_manual') }}</span>
        <span v-else-if="autonomyDefault === 'semi'">{{ t('labels.plan_autonomy_semi') }}</span>
        <span v-else>{{ t('labels.plan_autonomy_auto') }}</span>
      </div>
    </div>
    <div v-else-if="isDecided && decidedAutonomy" class="plan-approval__decided-autonomy">
      <Tag :value="autonomyModeMeta(decidedAutonomy).label" :icon="autonomyModeMeta(decidedAutonomy).icon" :style="{ background: autonomyModeMeta(decidedAutonomy).color, color: 'var(--p-content-background)' }" />
    </div>

    <p v-if="isPlanning && cascade.length" class="plan-approval__hint">
      <i class="pi pi-info-circle" aria-hidden="true"></i> {{ t('labels.plan_matrix_hint') }}
    </p>

    <ChangeSetProductMatrix
      v-if="cascade.length"
      :cascade="cascade"
      :child-runs-by-id="childRunsById"
      :mode="matrixMode"
      :model-value="overrides"
      :autonomy-per-product="isPlanning ? autonomyPerProduct : undefined"
      :autonomy-default="isPlanning ? autonomyDefault : undefined"
      :deciding-run-id="decidingRunId"
      :decide="decide"
      :refine="refine"
      :restore="restore"
      class="plan-approval__matrix"
      @update:model-value="overrides = $event"
      @update:autonomy-per-product="autonomyPerProduct = $event"
    />

    <div v-if="isPlanning" class="plan-approval__actions">
      <p class="plan-approval__actions-hint">{{ t('labels.plan_actions_hint') }}</p>
      <div class="plan-approval__actions-buttons">
        <button type="button" class="plan-approval__btn plan-approval__btn--reject" :disabled="isBusy" @click="onReject">
          <i class="pi pi-times" aria-hidden="true"></i> {{ t('labels.plan_reject_label') }}
        </button>
        <button type="button" class="plan-approval__btn plan-approval__btn--approve" :style="{ background: autonomyMeta.color, borderColor: autonomyMeta.color }" :disabled="isBusy" @click="onApprove">
          <i :class="isBusy ? 'pi pi-spin pi-spinner' : 'pi pi-check'" aria-hidden="true"></i> {{ t('labels.plan_approve_label') }}
        </button>
      </div>
    </div>

    <div v-else-if="isDecided && anyPlanProposal">
      <div class="plan-approval__decision" :class="anyPlanProposal.decision === 'rejected' ? 'plan-approval__decision--bad' : 'plan-approval__decision--ok'">
        <i :class="anyPlanProposal.decision === 'rejected' ? 'pi pi-times-circle' : 'pi pi-check-circle'" aria-hidden="true"></i>
        {{ anyPlanProposal.decision === 'rejected' ? t('labels.plan_decision_rejected') : t('labels.plan_decision_approved') }}
      </div>

      <MarkdownView v-if="verifyMarkdown" :text="verifyMarkdown" class="plan-approval__verify" />

      <div v-if="sandboxSummary" class="plan-approval__sandbox" :class="sandbox?.allPassed ? 'plan-approval__sandbox--ok' : 'plan-approval__sandbox--warn'">
        <i :class="sandbox?.allPassed ? 'pi pi-check' : 'pi pi-exclamation-triangle'" aria-hidden="true"></i> {{ sandboxSummary }}
      </div>

      <div v-if="testReviewProposal" class="plan-approval__actions plan-approval__actions--tests">
        <MarkdownView :text="testReviewProposal.body.markdown" class="plan-approval__verify" />
        <div class="plan-approval__actions-buttons">
          <button type="button" class="plan-approval__btn plan-approval__btn--reject" :disabled="isBusy" @click="onRejectTests">
            <i class="pi pi-times" aria-hidden="true"></i> {{ t('labels.plan_reject_label') }}
          </button>
          <button type="button" class="plan-approval__btn plan-approval__btn--approve" :style="{ background: 'var(--status-ok-solid)', borderColor: 'var(--status-ok-solid)' }" :disabled="isBusy" @click="onApproveTests">
            <i :class="isBusy ? 'pi pi-spin pi-spinner' : 'pi pi-check'" aria-hidden="true"></i> {{ t('labels.plan_approve_label') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plan-approval__banner {
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 16px;
  border-left: 3px solid transparent;
  background: var(--p-content-hover-background);
}

.plan-approval__banner-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
}

.plan-approval__banner-detail {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
}

.plan-approval__origin-chip {
  margin-left: auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 20px;
  background: var(--p-content-background);
  color: var(--p-text-muted-color);
}

.plan-approval__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.plan-approval__stat {
  font-size: 11px;
  background: transparent;
  border: 1px solid currentColor;
}

.plan-approval__autonomy {
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 14px;
  background: var(--p-content-hover-background);
}

.plan-approval__autonomy-intro {
  font-size: 11.5px;
  color: var(--p-text-muted-color);
  margin-bottom: 7px;
}

.plan-approval__autonomy-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.plan-approval__autonomy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
  color: var(--p-text-secondary-color);
  font-size: 12px;
  cursor: pointer;
}

.plan-approval__autonomy-btn--active {
  color: var(--p-content-background);
}

.plan-approval__autonomy-hint {
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin-top: 7px;
}

.plan-approval__decided-autonomy {
  margin-bottom: 10px;
}

.plan-approval__hint {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--p-text-secondary-color);
  background: var(--p-agent-highlight-soft);
  border-radius: 6px;
}

.plan-approval__matrix {
  margin-bottom: 14px;
}

.plan-approval__actions {
  border-top: 1px solid var(--p-content-border-color);
  padding-top: 12px;
}

.plan-approval__actions--tests {
  border-top: 1px solid var(--p-content-border-color);
  margin-top: 14px;
}

.plan-approval__actions-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.plan-approval__actions-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.plan-approval__btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: 5px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.plan-approval__btn--reject {
  background: transparent;
  color: var(--status-bad-solid);
}

.plan-approval__btn--reject:hover {
  background: var(--status-bad-soft);
}

.plan-approval__btn--approve {
  color: var(--p-primary-contrast-color);
}

.plan-approval__btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.plan-approval__decision {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 12px;
  font-size: 12.5px;
}

.plan-approval__decision--ok {
  color: var(--status-ok-solid);
}

.plan-approval__decision--bad {
  color: var(--status-bad-solid);
}

.plan-approval__verify {
  font-size: 12.5px;
  border-left: 2px solid var(--p-agent-color);
  padding-left: 10px;
}

.plan-approval__sandbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--p-primary-contrast-color);
}

.plan-approval__sandbox--ok {
  background: var(--status-ok-solid);
}

.plan-approval__sandbox--warn {
  background: var(--status-warn-solid);
}
</style>
