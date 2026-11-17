// What helps while writing annotations: the feature model's text, what to suggest, what to warn about, where a file ends up when derived.
// Pure functions; the editor feeds them and shows what they answer.

export const MODEL_PATH = 'models/featuremodel.featuremodel'
export const CODE_ROOT = 'src/platform/code/'

const NAME = /^[A-Za-z_][\w$]*$/
export const isFeatureName = (text) => NAME.test(String(text ?? ''))

/** Where a file of the platform ends up in the product, or null when it is not part of it (only `src/platform/code/` is derived). */
export const derivedPath = (path) => (typeof path === 'string' && path.startsWith(CODE_ROOT) && path.length > CODE_ROOT.length ? path.slice(CODE_ROOT.length) : null)

const stripComment = (line) => line.replace(/\/\/.*$/, '')
const count = (line, ch) => stripComment(line).split(ch).length - 1

/** The feature names of a feature model written in LINEA's own text (`feature A { optional { feature B } }`), root first. */
export const featureModelNames = (text) => {
  const names = []
  const clean = String(text ?? '').split(/\r?\n/).map(stripComment).join('\n')
  for (const m of clean.matchAll(/\bfeature\s+("([^"]+)"|[A-Za-z_][\w$.]*)/g)) names.push(m[2] ?? m[1])
  return [...new Set(names)]
}

/** The index of the line where the block that opens on `from` closes, or -1. */
const blockEnd = (lines, from) => {
  let depth = 0
  for (let i = from; i < lines.length; i++) {
    depth += count(lines[i], '{') - count(lines[i], '}')
    if (depth <= 0 && i >= from && (count(lines[i], '{') || count(lines[i], '}'))) return i
  }
  return -1
}

/**
 * The text of a feature model with `names` added as optional children of the root (the ones it has already are skipped). Returns the
 * same text when there is nothing to add or the model has no root to put them under.
 */
export const addFeatures = (text, names) => {
  const have = new Set(featureModelNames(text))
  const fresh = [...new Set(names)].filter((n) => isFeatureName(n) && !have.has(n))
  if (!fresh.length) return text
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n'
  const lines = String(text).split(/\r?\n/)
  const rootAt = lines.findIndex((l) => /^\s*feature\s+/.test(stripComment(l)))
  if (rootAt < 0) return text
  const indent = /^\s*/.exec(lines[rootAt])[0]
  const step = '  '
  const entries = (pad) => fresh.map((n) => `${pad}feature ${n}`)

  if (!count(lines[rootAt], '{')) {
    // `feature Root` alone: it gets a block
    lines.splice(rootAt, 1, `${lines[rootAt].trimEnd()} {`, `${indent}${step}optional {`, ...entries(`${indent}${step}${step}`), `${indent}${step}}`, `${indent}}`)
    return lines.join(eol)
  }
  const rootEnd = blockEnd(lines, rootAt)
  if (rootEnd < 0) return text
  if (rootEnd === rootAt) {
    // the root opens and closes on its own line (`feature Root { ... }` / `{}`): it is opened out
    const body = /^(.*?)\{(.*)\}\s*$/.exec(stripComment(lines[rootAt]))
    if (!body) return text
    const inner = body[2].trim()
    lines.splice(rootAt, 1, `${body[1].trimEnd()} {`, ...(inner ? [`${indent}${step}${inner}`] : []), `${indent}${step}optional {`, ...entries(`${indent}${step}${step}`), `${indent}${step}}`, `${indent}}`)
    return lines.join(eol)
  }
  // an `optional {` of the root itself (one level down): the new ones go at its end
  let depth = 0
  let optionalAt = -1
  for (let i = rootAt; i <= rootEnd; i++) {
    if (depth === 1 && /^\s*optional\s*\{/.test(stripComment(lines[i]))) { optionalAt = i; break }
    depth += count(lines[i], '{') - count(lines[i], '}')
  }
  if (optionalAt >= 0) {
    const optionalEnd = blockEnd(lines, optionalAt)
    if (optionalEnd < 0) return text
    const pad = `${/^\s*/.exec(lines[optionalAt])[0]}${step}`
    lines.splice(optionalEnd, 0, ...entries(pad))
    return lines.join(eol)
  }
  lines.splice(rootEnd, 0, `${indent}${step}optional {`, ...entries(`${indent}${step}${step}`), `${indent}${step}}`)
  return lines.join(eol)
}

/** What is wrong with the regions of a file, for the editor to mark: `[{ line, kind, feature? }]`. Names not loaded yet: no feature is judged. */
export const diagnose = (regions, names) => {
  const known = new Set(names)
  const out = []
  for (const region of regions) {
    if (region.unclosed) out.push({ line: region.startLine, kind: 'unclosed' })
    if (known.size) for (const feature of region.features) if (!known.has(feature) && !region.plainElse) out.push({ line: region.startLine, kind: 'unknown', feature })
  }
  return out
}

/** The features the code uses and the model does not declare. */
export const undeclared = (used, names) => { const known = new Set(names); return [...new Set(used)].filter((f) => !known.has(f) && isFeatureName(f)) }

const snippetEscape = (text) => text.replace(/[\\$}]/g, '\\$&')

/**
 * The suggestions for the line up to the cursor: `[{ label, insertText, snippet, detail, filterText, sortText, kind }]` (`kind` is
 * 'feature', 'snippet' or 'keyword'). Inside a marker it suggests the features and the shapes of a condition; outside, the snippets
 * that wrap code in a region.
 */
export const suggestions = ({ prefix, names, delimiters: [open, close] }) => {
  const features = names.slice(1) // the root is in every configuration: annotating with it makes no sense
  const lastOpen = prefix.lastIndexOf(open)
  const inside = lastOpen >= 0 && prefix.lastIndexOf(close) < lastOpen
  const choice = features.length ? `\${1|${features.map((n) => n.replace(/[,|\\]/g, '\\$&')).join(',')}|}` : '${1:Feature}'
  const list = []
  if (inside) {
    const code = prefix.slice(lastOpen + open.length)
    if (/feature\.[\w$]*$/.test(code)) {
      features.forEach((name, i) => list.push({ label: name, insertText: name, detail: 'feature', filterText: name, sortText: String(i).padStart(4, '0'), kind: 'feature' }))
      return list
    }
    features.forEach((name, i) => list.push({ label: `feature.${name}`, insertText: `feature.${name}`, detail: 'feature', filterText: `${name} feature.${name}`, sortText: String(i).padStart(4, '0'), kind: 'feature' }))
    list.push(
      { label: 'if (feature…) {', insertText: `if (feature.${choice}) {`, snippet: true, detail: 'region', filterText: 'if feature', sortText: '1000', kind: 'snippet' },
      { label: '} else {', insertText: '} else {', detail: 'else', filterText: '} else else', sortText: '1001', kind: 'keyword' },
      { label: '} else if (feature…) {', insertText: `} else if (feature.${choice}) {`, snippet: true, detail: 'else if', filterText: '} else if else if', sortText: '1002', kind: 'keyword' },
      { label: '}', insertText: '}', detail: 'end', filterText: '}', sortText: '1003', kind: 'keyword' },
    )
    return list
  }
  const o = snippetEscape(open)
  const c = snippetEscape(close)
  list.push(
    { label: 'feature-if', insertText: `${o} if (feature.${choice}) { ${c}\n\${TM_SELECTED_TEXT}$0\n${o} } ${c}`, snippet: true, detail: 'if (feature) { … }', filterText: 'feature-if', sortText: '0000', kind: 'snippet' },
    { label: 'feature-if-else', insertText: `${o} if (feature.${choice}) { ${c}\n\${TM_SELECTED_TEXT}$0\n${o} } else { ${c}\n\n${o} } ${c}`, snippet: true, detail: 'if (feature) { … } else { … }', filterText: 'feature-if-else', sortText: '0001', kind: 'snippet' },
  )
  return list
}
