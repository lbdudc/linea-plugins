import { test, expect } from 'vitest'
import { fuzzyMatch, rankFiles, parseQuickInput, searchText, replaceText, searchRegExp, nextRegionLine, nextFeatureLine } from '../../client/nav.js'

const files = ['src/app.js', 'src/nested.js', 'src/style.css', 'src/index.html', 'models/featuremodel.featuremodel', 'src/platform/config.json', 'spl.json']

test('fuzzy: letters in order, and a match in the name wins over one in the folders', () => {
  expect(fuzzyMatch('xyz', 'src/app.js')).toBeNull()
  expect(fuzzyMatch('ap', 'src/app.js').positions).toEqual([4, 5])
  expect(rankFiles('app', files)[0].path).toBe('src/app.js')
  expect(rankFiles('cfg', files)[0].path).toBe('src/platform/config.json')
  expect(rankFiles('SPL', files)[0].path).toBe('spl.json') // the shorter, with the match at the name's start
  expect(rankFiles('zzz', files)).toEqual([])
})

test('nothing typed: the recent files come first', () => {
  const ranked = rankFiles('', files, ['src/style.css', 'spl.json']).map((r) => r.path)
  expect(ranked.slice(0, 2)).toEqual(['src/style.css', 'spl.json'])
  expect(ranked).toHaveLength(files.length)
})

test('quick input: name, line and column', () => {
  expect(parseQuickInput('app.js:12:3')).toEqual({ query: 'app.js', line: 12, column: 3 })
  expect(parseQuickInput(':40')).toEqual({ query: '', line: 40, column: null })
  expect(parseQuickInput('app')).toEqual({ query: 'app', line: null, column: null })
})

test('search: case, whole word, regex, the line and column of each match', () => {
  const text = 'Hello hello\r\nhelloWorld\nsay hello'
  expect(searchText(text, { query: 'hello' }).map((m) => [m.line, m.column])).toEqual([[1, 1], [1, 7], [2, 1], [3, 5]])
  expect(searchText(text, { query: 'hello', caseSensitive: true }).map((m) => [m.line, m.column])).toEqual([[1, 7], [2, 1], [3, 5]])
  expect(searchText(text, { query: 'hello', word: true }).map((m) => m.line)).toEqual([1, 1, 3])
  expect(searchText(text, { query: 'h\\w+o', regex: true }).map((m) => m.length)).toEqual([5, 5, 7, 5]) // greedy: helloWorld up to its last o
  expect(searchText('a.b', { query: '.' }).map((m) => m.column)).toEqual([2]) // not a regex: the dot is a dot
  expect(searchText('abc', { query: 'x*', regex: true })).toEqual([]) // empty matches are not matches
  expect(searchText('aaaa', { query: 'a' }, { limit: 2 })).toHaveLength(2)
})

test('an invalid regex says so, an empty search is refused', () => {
  expect(() => searchRegExp({ query: '(', regex: true })).toThrow(expect.objectContaining({ invalid: true }))
  expect(() => searchRegExp({ query: '' })).toThrow(expect.objectContaining({ empty: true }))
})

test('replace keeps the line endings; $1 only counts in a regex', () => {
  expect(replaceText('a-1\r\nb-2\n', { query: '(\\w)-(\\d)', regex: true }, '$2$1')).toBe('1a\r\n2b\n')
  expect(replaceText('cost $5\ncost $5', { query: '$5' }, '$&$1')).toBe('cost $&$1\ncost $&$1')
  expect(replaceText('Foo foo', { query: 'foo', caseSensitive: true }, 'x')).toBe('Foo x')
})

test('next and previous region, coming round at the ends', () => {
  const regions = [{ startLine: 4, features: ['A'] }, { startLine: 9, features: ['B', 'A'] }, { startLine: 9, features: ['B'] }, { startLine: 15, features: ['B'] }]
  expect(nextRegionLine(regions, 1, 1)).toBe(4)
  expect(nextRegionLine(regions, 4, 1)).toBe(9)
  expect(nextRegionLine(regions, 15, 1)).toBe(4)
  expect(nextRegionLine(regions, 9, -1)).toBe(4)
  expect(nextRegionLine(regions, 4, -1)).toBe(15)
  expect(nextRegionLine([], 1)).toBeNull()
  expect(nextFeatureLine(regions, 'A', 4)).toBe(9)
  expect(nextFeatureLine(regions, 'A', 9)).toBe(4)
})
