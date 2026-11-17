import { describe, it, expect } from 'vitest'
import { snapshot, same, describe as words, record, step, canBack, canForward, save, remove, read } from '../../client/scenarios.js'

const S = (features, name = 'x', overrides = {}) => snapshot({ features, data: JSON.stringify({ basicData: { name } }), overrides })

describe('scenarios', () => {
  it('compares scenarios by what they say, not by the order of the features', () => {
    expect(same(S(['B', 'A']), S(['A', 'B']))).toBe(true)
    expect(same(S(['A']), S(['A'], 'y'))).toBe(false)
    expect(same(S(['A']), S(['A'], 'x', { 'a.b': 1 }))).toBe(false)
  })
  it('says a scenario in a few words', () => {
    expect(words(S(['A', 'B'], 'demo', { v: 1 }))).toBe('2 features · "demo" · 1 changed')
  })
  it('keeps a history, newest first, without repeating the one it is on', () => {
    let h = record({}, S(['A']))
    h = record(h, S(['A']))
    h = record(h, S(['A', 'B']))
    expect(h.recent.map((s) => s.features.length)).toEqual([2, 1])
  })
  it('walks back and forth, and forgets what was ahead when something new is reached', () => {
    let h = { recent: [S(['A', 'B']), S(['A']), S([])], cursor: 0 }
    expect(canBack(h)).toBe(true); expect(canForward(h)).toBe(false)
    h = { ...h, cursor: step(h, 1) }
    h = { ...h, cursor: step(h, 1) }
    expect(h.cursor).toBe(2)
    expect(step(h, 1)).toBe(2) // nowhere older
    h = { ...h, cursor: step(h, -1) }
    expect(canForward(h)).toBe(true)
    h = record(h, S(['C']))
    expect(h.recent.map((s) => s.features.join())).toEqual(['C', 'A', ''])
    expect(h.cursor).toBe(0)
  })
  it('keeps named scenarios, replacing one that has the same name', () => {
    let saved = save([], 'small', S(['A']))
    saved = save(saved, 'big', S(['A', 'B']))
    saved = save(saved, 'small', S(['Z']))
    expect(saved.map((s) => s.name)).toEqual(['small', 'big'])
    expect(saved[0].snap.features).toEqual(['Z'])
    expect(remove(saved, 'big').map((s) => s.name)).toEqual(['small'])
    expect(save(saved, '   ', S([]))).toBe(saved)
  })
  it('reads what was kept and ignores what is broken', () => {
    expect(read('nonsense')).toEqual({ recent: [], cursor: 0, saved: [] })
    const kept = read(JSON.stringify({ recent: [S(['A']), { nope: 1 }], saved: [{ name: 'n', snap: S(['B']) }, { name: 3 }] }))
    expect(kept.recent).toHaveLength(1)
    expect(kept.saved.map((s) => s.name)).toEqual(['n'])
  })
})
