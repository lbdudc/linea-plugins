import { test, expect } from 'vitest'
import { createIndexer } from '../../server/indexer.js'

// the collections as arrays: enough of the mongoose surface the indexer uses
const collection = () => {
  const rows = []
  const match = (row, q) => Object.entries(q).every(([k, v]) => (v && typeof v === 'object' && '$in' in v ? v.$in.includes(row[k]) : row[k] === v))
  return {
    rows,
    findOne: async (q) => rows.find((r) => match(r, q)) ?? null,
    find: (q) => { const found = rows.filter((r) => match(r, q)); const chain = { sort: () => chain, lean: async () => found, then: (res) => res(found) }; return chain },
    deleteMany: async (q) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], q)) rows.splice(i, 1) },
    insertMany: async (docs) => { rows.push(...docs.map((d) => ({ ...d }))) },
    updateOne: async (q, { $set }) => { const row = rows.find((r) => match(r, q)); if (row) Object.assign(row, $set); else rows.push({ ...q, ...$set }) },
  }
}

const b64 = (text) => Buffer.from(text).toString('base64')
const fakeCore = (repo) => ({
  gets: [],
  get: async function (_auth, path) {
    this.gets.push(path)
    const url = new URL(path, 'http://x')
    if (url.pathname.endsWith('/repo')) return { id: 7 }
    if (url.pathname.endsWith('/branch')) return { lastCommit: { id: repo.commit } }
    if (url.pathname.endsWith('/files')) return Object.keys(repo.files)
    if (url.pathname.endsWith('/file')) {
      const text = repo.files[url.searchParams.get('path')]
      if (text === undefined) throw Object.assign(new Error('nope'), { status: 404 })
      return { content: b64(text), encoding: 'base64', revision: `rev-${text.length}` }
    }
    throw new Error(`unexpected ${path}`)
  },
})

const setup = (repo) => {
  const models = { Annotation: collection(), FileIndex: collection(), IndexState: collection() }
  const core = fakeCore(repo)
  const indexer = createIndexer({ models, core, settings: () => ({ maxFileKb: 8, editableExtensions: ['java', 'json'], delimiters: '{}' }) })
  return { models, core, indexer }
}
const A = '/*% if (feature.x) { %*/\ncode\n/*% } %*/\n'

test('indexes the annotations of the editable files and groups them by feature', async () => {
  const { indexer, models } = setup({ commit: 'c1', files: { 'a.java': A, 'b.png': 'zzz', 'src/platform/config.json': '{"delimiters":[]}' } })
  await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })
  expect(models.Annotation.rows).toHaveLength(1)
  expect(await indexer.byFeature({ lineId: 'L', ref: 'main' })).toEqual({ x: [{ path: 'a.java', startLine: 1, endLine: 3, expression: 'x' }] })
})

test('the same commit is not read again; a push makes the index stale; a changed file is parsed again', async () => {
  const repo = { commit: 'c1', files: { 'a.java': A } }
  const { indexer, core } = setup(repo)
  await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })
  const reads = core.gets.length
  expect((await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })).reused).toBe(true)
  expect(core.gets.length).toBe(reads + 2) // the repository and the branch only

  await indexer.invalidate({ repositoryId: 7, branch: 'main' })
  repo.commit = 'c2'
  repo.files['a.java'] = '/*% if (feature.y) { %*/\nz\n/*% } %*/\nmore\n'
  const result = await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })
  expect(result.reparsed).toBe(1)
  expect(Object.keys(await indexer.byFeature({ lineId: 'L', ref: 'main' }))).toEqual(['y'])
})

test('emptying the collections and indexing again gives the same annotations; deleted files leave the index', async () => {
  const repo = { commit: 'c1', files: { 'a.java': A, 'b.java': A.replace('x', 'q') } }
  const { indexer, models } = setup(repo)
  await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })
  const before = JSON.stringify(await indexer.byFeature({ lineId: 'L', ref: 'main' }))
  await indexer.clear({ lineId: 'L' })
  expect(models.Annotation.rows).toHaveLength(0)
  await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })
  expect(JSON.stringify(await indexer.byFeature({ lineId: 'L', ref: 'main' }))).toBe(before)

  delete repo.files['b.java']; repo.commit = 'c2'
  await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })
  expect(Object.keys(await indexer.byFeature({ lineId: 'L', ref: 'main' }))).toEqual(['x'])
})

test('a file over the size limit is not indexed', async () => {
  const { indexer, models } = setup({ commit: 'c1', files: { 'big.java': A + 'x'.repeat(9 * 1024) } })
  await indexer.ensure({ auth: 't', lineId: 'L', ref: 'main' })
  expect(models.Annotation.rows).toHaveLength(0)
})
