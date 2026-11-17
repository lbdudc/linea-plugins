import { test, expect } from 'vitest'
import { colorMap, regionChains, decorationRuns, lookOf, PRESETS, presetIds, rgb, css } from '../../client/colors.js'
import { parseAnnotations } from '../../shared/parser.js'

const code = [
  'a',                           // 1
  '/*% if (feature.Export) { %*/', // 2
  'b',                           // 3
  '/*% if (feature.Dark && feature.Wide) { %*/', // 4
  'c',                           // 5
  '/*% } %*/',                   // 6
  '/*% } else { %*/',            // 7
  'd',                           // 8
  '/*% } %*/',                   // 9
  'e',
].join('\n')

test('a feature keeps its color and neighbours differ', () => {
  const map = colorMap(['A', 'B', 'C', 'A'])
  expect(Object.keys(map)).toEqual(['A', 'B', 'C'])
  expect(new Set(Object.values(map)).size).toBe(3)
  expect(colorMap(['A', 'B', 'C']).B).toEqual(map.B)
})

test('the chain of a line is its regions, outermost first; an else line counts only for the else', () => {
  const chains = regionChains(parseAnnotations(code), 10)
  expect(chains[1]).toEqual([])
  expect(chains[3].map((r) => r.expression)).toEqual(['Export'])
  expect(chains[5].map((r) => r.expression)).toEqual(['Export', 'Dark && Wide'])
  expect(chains[7].map((r) => r.expression)).toEqual(['!(Export)'])
  expect(chains[8].map((r) => r.elseOf)).toEqual(['Export'])
})

test('runs join lines that look the same and tell markers apart', () => {
  const runs = decorationRuns(parseAnnotations(code), 10).map((r) => [r.from, r.to, r.marker])
  expect(runs).toEqual([[2, 2, true], [3, 3, false], [4, 4, true], [5, 5, false], [6, 6, true], [7, 7, true], [8, 8, false], [9, 9, true]])
})

test('the look has a stripe per level, hatches an else and splits a compound expression', () => {
  const colors = colorMap(['Export', 'Dark', 'Wide'])
  const regions = parseAnnotations(code)
  const [, , , , five, , seven] = decorationRuns(regions, 10).map((r) => lookOf(r.chain, r.marker, colors))
  expect(five.margin.match(/no-repeat/g)).toHaveLength(2)
  expect(five.margin).toContain('5px 0')
  expect(seven.background).toContain('repeating-linear-gradient')
  expect(five.background).toContain('90deg') // Dark && Wide
})

// the perceptual distance of two colors ("redmean"): about 100 is clearly different at a glance, under 50 is easy to mistake
const distance = (a, b) => {
  const [r1, g1, b1] = rgb(a); const [r2, g2, b2] = rgb(b)
  const r = (r1 + r2) / 2
  return Math.sqrt((2 + r / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - r) / 256) * (b1 - b2) ** 2)
}

test.each(presetIds)('preset %s: every color is told apart from every other', (id) => {
  const list = PRESETS[id]
  expect(new Set(list).size).toBe(list.length)
  const worst = []
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) worst.push([distance(list[i], list[j]), list[i], list[j]])
  worst.sort((a, b) => a[0] - b[0])
  expect(worst[0][0], `closest pair ${worst[0][1]} ${worst[0][2]}`).toBeGreaterThan(id === 'pastel' ? 60 : 70) // pastels are close by nature
})

test('neighbours in a preset are well apart, since they are the ones that nest', () => {
  for (const id of presetIds) {
    const list = PRESETS[id]
    for (let i = 1; i < list.length; i++) expect(distance(list[i - 1], list[i]), `${id} ${i}`).toBeGreaterThan(100)
  }
})

test('however many features there are, every one gets its own color, never white or black', () => {
  const names = Array.from({ length: 400 }, (_, i) => `F${i}`)
  for (const preset of presetIds) {
    const colors = Object.values(colorMap(names, preset))
    expect(new Set(colors).size).toBe(400)
    for (const c of colors) { const [r, g, b] = rgb(c); const lum = (r + g + b) / 3; expect(lum).toBeGreaterThan(40); expect(lum).toBeLessThan(235) }
  }
})

test('past the end of a preset the colors keep coming, not repeated', () => {
  const names = Array.from({ length: 30 }, (_, i) => `F${i}`)
  const map = colorMap(names, 'colorblind')
  expect(new Set(Object.values(map)).size).toBe(30)
  expect(colorMap(['A'], 'no-such-preset').A).toBe(colorMap(['A']).A)
})

test('css writes an opacity', () => { expect(css('#ff0000', 0.5)).toBe('rgb(255 0 0 / 0.5)') })
