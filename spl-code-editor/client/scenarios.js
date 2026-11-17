// Scenarios: the product being imagined (its features, its sample data, the values changed by hand) and the way back to earlier ones.
// A history of the last ones, walked back and forth like undo, and named ones that are kept. Pure functions; the editor keeps the state.

export const MAX_RECENT = 25

const sorted = (list) => [...new Set(list ?? [])].sort()
/** A scenario as it is kept: features sorted, data as text, values changed by hand as an object. */
export const snapshot = ({ features = [], data = '', overrides = {} } = {}) => ({ features: sorted(features), data: String(data), overrides: { ...overrides } })

export const same = (a, b) => JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b))

/** Short words for a list: "49 features · "demo" · 2 values changed". */
export const describe = (snap, { featuresWord = (n) => `${n} features`, changedWord = (n) => `${n} changed` } = {}) => {
  let name = ''
  try { name = JSON.parse(snap.data || '{}')?.basicData?.name ?? '' } catch { name = '' }
  const changed = Object.keys(snap.overrides ?? {}).length
  return [featuresWord(snap.features.length), name ? `"${name}"` : '', changed ? changedWord(changed) : ''].filter(Boolean).join(' · ')
}

/**
 * The history after the scenario `snap` was reached: `{ recent, cursor }`. `recent` is newest first, `cursor` the one being looked at
 * (0 = the newest). A new scenario reached while looking at an older one drops the ones that were "ahead", as undo does.
 */
export const record = ({ recent = [], cursor = 0 } = {}, snap) => {
  const kept = recent.slice(cursor)
  if (kept.length && same(kept[0], snap)) return { recent: kept, cursor: 0 }
  return { recent: [snapshot(snap), ...kept].slice(0, MAX_RECENT), cursor: 0 }
}

/** One step back (`-1`... older) or forth in the history: the new cursor, or the same when there is nowhere to go. */
export const step = ({ recent = [], cursor = 0 }, direction) => Math.max(0, Math.min(recent.length - 1, cursor + direction))

export const canBack = ({ recent = [], cursor = 0 }) => cursor < recent.length - 1
export const canForward = ({ cursor = 0 }) => cursor > 0

/** Named scenarios: saving over a name replaces it; the newest first. */
export const save = (saved = [], name, snap) => {
  const clean = String(name ?? '').trim().slice(0, 60)
  if (!clean) return saved
  return [{ name: clean, savedAt: Date.now(), snap: snapshot(snap) }, ...saved.filter((s) => s.name !== clean)]
}
export const remove = (saved = [], name) => saved.filter((s) => s.name !== name)

/** What was kept (a JSON text), made safe. */
export const read = (text) => {
  let data = {}
  try { data = JSON.parse(text ?? '{}') ?? {} } catch { data = {} }
  const ok = (s) => s && Array.isArray(s.features) && typeof s.data === 'string'
  return {
    recent: (Array.isArray(data.recent) ? data.recent : []).filter(ok).map(snapshot).slice(0, MAX_RECENT),
    cursor: 0,
    saved: (Array.isArray(data.saved) ? data.saved : []).filter((s) => s && typeof s.name === 'string' && ok(s.snap)).map((s) => ({ name: s.name, savedAt: Number(s.savedAt) || 0, snap: snapshot(s.snap) })),
  }
}
