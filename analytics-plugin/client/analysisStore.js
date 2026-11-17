import { reactive } from 'vue'

// The analysis of the feature model of a line, as it was in the editor: a fast pass (structure and SAT), then the BDD one in the
// background, and a metric at a time when the person changes the solver. The strip of the toolbar and the panel share one state per line.

let api = null
export const setApi = (instance) => { api = instance }

const BASE = '/plugins/analytics-plugin'
const states = new Map()
const running = new Map() // lineId -> { fast, bdd, metrics: { metric: controller } }

export const analysisFor = (lineId) => {
  let state = states.get(lineId)
  if (!state) {
    state = reactive({
      flamapyResults: {},
      mode: 'BDD',
      modeTabs: 'BDD',
      activeTab: 'model information',
      metricsLoading: false,
      bddLoading: false,
      metricLoading: { satisfiable: false, deadFeatures: false },
      modelInvalid: 'init', // 'init' | 'yes' | 'no'
      unavailable: false,
    })
    states.set(lineId, state)
  }
  return state
}

export const forgetAnalysis = (lineId) => states.delete(lineId)

const controllersOf = (lineId) => {
  if (!running.has(lineId)) running.set(lineId, { fast: null, bdd: null, metrics: {} })
  return running.get(lineId)
}

export const stopAnalysis = (lineId) => {
  const c = running.get(lineId)
  if (!c) return
  c.fast?.abort()
  c.bdd?.abort()
  Object.values(c.metrics).forEach((m) => m?.abort())
  running.delete(lineId)
}

const cancelled = (err) => err.name === 'CanceledError' || err.name === 'AbortError'

export async function runAnalysis({ lineId, uvl, say, t }) {
  const state = analysisFor(lineId)
  const c = controllersOf(lineId)
  c.fast?.abort()
  c.bdd?.abort()
  c.fast = new AbortController()
  state.metricsLoading = true
  state.bddLoading = false
  state.activeTab = 'model information'

  try {
    const { data: results } = await api.post(`${BASE}/analyze`, { uvl, mode: state.mode }, { signal: c.fast.signal })
    state.flamapyResults = results
    state.modeTabs = results._solveMode ?? state.mode
    state.unavailable = false
    if (!results?.coreFeatures) {
      state.modelInvalid = 'yes'
      say('negative', t('error_messages.invalid_model'), 2000)
      return
    }
    state.modelInvalid = 'no'
  } catch (err) {
    if (cancelled(err)) return
    const status = err.response?.status
    if (!err.response || status === 503 || err.response?.data?.code === 'ANALYSIS_UNAVAILABLE') {
      state.unavailable = true
      state.modelInvalid = 'init'
      say('warning', t('error_messages.analysis_unavailable'), 5000)
      return
    }
    state.unavailable = false
    state.modelInvalid = 'yes'
    const detail = err.response?.data?.detail
    say('negative', detail ? `${t('error_messages.invalid_model')}: ${detail}` : t('error_messages.invalid_model'), 4000)
    return
  } finally {
    state.metricsLoading = false
    c.fast = null
  }

  c.bdd = new AbortController()
  state.bddLoading = true
  api.post(`${BASE}/analyze/bdd`, { uvl }, { signal: c.bdd.signal })
    .then(({ data: bdd }) => {
      state.flamapyResults = {
        ...state.flamapyResults,
        ...bdd,
        _skipped: [...(state.flamapyResults._skipped ?? []), ...(bdd._skipped ?? [])],
      }
      if (bdd._skipped?.length > 0) say('info', t('error_messages.large_model_partial_analysis'), 4000)
    })
    .catch((err) => {
      if (!cancelled(err)) console.warn('[analytics] BDD analysis failed:', err.message)
    })
    .finally(() => {
      state.bddLoading = false
      c.bdd = null
    })
}

export async function runMetric({ lineId, uvl, metric, mode, say, t }) {
  const state = analysisFor(lineId)
  const c = controllersOf(lineId)
  c.metrics[metric]?.abort()
  c.metrics[metric] = new AbortController()
  state.metricLoading[metric] = true
  try {
    const { data } = await api.post(`${BASE}/analyze/metric`, { uvl, metric, mode }, { signal: c.metrics[metric].signal })
    state.flamapyResults = { ...state.flamapyResults, ...data }
  } catch (err) {
    if (cancelled(err)) return
    say('negative', t('error_messages.load_model'), 2000)
  } finally {
    state.metricLoading[metric] = false
    c.metrics[metric] = null
  }
}
