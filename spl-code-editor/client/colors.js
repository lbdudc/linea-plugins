// Colors of the features in the editor. A feature always has the same color: it comes from its place in the list of names (the feature
// model's order, then the ones only the code mentions), taken from a preset palette of hand-picked colors that differ from one another.
// Nesting is not blended: a line is tinted with its innermost region and the margin carries one stripe per enclosing region.

/** The presets: each is a list of colors in the order they are handed out, chosen so that neighbours are easy to tell apart. */
export const PRESETS = {
  vivid: ['#4f8cff', '#ff8a3d', '#22c55e', '#e5484d', '#a76bff', '#f5c518', '#14b8d4', '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#fb7185'],
  // Okabe-Ito: the set designed to stay apart for the most common color blindness
  colorblind: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#9aa0a6'],
  pastel: ['#8ecae6', '#ffb4a2', '#b7e4c7', '#cdb4db', '#ffd6a5', '#f4a6c6', '#e9ed8f'],
  earth: ['#c2703d', '#3a9d8f', '#e0b84a', '#8d5a97', '#6a994e', '#c0463f', '#457b9d', '#a98467', '#7a8b99', '#d18b9a'],
  neon: ['#00e5ff', '#ff2e88', '#c6ff00', '#ff9100', '#b388ff', '#1de9b6', '#ff5252', '#448aff', '#ffea00', '#e040fb'],
}
/** How strongly a preset tints the code: soft colors need more opacity to show on the editor, neon needs less. */
export const STRENGTH = { vivid: 1, colorblind: 1.1, pastel: 1.4, earth: 1.25, neon: 0.8 }
export const DEFAULT_PRESET = 'vivid'
export const presetIds = Object.keys(PRESETS)

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
export const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const toHex = (c) => `#${c.map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`

// past the end of a preset: hues spread by the golden angle (so neighbours in the list are far apart on the wheel), at three lightnesses
// taken in turn, kept inside a range that shows on both a light and a dark editor. Never white, never black, however many features.
const hsl = (h, s, l) => {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255])
}
const GOLDEN = 137.508
const LIGHTNESS = [54, 44, 63]

/** `{ name: hex }` for the names, in order (a name repeated keeps its first place). Past the end of the preset the colors keep coming, all different. */
export const colorMap = (names, preset = DEFAULT_PRESET) => {
  const palette = PRESETS[preset] ?? PRESETS[DEFAULT_PRESET]
  const map = {}
  let index = 0
  for (const name of names) {
    if (name in map) continue
    map[name] = index < palette.length ? palette[index] : hsl(((index - palette.length) * GOLDEN + 20) % 360, 68, LIGHTNESS[(index - palette.length) % LIGHTNESS.length])
    index++
  }
  return map
}

/** `hex` as a CSS color with an opacity. */
export const css = (hex, alpha = 1) => { const [r, g, b] = rgb(hex); return `rgb(${r} ${g} ${b} / ${alpha})` }

export const FALLBACK = '#4f8cff'
// the color of a condition that names no feature (`if (data.langs.length > 1) {`): it is not a feature, so it is not any feature's color
export const NEUTRAL = '#8b93a1'

/**
 * For each line (1-based index) of a file, the regions around it, outermost first: `[[], [A], [A, B], ...]`. The line of a
 * `} else {` closes the `if` and opens the `else`; only the `else` counts there.
 */
export const regionChains = (regions, lineCount) => {
  const lines = Array.from({ length: lineCount + 1 }, () => [])
  for (const region of regions) for (let line = region.startLine; line <= Math.min(region.endLine, lineCount); line++) lines[line].push(region)
  for (let line = 1; line <= lineCount; line++) {
    const chain = lines[line]
    lines[line] = chain.filter((region) => !(region.endLine === line && chain.some((other) => other !== region && other.startLine === line && other.elseOf !== undefined)))
  }
  return lines
}

const layer = (value) => `linear-gradient(${value}, ${value})`

const tint = (colors, alpha) => (colors.length === 1 ? layer(css(colors[0], alpha)) : `linear-gradient(90deg, ${colors.map((c) => css(c, alpha)).join(', ')})`)
const stripe = (colors, x) => {
  const image = colors.length === 1 ? layer(css(colors[0])) : `linear-gradient(to bottom, ${colors.map((c, i) => `${css(c)} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`
  return `${image} ${x}px 0 / 3px 100% no-repeat`
}

/** The CSS of a line's look: `{ background, margin }`, from the chain of regions (`{ features, elseOf }`) and whether it holds a marker. */
export const lookOf = (chain, marker, colors, strength = 1) => {
  const paint = (region) => (region.features.length ? region.features.map((name) => colors[name] ?? FALLBACK) : [NEUTRAL])
  const inner = chain[chain.length - 1]
  const innerColors = paint(inner)
  const layers = []
  if (inner.elseOf !== undefined) layers.push(`repeating-linear-gradient(135deg, transparent 0 5px, ${css(innerColors[0], Math.min(0.5, 0.2 * strength))} 5px 7px)`)
  layers.push(tint(innerColors, Math.min(0.6, (marker ? 0.3 : 0.14) * strength)))
  return { background: layers.join(', '), margin: chain.map((region, i) => stripe(paint(region), i * 5)).join(', ') }
}

/**
 * The decorations of a file as runs of lines with the same look: `[{ from, to, key, chain, marker }]`. `key` is the same for the
 * same look, so a stylesheet needs one rule per key.
 */
export const decorationRuns = (regions, lineCount) => {
  const chains = regionChains(regions, lineCount)
  const runs = []
  for (let line = 1; line <= lineCount; line++) {
    const chain = chains[line]
    if (!chain.length) continue
    const marker = chain.some((r) => r.startLine === line || r.endLine === line)
    const key = `${marker ? 'm' : 'b'}:${chain.map((r) => `${r.elseOf !== undefined ? '!' : ''}${r.features.join('+')}`).join('>')}`
    const last = runs[runs.length - 1]
    if (last && last.key === key && last.to === line - 1) last.to = line
    else runs.push({ from: line, to: line, key, chain, marker })
  }
  return runs
}
