<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, watch } from 'vue'
import { notify } from 'src/composables/useNotify'
import { useT } from 'src/composables/useT'
import PanelGhost from 'components/feature-model/PanelGhost.vue'
import { analysisFor, forgetAnalysis, runAnalysis, runMetric, stopAnalysis } from './analysisStore'

// the charts load after the page is up: a ghost holds the place meanwhile
const UVLAnalysis = defineAsyncComponent({ loader: () => import('./UVLAnalysis.vue').then((m) => m.default), loadingComponent: PanelGhost, delay: 0 })

const props = defineProps({
  lineId: { type: String, required: true },
  uvl: { type: String, default: '' },
  uvlInvalid: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  isFeatureModel: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  requestSave: { type: Function, default: null },
})

const t = useT()
const state = analysisFor(props.lineId)
const modelInvalid = computed(() => (props.uvlInvalid ? 'yes' : state.modelInvalid))

const say = (type, message, timeout) => notify({ type, message, position: 'bottom-right', timeout })
const run = () => runAnalysis({ lineId: props.lineId, uvl: props.uvl, say, t })

// the UVL the editor works out each time the model changes is what is analysed
watch(() => props.uvl, (uvl) => { if (uvl) run() }, { immediate: true })
watch(() => state.mode, () => { if (props.uvl) run() })
watch(modelInvalid, (now, before) => {
  if (before === 'yes' && now === 'no') say('positive', t('labels.new_valid_model'), 1500)
})

const onMetricModeChanged = ({ metric, mode }) => runMetric({ lineId: props.lineId, uvl: props.uvl, metric, mode, say, t })

onBeforeUnmount(() => {
  stopAnalysis(props.lineId)
  forgetAnalysis(props.lineId)
})
</script>

<template>
  <div v-if="isFeatureModel" class="fm-analysis-panel">
    <UVLAnalysis
      :flamapyResults="state.flamapyResults"
      :mode="state.mode"
      :mode-tabs="state.modeTabs"
      :active-tab="state.activeTab"
      :model-invalid="modelInvalid"
      :unavailable="state.unavailable"
      :read-only="readOnly"
      :file-content="uvl"
      :loading="loading || state.metricsLoading"
      :metrics-loading="state.metricsLoading"
      :bdd-loading="state.bddLoading"
      :metric-loading="state.metricLoading"
      @update:mode="state.mode = $event"
      @product-created="requestSave?.()"
      @metric-mode-changed="onMetricModeChanged"
    />
  </div>
</template>

<style scoped lang="scss">
.fm-analysis-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: var(--surface-bg);
}
</style>
