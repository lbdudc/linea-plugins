<script setup>
import { computed } from 'vue'
import { analysisFor } from './analysisStore'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'
import Tooltip from 'primevue/tooltip'

const vTooltip = Tooltip

// what the feature model editor tells its slots (the ones this component does not use are named so they are not taken for attributes)
const props = defineProps({
  lineId: { type: String, required: true },
  uvl: { type: String, default: '' },
  uvlInvalid: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  isFeatureModel: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  requestSave: { type: Function, default: null },
})

const state = analysisFor(props.lineId)
const flamapyResults = computed(() => state.flamapyResults)
const metricsLoading = computed(() => state.metricsLoading)
const modelInvalid = computed(() => (props.uvlInvalid ? 'yes' : state.modelInvalid))
const stripLoading = computed(() => props.loading || state.metricsLoading)
const isAnalysisDegraded = computed(() => state.flamapyResults?._skipped?.length > 0)
const totalFeatures = computed(() => {
  const r = state.flamapyResults
  if (!r) return 0
  if (r._featureCount) return r._featureCount
  const fromProb = Object.keys(r.featureInclusionProb || {}).length
  return fromProb > 0 ? fromProb : (r.coreFeatures?.length ?? 0) + (r.leafFeatures?.length ?? 0)
})
</script>

<template>
<div v-if="isFeatureModel && (stripLoading || modelInvalid !== 'init')" class="fm-metrics-strip">
  <template v-if="stripLoading">
    <template v-for="n in 5" :key="`strip-sk-${n}`">
      <div v-if="n > 1" class="fm-strip-sep" />
      <div class="fm-strip-metric fm-strip-metric--skeleton">
        <Skeleton width="26px" height="15px" />
        <Skeleton width="52px" height="9px" />
      </div>
    </template>
  </template>
  <template v-else-if="modelInvalid === 'no' && !metricsLoading">
    <div class="fm-strip-metric">
      <span class="fm-strip-metric__val">{{ totalFeatures }}</span>
      <span class="fm-strip-metric__lbl">{{ $t('labels.features') }}</span>
    </div>
    <div class="fm-strip-sep" />
    <div class="fm-strip-metric">
      <span class="fm-strip-metric__val fm-strip-metric__val--blue">{{ flamapyResults.coreFeatures?.length ?? 0 }}</span>
      <span class="fm-strip-metric__lbl">{{ $t('labels.core') }}</span>
    </div>
    <div class="fm-strip-sep" />
    <div class="fm-strip-metric">
      <span class="fm-strip-metric__val fm-strip-metric__val--green">{{ flamapyResults.leafNumber ?? 0 }}</span>
      <span class="fm-strip-metric__lbl">{{ $t('labels.leaf') }}</span>
    </div>
    <div class="fm-strip-sep" />
    <div class="fm-strip-metric">
      <span class="fm-strip-metric__val">{{ flamapyResults.maxDepth ?? '—' }}</span>
      <span class="fm-strip-metric__lbl">{{ $t('labels.max_depth') }}</span>
    </div>
    <div class="fm-strip-sep" />
    <div class="fm-strip-metric">
      <span class="fm-strip-metric__val">{{ flamapyResults.averageBranchingFactor?.toFixed(2) ?? '—' }}</span>
      <span class="fm-strip-metric__lbl">{{ $t('labels.avg_branching_factor') }}</span>
    </div>
    <template v-if="flamapyResults.satisfiable !== undefined && flamapyResults.satisfiable !== null">
      <div class="fm-strip-sep" />
      <div class="fm-strip-metric">
        <span
          class="fm-strip-metric__val fm-strip-metric__val--status"
          :class="flamapyResults.satisfiable ? 'fm-strip-metric__val--ok' : 'fm-strip-metric__val--err'"
        >
          {{ flamapyResults.satisfiable ? '✓' : '✗' }}
        </span>
        <span class="fm-strip-metric__lbl">{{ $t('labels.satisfiable') }}</span>
      </div>
    </template>
    <template v-if="isAnalysisDegraded">
      <div class="fm-strip-sep" />
      <Tag class="fm-strip-degraded-badge" v-tooltip.bottom="$t('error_messages.large_model_partial_analysis')">
        <template #icon><i class="pi pi-info-circle" style="font-size: 11px" aria-hidden="true"></i></template>
        {{ $t('labels.partial_analysis') }}
      </Tag>
    </template>
  </template>
  <template v-else-if="modelInvalid === 'yes'">
    <i class="pi pi-exclamation-triangle" style="font-size: 14px; color: var(--status-bad)" aria-hidden="true"></i>
    <span class="fm-strip-invalid">{{ $t('error_messages.invalid_model') }}</span>
  </template>
  <template v-else>
    <span class="fm-strip-idle" />
  </template>
</div>
</template>

<style scoped lang="scss">
// the figures of the model, on the toolbar: one line, they give way before the buttons do
.fm-metrics-strip {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.fm-strip-metric {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-right: 14px;

  &__val {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
    color: var(--text-heading);
    font-variant-numeric: tabular-nums;

    &--blue   { color: var(--p-primary-color); }
    &--green  { color: var(--status-ok); }
    &--status { font-size: 14px; }
    &--ok     { color: var(--status-ok); }
    &--err    { color: var(--status-bad); }
  }

  &__lbl {
    font-size: 10.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--p-text-dim-color);
  }
}

.fm-strip-sep {
  width: 1px;
  height: 18px;
  margin-right: 14px;
  flex-shrink: 0;
  background: var(--p-content-hover-background);
}

.fm-strip-invalid {
  font-size: 0.8125rem;
  margin-left: 8px;
  color: var(--status-bad);
}

.fm-strip-degraded-badge {
  background: transparent !important;
  border: 1px solid var(--status-warn);
  color: var(--status-warn) !important;
  font-weight: 400;
}

.fm-strip-metric--skeleton {
  gap: 4px;
  justify-content: center;
}
</style>
