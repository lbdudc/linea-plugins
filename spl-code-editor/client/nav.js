// Moving around the code like in an IDE: finding a file by a few letters, searching (and replacing) in text, jumping between regions.
// Pure functions: the editor asks them, they touch nothing.

const BOUNDARY = /[/._\-\s]/

/** Where `query` fits in `text` as a subsequence: `{ score, positions }` or null. Consecutive letters and word starts score more. */
const subsequence = (query, text, offset = 0) => {
  const positions = []
  let score = 0
  let from = 0
  let previous = -2
  for (const ch of query) {
    const at = text.indexOf(ch, from)
    if (at < 0) return null
    let gain = 1
    if (at === previous + 1) gain += 4
    if (at === 0 || BOUNDARY.test(text[at - 1])) gain += 3
    score += gain
    positions.push(at + offset)
    previous = at
    from = at + 1
  }
  return { score, positions }
}

/** `{ score, positions }` of a path for what was typed, or null when its letters are not in it in order. A match in the file's name wins. */
export const fuzzyMatch = (query, path) => {
  const q = String(query).toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, positions: [] }
  const lower = path.toLowerCase()
  const base = lower.lastIndexOf('/') + 1
  const inName = subsequence(q, lower.slice(base), base)
  if (inName) {
    const exact = lower.slice(base).includes(q) ? 12 : 0
    const prefix = lower.slice(base).startsWith(q) ? 8 : 0
    return { score: 20 + inName.score + exact + prefix, positions: inName.positions }
  }
  return subsequence(q, lower)
}

/** The files for what was typed, best first: `[{ path, positions }]`. Nothing typed lists the recent files first, then the rest in order. */
export const rankFiles = (query, paths, recent = []) => {
  const order = (path) => { const at = recent.indexOf(path); return at < 0 ? Infinity : at }
  if (!String(query).trim()) {
    return [...paths].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((path) => ({ path, positions: [] }))
  }
  return paths
    .map((path) => ({ path, match: fuzzyMatch(query, path) }))
    .filter((r) => r.match)
    .sort((a, b) => b.match.score - a.match.score || order(a.path) - order(b.path) || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .map((r) => ({ path: r.path, positions: r.match.positions }))
}

/** `app.js:12:3` -> `{ query: 'app.js', line: 12, column: 3 }` (`:12` alone is a line of the open file). */
export const parseQuickInput = (text) => {
  const m = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(String(text).trim())
  return { query: m[1].trim(), line: m[2] ? Number(m[2]) : null, column: m[3] ? Number(m[3]) : null }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The RegExp of a search; throws an Error with `invalid` when the pattern is not one. */
export const searchRegExp = ({ query, caseSensitive = false, regex = false, word = false }) => {
  if (!query) throw Object.assign(new Error('Nothing to search'), { empty: true })
  let source = regex ? query : escapeRegExp(query)
  if (word) source = `\\b(?:${source})\\b`
  try { return new RegExp(source, caseSensitive ? 'g' : 'gi') } catch (error) { throw Object.assign(new Error(error.message), { invalid: true }) }
}

/** The matches of a search in a text, by line: `[{ line, column, length, preview }]` (1-based; an empty match is skipped). */
export const searchText = (text, options, { limit = 200 } = {}) => {
  const re = searchRegExp(options)
  const found = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length && found.length < limit; i++) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(lines[i])) && found.length < limit) {
      if (!m[0].length) { re.lastIndex++; continue }
      found.push({ line: i + 1, column: m.index + 1, length: m[0].length, preview: lines[i] })
    }
  }
  return found
}

/** `text` with every match of a search replaced, line by line as the search reads it (`$1` works when the search is a regex). */
export const replaceText = (text, options, replacement) => {
  const re = searchRegExp(options)
  const apply = options.regex ? (line) => line.replace(re, replacement) : (line) => line.replace(re, () => replacement)
  return String(text).split(/(\r?\n)/).map((part, i) => (i % 2 ? part : apply(part))).join('')
}

/** The line of the region that opens after (`direction` 1) or before (-1) `line`, coming round at the ends; null with no regions. */
export const nextRegionLine = (regions, line, direction = 1) => {
  const starts = [...new Set(regions.map((r) => r.startLine))].sort((a, b) => a - b)
  if (!starts.length) return null
  if (direction >= 0) return starts.find((s) => s > line) ?? starts[0]
  return [...starts].reverse().find((s) => s < line) ?? starts[starts.length - 1]
}

/** The line of the next region of a feature (one that holds it in its expression), coming round at the end. */
export const nextFeatureLine = (regions, feature, line) => nextRegionLine(regions.filter((r) => r.features.includes(feature)), line, 1)
