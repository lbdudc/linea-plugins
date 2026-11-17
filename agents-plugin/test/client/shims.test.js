import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeApi, setClient } from '../../client/agents/api/http.js'
import { loadingStore } from '../../client/agents/stores/loadingStore.js'

const calls = []
const client = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map((m) => [m, vi.fn(async (...args) => { calls.push([m, ...args]); return { data: { ok: true } } })]))

beforeEach(() => { calls.length = 0; setClient(client) })

describe('how the agents\' pages reach the agents: through LINEA, with its session', () => {
  it('a call goes to the plugin\'s door on LINEA\'s API, with the path the service knows', async () => {
    const api = makeApi('')
    await api.get('/agents/runs', { params: { lineId: 'L1' } })
    await api.post('/agents/runs', { agentType: 'sync' })
    await api.delete('/agents/runs/r1')

    expect(calls).toEqual([
      ['get', '/plugins/agents-plugin/api/agents/runs', { params: { lineId: 'L1' } }],
      ['post', '/plugins/agents-plugin/api/agents/runs', { agentType: 'sync' }],
      ['delete', '/plugins/agents-plugin/api/agents/runs/r1'],
    ])
  })

  it('the client of what the agents ask of LINEA has its own part of the path', async () => {
    await makeApi('/agents/linea').get('/lines/L1')
    expect(calls[0]).toEqual(['get', '/plugins/agents-plugin/api/agents/linea/lines/L1'])
  })

  it('the loading bar runs while the call does, and also when it fails', async () => {
    const start = vi.spyOn(loadingStore, 'start')
    const stop = vi.spyOn(loadingStore, 'stop')
    client.get.mockRejectedValueOnce(new Error('503'))

    await expect(makeApi('').get('/agents')).rejects.toThrow('503')

    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('says so when the pages are used before the plugin gave the client', () => {
    setClient(null)
    expect(() => makeApi('').get('/agents')).toThrow(/before the plugin loaded/)
  })
})
