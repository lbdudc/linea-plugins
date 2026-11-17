import { test, expect } from 'vitest'
import { buildTree, regionAt } from '../../client/tree.js'

test('builds folders first, each level in name order', () => {
  const tree = buildTree(['z.md', 'src/b.js', 'src/a/c.js', 'a.txt'])
  expect(tree.map((n) => [n.name, n.folder])).toEqual([['src', true], ['a.txt', false], ['z.md', false]])
  expect(tree[0].children.map((n) => n.name)).toEqual(['a', 'b.js'])
  expect(tree[0].children[0].children[0].path).toBe('src/a/c.js')
})

test('the annotation to remove is the innermost one that holds the line, never an else branch', () => {
  const regions = [
    { startLine: 1, endLine: 10, expression: 'a' },
    { startLine: 3, endLine: 5, expression: 'b' },
    { startLine: 5, endLine: 8, expression: '!(b)', elseOf: 'b' },
  ]
  expect(regionAt(regions, 4).expression).toBe('b')
  expect(regionAt(regions, 6).expression).toBe('a')
  expect(regionAt(regions, 11)).toBeNull()
})
