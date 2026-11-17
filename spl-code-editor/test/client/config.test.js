import { test, expect, describe, it } from 'vitest';
import { evalExpression, inactiveRanges, inactiveSpans, summary } from '../../client/config.js'
import { parseAnnotations } from '../../shared/parser.js'

test('conditions of names are evaluated, anything else is left alone', () => {
  const on = new Set(['A'])
  expect(evalExpression('A', on)).toBe(true)
  expect(evalExpression('A && !B', on)).toBe(true)
  expect(evalExpression('!(A) || B', on)).toBe(false)
  expect(evalExpression('A.length > 1', on)).toBeNull()
  expect(evalExpression('alert(1)', on)).toBeNull()
  expect(evalExpression('', on)).toBeNull()
  expect(evalExpression('A &&', on)).toBeNull()
})

test('regions that are off, nested ones and else branches included', () => {
  const text = ['/*% if (feature.A) { %*/', 'a', '/*% if (feature.B) { %*/', 'b', '/*% } %*/', '/*% } else { %*/', 'c', '/*% } %*/'].join('\n')
  const regions = parseAnnotations(text)
  expect(inactiveRanges(regions, new Set(['A', 'B']))).toEqual([{ startLine: 6, endLine: 8 }])
  expect(inactiveRanges(regions, new Set(['A']))).toEqual([{ startLine: 3, endLine: 5 }, { startLine: 6, endLine: 8 }])
  expect(inactiveRanges(regions, new Set())).toEqual([{ startLine: 1, endLine: 6 }, { startLine: 3, endLine: 5 }])
})

test('the summary splits the features a file uses', () => {
  expect(summary(['A', 'B', 'C'], new Set(['B']))).toEqual({ on: ['B'], off: ['A', 'C'] })
})

describe('what a configuration leaves out, branch by branch', () => {
  const D = ['/*%', '%*/']
  const text = (lines) => lines.join('\n')
  const off = (src, features) => inactiveRanges(parseAnnotations(src, { delimiters: D }), new Set(features)).map((r) => [r.startLine, r.endLine])

  it('writes only the first branch of a chain that holds', () => {
    const src = text(['/*% if (feature.A) { %*/', 'a', '/*% } else if (feature.B) { %*/', 'b', '/*% } else { %*/', 'c', '/*% } %*/'])
    expect(off(src, ['A', 'B'])).toEqual([[3, 5], [5, 7]])
    expect(off(src, ['B'])).toEqual([[1, 3], [5, 7]])
    expect(off(src, [])).toEqual([[1, 3], [3, 5]])
  })
  it('a loop does not close somebody else\'s region', () => {
    const src = text(['/*% if (feature.A) { %*/', '/*% items.forEach(function (i) { %*/', 'x', '/*% }); %*/', 'y', '/*% } %*/'])
    const regions = parseAnnotations(src, { delimiters: D })
    expect(regions).toHaveLength(1)
    expect([regions[0].startLine, regions[0].endLine, regions[0].unclosed]).toEqual([1, 6, undefined])
  })
  it('an if with statements after its brace is still a region', () => {
    const src = text(['/*% if (feature.A) { var q = 1; %*/', 'a', '/*% } %*/'])
    expect(parseAnnotations(src, { delimiters: D })).toHaveLength(1)
  })
  it('only what a region holds is off: code after its closing marker on the same line stays', () => {
    const src = 'x /*% if (feature.A) { %*/ hidden /*% } %*/ shown'
    const spans = inactiveSpans(parseAnnotations(src, { delimiters: D }), new Set())
    let kept = src
    for (const s of spans.reverse()) kept = kept.slice(0, s.from) + kept.slice(s.to)
    expect(kept.replace(/\/\*%[\s\S]*?%\*\//g, '').replace(/\s+/g, ' ')).toBe('x shown')
  })
  it('reads conditions with strings, parentheses and braces inside', () => {
    const src = text(['/*% if (data.langs.find(function (l) { return l == "}"; }) && feature.A) { %*/', 'a', '/*% } %*/'])
    const [r] = parseAnnotations(src, { delimiters: D })
    expect(r.features).toEqual(['A'])
    expect(r.unclosed).toBeUndefined()
  })
})
