import { test, expect } from 'vitest'
import { derivedPath, featureModelNames, addFeatures, diagnose, undeclared, suggestions } from '../../client/assist.js'
import { annotateRange, parseAnnotations } from '../../shared/parser.js'

test('only src/platform/code is derived, and it lands at the root of the product', () => {
  expect(derivedPath('src/platform/code/app.js')).toBe('app.js')
  expect(derivedPath('src/platform/code/ci/test.sh')).toBe('ci/test.sh')
  expect(derivedPath('src/app.js')).toBeNull()
  expect(derivedPath('src/platform/code/')).toBeNull()
  expect(derivedPath(null)).toBeNull()
})

test('names of a feature model, root first', () => {
  const text = 'featuremodel Demo\nfeature Demo {\n  optional {\n    feature Dark // theme\n    feature Export {\n      optional { feature Admin }\n    }\n  }\n}\n'
  expect(featureModelNames(text)).toEqual(['Demo', 'Dark', 'Export', 'Admin'])
})

test('adding features: to a bare root, to an optional block, to a root without one', () => {
  expect(addFeatures('featuremodel D\nfeature D\n', ['Dark', 'Export'])).toBe('featuremodel D\nfeature D {\n  optional {\n    feature Dark\n    feature Export\n  }\n}\n')
  const withOptional = 'featuremodel D\nfeature D {\n  optional {\n    feature A {\n      optional {\n        feature B\n      }\n    }\n  }\n}\n'
  expect(addFeatures(withOptional, ['C'])).toBe('featuremodel D\nfeature D {\n  optional {\n    feature A {\n      optional {\n        feature B\n      }\n    }\n    feature C\n  }\n}\n')
  const mandatoryOnly = 'featuremodel D\nfeature D {\n  mandatory {\n    feature M\n  }\n}\n'
  expect(addFeatures(mandatoryOnly, ['X'])).toBe('featuremodel D\nfeature D {\n  mandatory {\n    feature M\n  }\n  optional {\n    feature X\n  }\n}\n')
})

test('adding skips what is there and what is not a name, and keeps the line endings', () => {
  const text = 'featuremodel D\r\nfeature D {\r\n  optional {\r\n    feature A\r\n  }\r\n}\r\n'
  expect(addFeatures(text, ['A', 'not a name', '1x'])).toBe(text)
  expect(addFeatures(text, ['B'])).toBe('featuremodel D\r\nfeature D {\r\n  optional {\r\n    feature A\r\n    feature B\r\n  }\r\n}\r\n')
  expect(addFeatures('', ['A'])).toBe('')
})

test('what the editor marks: features the model does not have, regions never closed', () => {
  const regions = parseAnnotations('/*% if (feature.Dark && feature.Nope) { %*/\nx\n/*% } %*/\n/*% if (feature.Dark) { %*/\ny')
  expect(diagnose(regions, ['D', 'Dark'])).toEqual([{ line: 1, kind: 'unknown', feature: 'Nope' }, { line: 4, kind: 'unclosed' }])
  expect(diagnose(regions, [])).toEqual([{ line: 4, kind: 'unclosed' }]) // names not loaded: no judgement on features
  expect(undeclared(['Dark', 'Nope', 'Nope', 'bad name'], ['D', 'Dark'])).toEqual(['Nope'])
})

test('suggestions: after feature. the names, in a marker the shapes of a condition, outside the snippets', () => {
  const names = ['Root', 'Dark', 'Export']
  const delimiters = ['/*%', '%*/']
  expect(suggestions({ prefix: '/*% if (feature.', names, delimiters }).map((s) => s.label)).toEqual(['Dark', 'Export'])
  const inside = suggestions({ prefix: '/*% ', names, delimiters }).map((s) => s.label)
  expect(inside).toContain('feature.Dark')
  expect(inside).toContain('} else {')
  expect(inside).not.toContain('feature.Root')
  const outside = suggestions({ prefix: '  ', names, delimiters })
  expect(outside.map((s) => s.label)).toEqual(['feature-if', 'feature-if-else'])
  expect(outside[0].insertText).toContain('${1|Dark,Export|}')
  expect(outside[0].insertText.startsWith('/*% if (feature.')).toBe(true)
  // after a closed marker the cursor is outside again
  expect(suggestions({ prefix: '/*% } %*/ ', names, delimiters }).map((s) => s.label)).toEqual(['feature-if', 'feature-if-else'])
})

test('annotating a range writes what the parser reads back', () => {
  const text = annotateRange('a\nb\nc\n', { startLine: 2, endLine: 2, feature: 'Dark', delimiters: ['/*%', '%*/'] })
  expect(parseAnnotations(text)).toMatchObject([{ startLine: 2, endLine: 4, features: ['Dark'] }])
})

test('declaring features when the root is written on one line', () => {
  expect(addFeatures('feature Root {}\n', ['A'])).toBe('feature Root {\n  optional {\n    feature A\n  }\n}\n');
  expect(addFeatures('feature Root { feature X }', ['A'])).toBe('feature Root {\n  feature X\n  optional {\n    feature A\n  }\n}');
});

test('an unknown feature in an else is reported once, at its if', () => {
  const regions = parseAnnotations('/*% if (feature.Z) { %*/\n/*% } else { %*/\n/*% } %*/');
  expect(diagnose(regions, ['Root', 'A'])).toEqual([{ line: 1, kind: 'unknown', feature: 'Z' }]);
});
