// The final product line by line: which line of the annotated template each one comes from and why it is there. The sandbox says, for
// every piece of the output, the template lines it was copied from (or the `=` expression it is the value of) and what the code around it
// decided (conditions with the value they had). These functions read that into rows, explanations and a list of decisions.

const FEATURE = /feature\.([A-Za-z0-9_$]+)/g
/** The feature names in a condition, in the order they appear. */
export const featuresOfCondition = (condition) => [...new Set([...String(condition ?? '').matchAll(FEATURE)].map((m) => m[1]))]

/** The output as rows: `[{ n, text, pieces: [piece], sources: [{ line, kind, expr?, value? }], whyIds: [id], values: [string] }]`. */
export const outputRows = (content, provenance) => {
  const lines = String(content ?? '').split('\n')
  const starts = [0]
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1)
  const lineOf = (offset) => { let lo = 0; let hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1 } return lo }
  const rows = lines.map((text, i) => ({ n: i + 1, text, pieces: [], sources: [], whyIds: [], values: [] }))
  for (const piece of provenance?.pieces ?? []) {
    const [from, to, sourceLine, , kind, why, marker, value] = piece
    if (to <= from) continue
    const first = lineOf(from)
    const last = lineOf(to - 1)
    for (let l = first; l <= last; l++) {
      const row = rows[l]
      if (!row) continue
      row.pieces.push(piece)
      if (!row.whyIds.includes(why)) row.whyIds.push(why)
      if (kind === 1) {
        row.sources.push({ line: sourceLine, kind: 'value', marker, expr: provenance.markers[marker]?.code, value })
        row.values.push(value)
      } else {
        // text is copied as it is: the output line `l` is `l - first` lines after where the piece starts, in the template too
        const src = sourceLine + content.slice(from, Math.max(from, starts[l])).split('\n').length - 1
        if (!row.sources.some((s) => s.kind === 'text' && s.line === src)) row.sources.push({ line: src, kind: 'text' })
      }
    }
  }
  return rows
}

const featureState = (condition, active) => featuresOfCondition(condition).map((name) => ({ name, on: active.has(name) }))

/**
 * What explains a row: where it comes from, and the chain of decisions around it, outermost first:
 * `{ sources, decisions: [{ kind, line, condition, value, features, after? }] }`. `active` is the set of features the product has.
 */
export const explainRow = (row, provenance, active = new Set(provenance?.features ?? [])) => {
  const seen = new Set()
  const decisions = []
  // the most specific chain is the longest one of the row's pieces
  const ids = [...row.whyIds].sort((a, b) => (provenance.whys[b]?.length ?? 0) - (provenance.whys[a]?.length ?? 0))
  for (const id of ids.slice(0, 1)) {
    for (const item of provenance.whys[id] ?? []) {
      const key = `${item.marker}:${item.kind}`
      if (seen.has(key)) continue
      seen.add(key)
      decisions.push({ ...item, features: featureState(item.condition, active), after: (item.after ?? []).map((a) => ({ ...a, features: featureState(a.condition, active) })) })
    }
  }
  return { sources: row.sources, decisions }
}

/**
 * What a line of the template did: the output lines it produced, or, when it produced none, the block that kept it out:
 * `{ produced: [n], blockedBy: block | null, isMarker: boolean }`.
 */
export const explainSource = (line, rows, provenance, active = new Set(provenance?.features ?? [])) => {
  const produced = rows.filter((r) => r.sources.some((s) => s.line === line)).map((r) => r.n)
  const blocks = provenance?.blocks ?? []
  const isMarker = (provenance?.markers ?? []).some((m) => m.line <= line && line <= m.endLine && m.kind !== 'echo' ? true : (m.kind === 'echo' && m.line <= line && line <= m.endLine))
  if (produced.length) return { produced, blockedBy: null, isMarker }
  // the outermost enclosing block that was not written: an `if` that was false, a branch an earlier one made unnecessary, a loop that ran no turn
  const around = blocks.filter((b) => b.startLine < line && line < b.endLine || (b.startLine === line && b.endLine > line && false)).sort((a, b) => a.depth - b.depth)
  let blockedBy = null
  for (const b of around) {
    const prev = b.prev === null || b.prev === undefined ? null : blocks.find((x) => x.marker === b.prev)
    const falseIf = (b.kind === 'if' || b.kind === 'elseif') && b.value === 'false'
    const elseAfterTrue = (b.kind === 'else' || b.kind === 'elseif') && prev && (prev.value === 'true' || prev.hits === 0 === false && prev.value === 'true')
    const neverRan = b.hits === 0
    if (falseIf || elseAfterTrue || neverRan) { blockedBy = { ...b, features: featureState(b.condition, active), previous: prev }; break }
  }
  return { produced: [], blockedBy, isMarker }
}

/** The decisions of the file as a list for a tree: each block with the output lines it wrote, in the order they open. */
export const decisionList = (rows, provenance, active = new Set(provenance?.features ?? [])) => {
  const wrote = new Map()
  for (const row of rows) {
    const markers = new Set()
    for (const id of row.whyIds) for (const item of provenance.whys[id] ?? []) markers.add(`${item.marker}:${item.kind}`)
    for (const key of markers) wrote.set(key, (wrote.get(key) ?? 0) + 1)
  }
  return (provenance?.blocks ?? []).map((b) => ({ ...b, features: featureState(b.condition, active), wrote: wrote.get(`${b.marker}:${b.kind}`) ?? 0 }))
}
