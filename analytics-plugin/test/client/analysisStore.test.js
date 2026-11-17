import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analysisFor, forgetAnalysis, runAnalysis, setApi } from '../../client/analysisStore'

// the editor used to decide this itself: a service that is down is not a model that is wrong
const post = vi.fn()
const say = vi.fn()
const t = (key) => key

const analyse = async () => {
  await runAnalysis({ lineId: 'l1', uvl: 'features\n  root\n', say, t })
  return analysisFor('l1')
}

beforeEach(() => {
  forgetAnalysis('l1')
  post.mockReset()
  say.mockReset()
  setApi({ post })
})

describe('the analysis of the feature model of a line', () => {
  it('a model that analyses is valid, and the BDD pass follows in the background', async () => {
    post.mockResolvedValueOnce({ data: { coreFeatures: ['root'], _solveMode: 'SAT' } }).mockResolvedValueOnce({ data: { configsNumber: 1, _skipped: [] } })
    const state = await analyse()

    expect(state.modelInvalid).toBe('no')
    expect(state.modeTabs).toBe('SAT')
    expect(post.mock.calls[0][0]).toBe('/plugins/analytics-plugin/analyze')
    await vi.waitFor(() => expect(state.flamapyResults.configsNumber).toBe(1))
  })

  it('no answer from the server: the service is unavailable, the model is not invalid', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'))
    const state = await analyse()

    expect(state.unavailable).toBe(true)
    expect(state.modelInvalid).not.toBe('yes')
  })

  it('503 from the service: unavailable, not invalid', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { response: { status: 503, data: {} } }))
    const state = await analyse()

    expect(state.unavailable).toBe(true)
    expect(state.modelInvalid).not.toBe('yes')
  })

  it('code ANALYSIS_UNAVAILABLE: unavailable, not invalid', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('down'), { response: { status: 500, data: { code: 'ANALYSIS_UNAVAILABLE' } } }))
    const state = await analyse()

    expect(state.unavailable).toBe(true)
    expect(state.modelInvalid).not.toBe('yes')
  })

  it('a badly formed model (400 with no outage code) is invalid, not an outage', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('Bad model'), { response: { status: 400, data: { detail: 'syntax error' } } }))
    const state = await analyse()

    expect(state.modelInvalid).toBe('yes')
    expect(state.unavailable).toBe(false)
    expect(say).toHaveBeenCalledWith('negative', 'error_messages.invalid_model: syntax error', 4000)
  })
})
