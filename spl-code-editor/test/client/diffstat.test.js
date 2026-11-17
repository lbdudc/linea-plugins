import { test, expect } from 'vitest'
import { lineStats } from '../../client/diffstat.js'

test('lines added and removed between two texts', () => {
  expect(lineStats('', 'a\nb')).toEqual({ added: 2, removed: 0 })
  expect(lineStats('a\nb', '')).toEqual({ added: 0, removed: 2 })
  expect(lineStats('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 })
  expect(lineStats('a\nb\nc', 'a\nX\nc')).toEqual({ added: 1, removed: 1 })
  expect(lineStats('a\nb', 'a\nb\nh1 {}')).toEqual({ added: 1, removed: 0 })
  expect(lineStats('a\r\nb', 'a\nb')).toEqual({ added: 0, removed: 0 })
  expect(lineStats('a\nb\nc\nd', 'b\nd\ne')).toEqual({ added: 1, removed: 2 })
})

test('a very big change still answers, by the lines in common', () => {
  const x = Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n')
  const y = Array.from({ length: 3000 }, (_, i) => `m${i}`).join('\n')
  expect(lineStats(x, y)).toEqual({ added: 3000, removed: 3000 })
})
