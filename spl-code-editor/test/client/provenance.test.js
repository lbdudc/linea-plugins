import { describe, it, expect } from 'vitest'
import { execute } from '../../client/sandbox.js'
import { outputRows, explainRow, explainSource, decisionList, featuresOfCondition } from '../../client/provenance.js'

const D = ['###<', '>###']
const TEMPLATE = [
  'head',                              // 1
  '###< if (feature.A && feature.B) { >###', // 2
  'both ###<= data.name >###',        // 3
  '###< } else if (feature.C) { >###', // 4
  'only c',                            // 5
  '###< } else { >###',                // 6
  'neither',                           // 7
  '###< } >###',                       // 8
  '###< data.items.forEach(function (i) { >###', // 9
  'item ###<= i >###',                 // 10
  '###< }); >###',                     // 11
  'tail',                              // 12
].join('\n')
const run = (features) => {
  const r = execute({ text: TEMPLATE, fileName: 'f.txt', delimiters: D, features, data: { name: 'N', items: ['x', 'y'] }, debug: true })
  const out = r.outputs[0]
  return { out, rows: outputRows(out.content, out.provenance), prov: out.provenance }
}

describe('where each line of the product comes from', () => {
  it('adds up: the pieces make the whole output', () => {
    const { out, prov } = run(['A', 'B'])
    expect(prov).not.toBeNull()
    expect(prov.pieces.at(-1)[1]).toBe(out.content.length)
  })
  it('points every line to its line of the template, values to their expression', () => {
    const { rows } = run(['A', 'B'])
    const text = rows.map((r) => r.text)
    expect(text.slice(0, 2)).toEqual(['head', 'both N'])
    expect(rows[0].sources).toEqual([{ line: 1, kind: 'text' }])
    expect(rows[1].sources.map((s) => [s.line, s.kind])).toEqual([[3, 'text'], [3, 'value']])
    expect(rows[1].sources[1]).toMatchObject({ expr: 'data.name', value: '"N"' })
    const items = rows.filter((r) => r.text.startsWith('item'))
    expect(items.map((r) => r.text)).toEqual(['item x', 'item y'])
    expect(items[0].sources.some((s) => s.kind === 'value' && s.value === '"x"')).toBe(true)
  })
  it('says why a line is there: the conditions around it and what they were', () => {
    const { rows, prov } = run(['A', 'B'])
    const why = explainRow(rows[1], prov)
    expect(why.decisions).toHaveLength(1)
    expect(why.decisions[0]).toMatchObject({ kind: 'if', line: 2, condition: 'feature.A && feature.B', value: 'true' })
    expect(why.decisions[0].features).toEqual([{ name: 'A', on: true }, { name: 'B', on: true }])
  })
  it('an else branch says which branches came before it and were not taken', () => {
    const { rows, prov } = run([])
    const neither = rows.find((r) => r.text === 'neither')
    const why = explainRow(neither, prov)
    expect(why.decisions[0]).toMatchObject({ kind: 'else', line: 6 })
    // every branch of the chain before it, nearest first
    expect(why.decisions[0].after.map((a) => [a.line, a.value])).toEqual([[4, 'false'], [2, 'false']])
    expect(why.decisions[0].after[0].features).toEqual([{ name: 'C', on: false }])
  })
  it('for a line of the template, the lines it wrote; or the block that kept it out', () => {
    const { rows, prov } = run(['C'])
    expect(explainSource(1, rows, prov).produced).toEqual([1])
    const both = explainSource(3, rows, prov)
    expect(both.produced).toEqual([])
    expect(both.blockedBy).toMatchObject({ kind: 'if', startLine: 2, value: 'false' })
    const neither = explainSource(7, rows, prov)
    expect(neither.blockedBy).toMatchObject({ kind: 'else', startLine: 6 })
    expect(neither.blockedBy.previous).toMatchObject({ kind: 'elseif', value: 'true' })
  })
  it('lists the decisions with how many lines each wrote', () => {
    const { rows, prov } = run(['A', 'B'])
    const list = decisionList(rows, prov)
    const byKind = (k) => list.filter((b) => b.kind === k)
    expect(byKind('if')[0]).toMatchObject({ startLine: 2, value: 'true' })
    expect(byKind('if')[0].wrote).toBeGreaterThan(0)
    expect(byKind('elseif')[0].wrote).toBe(0)
    expect(byKind('else')[0].wrote).toBe(0)
  })
  it('reads the features of a condition', () => {
    expect(featuresOfCondition('feature.A && !feature.B_2 || data.x')).toEqual(['A', 'B_2'])
  })
})
