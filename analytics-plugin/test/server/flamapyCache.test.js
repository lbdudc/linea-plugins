import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetAnalyses, runBddAnalysis, runFullAnalysis } from '../../server/flamapy.js'

const UVL = 'features\n  Root\n    mandatory\n      A\n'

let calls
beforeEach(() => {
  forgetAnalyses()
  calls = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    calls += 1
    return { ok: true, json: async () => ({ satisfiable: true }) }
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('the analyses are kept by what was asked', () => {
  it('asks the service once for the same model and solver, and says when it was computed', async () => {
    const first = await runFullAnalysis(UVL, 'SAT')
    const second = await runFullAnalysis(UVL, 'SAT')

    expect(calls).toBe(1)
    expect(second).toEqual(first)
    expect(Number.isNaN(Date.parse(first._computedAt))).toBe(false)
  })

  it('asks again for another model, another solver, or the BDD pass', async () => {
    await runFullAnalysis(UVL, 'SAT')
    await runFullAnalysis(UVL, 'BDD')
    await runFullAnalysis(`${UVL}      B\n`, 'SAT')
    await runBddAnalysis(UVL)

    expect(calls).toBe(4)
  })

  it('shares a request that is already running', async () => {
    await Promise.all([runFullAnalysis(UVL, 'SAT'), runFullAnalysis(UVL, 'SAT'), runFullAnalysis(UVL, 'SAT')])

    expect(calls).toBe(1)
  })

  it('does not keep a failure', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })

    await expect(runFullAnalysis(UVL, 'SAT')).rejects.toThrow('flamapy-server 500')
    await expect(runFullAnalysis(UVL, 'SAT')).resolves.toMatchObject({ satisfiable: true })
  })
})
