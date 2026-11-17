// Flamapy analysis via the dedicated Python REST service (service/). All heavy lifting runs in native CPython; this is a thin HTTP client.
import { createHash } from 'node:crypto'

// where the service is comes from the plugin's `url` setting (see plugin.json); `configure` is called by the plugin on register
let currentUrl = () => 'http://localhost:8000'
export const configure = (getUrl) => { currentUrl = getUrl }
const flamapyUrl = () => currentUrl().replace(/\/$/, '')

async function post(path, body) {
  const res = await fetch(`${flamapyUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`flamapy-server ${res.status}: ${text}`)
  }
  return res.json()
}

// An analysis is a function of the model text (and the solver asked for), and it is slow (seconds, and ~40 s for the BDD pass of a model of
// ~80 features) while the service has one worker: opening the model of a line again, or two people opening the same one, must not queue the
// same work. Answers are kept by the hash of what was asked, and a request that is already running is shared. A failure is not kept.
const MAX_KEPT = 100
const kept = new Map() // key -> Promise<result>

const once = (kind, parts, compute) => {
  const key = createHash('sha256').update([kind, ...parts].join('\u0000')).digest('hex')
  const hit = kept.get(key)
  if (hit) {
    // most recently used last
    kept.delete(key)
    kept.set(key, hit)
    return hit
  }
  if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value)
  const computedAt = new Date().toISOString()
  const answer = compute().then((result) => ({ ...result, _computedAt: computedAt }))
  kept.set(key, answer)
  answer.catch(() => { if (kept.get(key) === answer) kept.delete(key) })
  return answer
}

/** Forgets every kept answer (the service was replaced, or a test wants a clean start). */
export const forgetAnalyses = () => kept.clear()

const requireUvl = (rawUvl) => {
  if (!rawUvl || typeof rawUvl !== 'string' || !rawUvl.trim().startsWith('features')) {
    throw new Error('UVL input must be a non-empty string starting with "features".')
  }
}

/**
 * Fast analysis (structural + PySAT). Always returns quickly regardless of model size.
 * Returns: structural fields, satisfiable, deadFeatures, falseOptionalFeatures, _metadata
 */
export async function runFullAnalysis(rawUvl, requestedMode = 'BDD') {
  requireUvl(rawUvl)
  const mode = requestedMode ?? 'BDD'
  return once('analyze', [mode, rawUvl], () => post('/analyze', { uvl: rawUvl, mode }))
}

/**
 * Slow BDD analysis (BDD group + enumeration). Intended for background loading.
 * Returns: configurations, configsNumber, configDistribution, featureInclusionProb,
 *          homogeneity, variability, uniqueFeatures, variantFeatures, _skipped[], _elapsedMs
 */
export async function runBddAnalysis(rawUvl) {
  requireUvl(rawUvl)
  return once('bdd', [rawUvl], () => post('/analyze/bdd', { uvl: rawUvl }))
}

/** One metric (`satisfiable`, `deadFeatures`) in the given solver mode. */
export async function runMetric(rawUvl, metric, mode) {
  if (!rawUvl || typeof rawUvl !== 'string') throw new Error('UVL must be a non-empty string.')
  const solver = mode ?? 'BDD'
  return once('metric', [metric, solver, rawUvl.trim()], () => post(`/analyze/metric?metric=${encodeURIComponent(metric)}`, { uvl: rawUvl.trim(), mode: solver }))
}
