import { test, expect, describe, it } from 'vitest';
import { annotateRange, declared, delimiterTable, delimitersFor, featureNames, parseAnnotations, parseOperators, removeAnnotation } from '../../shared/parser.js';

const SAMPLE = [
  'class A {',
  '/*% if (feature.weighted) { %*/',
  '  int w;',
  '/*% } %*/',
  '  /*% if (feature.a || feature.b) { %*/int x;/*% } %*/',
  '/*% if (feature.x) { %*/',
  '  one();',
  '/*% } else { %*/',
  '  two();',
  '/*% } %*/',
  '}',
].join('\n');

test('reads the regions the engine understands, with their lines', () => {
  const regions = parseAnnotations(SAMPLE);
  expect(regions.map((r) => [r.startLine, r.endLine, r.expression])).toEqual([
    [2, 4, 'weighted'],
    [5, 5, 'a || b'],
    [6, 8, 'x'],
    [8, 10, '!(x)'],
  ]);
  expect(regions[1].features).toEqual(['a', 'b']);
  expect(regions[3].elseOf).toBe('x');
});

test('nested regions and regions left open', () => {
  const text = '/*% if (feature.a) { %*/\n/*% if (feature.b) { %*/\nx\n/*% } %*/\n/*% } %*/\n/*% if (feature.c) { %*/\ny';
  const regions = parseAnnotations(text);
  expect(regions.map((r) => [r.expression, r.startLine, r.endLine])).toEqual([['a', 1, 5], ['b', 2, 4], ['c', 6, 7]]);
  expect(regions[2].unclosed).toBe(true);
});

test('other delimiters per extension, and other javascript is no region', () => {
  const delimiters = delimitersFor('web/index.html', '{"html":["<!--%","%-->"]}');
  expect(delimiters).toEqual(['<!--%', '%-->']);
  expect(delimitersFor('a.java', '{"html":["<!--%","%-->"]}')).toEqual(['/*%', '%*/']);
  expect(delimitersFor('a.java', 'not json')).toEqual(['/*%', '%*/']);
  const html = '<!--% if (feature.m) { %-->\n<div/>\n<!--% } %-->\n/*% var a = 1; %*/';
  expect(parseAnnotations(html, { delimiters }).map((r) => r.expression)).toEqual(['m']);
});

test('annotate wraps the lines keeping the indentation, and removing gives the text back', () => {
  const text = 'a\n    b\n    c\nd';
  const annotated = annotateRange(text, { startLine: 2, endLine: 3, feature: 'Gui || !Other' });
  expect(annotated).toBe('a\n    /*% if (feature.Gui || !feature.Other) { %*/\n    b\n    c\n    /*% } %*/\nd');
  expect(parseAnnotations(annotated)[0]).toMatchObject({ startLine: 2, endLine: 5, features: ['Gui', 'Other'] });
  expect(removeAnnotation(annotated, { line: 2 })).toBe(text);
});

test('annotate refuses what is not a feature expression or a range', () => {
  expect(() => annotateRange('a', { startLine: 1, endLine: 1, feature: 'a); evil(' })).toThrow();
  expect(() => annotateRange('a', { startLine: 1, endLine: 1, feature: '' })).toThrow();
  expect(() => annotateRange('a', { startLine: 2, endLine: 3, feature: 'a' })).toThrow();
  expect(() => removeAnnotation('a', { line: 1 })).toThrow(/No annotation/);
  expect(() => removeAnnotation(SAMPLE, { line: 8 })).toThrow(/by hand/);
});

test('keeps CRLF files CRLF', () => {
  expect(annotateRange('a\r\nb', { startLine: 1, endLine: 2, feature: 'f' })).toBe('/*% if (feature.f) { %*/\r\na\r\nb\r\n/*% } %*/');
});

test('the features of a UVL model, and of an XML one', () => {
  const uvl = 'namespace X\n\nfeatures\n    Shop {abstract}\n        mandatory\n            Cart\n        optional\n            Wish // later\n\nconstraints\n    Wish => Cart';
  expect(featureNames(uvl)).toEqual(['Shop', 'Cart', 'Wish']);
  expect(featureNames('<featureModel><struct><and name="Root"><feature name="A"/></and></struct></featureModel>')).toEqual(['Root', 'A']);
});

test('the delimiters come from the engine config of the line, an override wins', () => {
  const config = { delimiters: [{ extension: ['html', 'xml'], start: '<!--%', end: '%-->' }, { extension: ['java'], start: '/*%', end: '%*/' }, { extension: ['py'], start: '#%', end: '%#' }] };
  const table = delimiterTable(JSON.stringify(config));
  expect(delimitersFor('a/b.xml', table)).toEqual(['<!--%', '%-->']);
  expect(delimitersFor('x.py', table)).toEqual(['#%', '%#']);
  expect(delimitersFor('x.unknown', table)).toEqual(['/*%', '%*/']);
  expect(delimitersFor('a.html', delimiterTable(JSON.stringify(config), '{"html":["<%","%>"]}'))).toEqual(['<%', '%>']);
  expect(delimiterTable('not json')).toEqual({});
  expect(delimiterTable(null)).toEqual({});
});

test('what may be typed as a condition: names, operators, an optional `feature.` before a name', async () => {
  const { cleanExpression } = await import('../../shared/parser.js');
  expect(cleanExpression('feature.A && !feature.B')).toBe('A && !B');
  for (const bad of ['', '  ', 'true', 'A && 1b', 'my-feature', '(A', 'A)', '!', 'A; drop()']) expect(cleanExpression(bad)).toBeNull();
  expect(annotateRange('a\n', { startLine: 1, endLine: 1, feature: 'feature.A' })).toBe('/*% if (feature.A) { %*/\na\n/*% } %*/\n');
});

test('selecting the whole file does not wrap the empty line after the last line break', () => {
  expect(annotateRange('a\nb\n', { startLine: 1, endLine: 3, feature: 'A' })).toBe('/*% if (feature.A) { %*/\na\nb\n/*% } %*/\n');
});

test('an `if` that has an else cannot lose its markers alone', () => {
  const text = '/*% if (feature.A) { %*/\nx\n/*% } else { %*/\ny\n/*% } %*/';
  expect(() => removeAnnotation(text, { line: 1 })).toThrow(/by hand/);
  expect(() => removeAnnotation(text, { line: 3 })).toThrow(/by hand/);
});

test('names from the text of LINEA\'s feature model', async () => {
  const { lineaModelNames } = await import('../../shared/parser.js');
  expect(lineaModelNames('featuremodel S\nfeature S {\n  optional {\n    feature A // c\n    feature "B C"\n  }\n}')).toEqual(['S', 'A', 'B C']);
  expect(lineaModelNames('')).toEqual([]);
});

describe('operators (everything the engine reads)', () => {
  const D = ['###<', '>###'];
  it('tells the three kinds apart: header, value, plain code', () => {
    const text = [
      '###<@ return data.langs.map(function (l) { return { fileName: l + ".json" }; }) >###',
      '{ "app": "###<= data.name >###"',
      '###< if (feature.A) { >###',
      '###< var x = 1, y = f(2, 3), z = [1, 2]; >###',
      '###< data.items.forEach(function (i) { >###',
      '###< }); >###',
      '###< } else { >###',
      '###< } >###',
      '}',
    ].join('\n');
    const ops = parseOperators(text, { delimiters: D });
    expect(ops.map((o) => [o.kind, o.startLine])).toEqual([['header', 1], ['echo', 2], ['if', 3], ['code', 4], ['loop', 5], ['close', 6], ['else', 7], ['close', 8]]);
    expect(ops[0].code).toMatch(/^return data\.langs/);
    expect(ops[1].code).toBe('data.name');
    expect(ops[2].features).toEqual(['A']);
    expect(ops[3].vars).toEqual(['x', 'y', 'z']);
  });

  it('a header counts only at the very start of the file', () => {
    const ops = parseOperators('x\n###<@ return [] >###', { delimiters: D });
    expect(ops[0].kind).not.toBe('header');
  });

  it('reads the names a declaration makes, not the calls inside it', () => {
    expect(declared('var a = f(x, y), b = [1, 2]; foo(c, d)')).toEqual(['a', 'b']);
    expect(declared('const { a } = o; let q')).toEqual(['q']);
    expect(declared('if (x) { var inner = 1; }')).toEqual(['inner']);
  });

  it('keeps the first line and the offsets of a marker that spans lines', () => {
    const text = 'a\n###<\n  var q = 1;\n>###\nb';
    const [op] = parseOperators(text, { delimiters: D });
    expect([op.startLine, op.endLine]).toEqual([2, 4]);
    expect(text.slice(op.start, op.end)).toMatch(/^###<[\s\S]*>###$/);
  });
});
