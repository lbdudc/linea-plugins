import { describe, it, expect } from 'vitest'
import TemplateEngine from '../../../../linea/node_modules/spl-js-engine/src/template-engine/template-engine.js'
import { execute } from '../../client/sandbox.js'

const D = ['###<', '>###']
const run = (text, more = {}) => execute({ text, fileName: 'f.json', basePath: 'a/b', delimiters: D, features: [], debug: true, ...more })

describe('execute: one template, the way the engine runs it', () => {
  it('writes the value of an = marker and follows conditions', () => {
    const r = run('x ###<= data.name >### ###< if (feature.A) { >###A###< } else { >###not A###< } >###', { data: { name: 'demo' }, features: ['A'] })
    expect(r.ok).toBe(true)
    expect(r.outputs[0].content).toBe('x demo A')
    const marks = Object.values(r.marks)
    expect(marks.find((m) => m.kind === 'echo').value).toBe('"demo"')
    expect(marks.find((m) => m.kind === 'if')).toMatchObject({ value: 'true', hits: 1 })
    expect(marks.find((m) => m.kind === 'else').hits).toBe(0)
  })

  it('a header makes one file for each thing it returns, next to the template', () => {
    const r = run('###<@ return data.langs.map(function (l) { return { fileName: l + ".json", context: { l: l } }; }) >###\n{"lang":"###<= context.l >###"}', { data: { langs: ['es', 'gl'] } })
    expect(r.outputs.map((o) => [o.path, o.content])).toEqual([['a/b/es.json', '{"lang":"es"}'], ['a/b/gl.json', '{"lang":"gl"}']])
  })

  it('shows what a declaration holds and how many times a loop ran', () => {
    const r = run('###< var n = [1, 2, 3], total = 0; >###\n###< n.forEach(function (i) { >###\n###<= i >###\n###< }); >###', {})
    const marks = Object.values(r.marks)
    expect(marks.find((m) => m.kind === 'code').vars).toEqual({ n: '[1, 2, 3]', total: '0' })
    expect(marks.find((m) => m.kind === 'echo').hits).toBe(3)
    expect(r.outputs[0].content.replace(/\s/g, '')).toBe('123')
  })

  it('an expression that throws names the marker and its line in the file as written', () => {
    const r = run('###<@ return [{ fileName: "x.json" }] >###\nok\n###<= data.nope.deep >###')
    expect(r.ok).toBe(false)
    expect(r.error).toMatchObject({ phase: 'run', line: 3 })
    expect(r.error.message).toMatch(/undefined/)
  })

  it('a block left open is told with its line (the engine only says "Unexpected token")', () => {
    const r = run('a\n###< if (feature.A) { >###\nb')
    expect(r.ok).toBe(false)
    expect(r.error.phase).toBe('compile')
    expect(r.error.line).toBe(2)
    expect(r.error.hint).toMatch(/line 2: opens a block that is never closed/)
  })

  it('a header that returns no list is a header error on line 1', () => {
    const r = run('###<@ return 3 >###\nx')
    expect(r.error).toMatchObject({ phase: 'header', line: 1 })
  })

  it('runs the transformation of the SPL over a sample spec first', () => {
    const transformation = 'module.exports = function (spec) { return { features: spec.features.concat(["B"]), data: { title: spec.basicData.name.toUpperCase() } }; }'
    const r = run('###<= data.title >###-###< if (feature.B) { >###b###< } >###', { transformation, spec: { basicData: { name: 'gema' } }, features: ['A'] })
    expect(r.outputs[0].content).toBe('GEMA-b')
  })

  it('stops at what is too much: the trace is cut, the output is not', () => {
    const r = run('###< for (var i = 0; i < 50; i++) { >###x###<= i >######< } >###', { limits: { events: 10 } })
    expect(r.truncated).toBe(true)
    expect(r.outputs[0].content).toBe(Array.from({ length: 50 }, (_, i) => `x${i}`).join(''))
  })

  it('an output that is empty is said, not dropped', () => {
    const r = run('###< if (feature.A) { >###x###< } >###')
    expect(r.outputs[0].empty).toBe(true)
  })

  // the point of all this: the same output as spl-js-engine, whether or not it is being followed
  const engine = (text, { features, data }) => {
    const te = new TemplateEngine({}, '')
    te.addDelimiter('json', D[0], D[1])
    const feat = Object.fromEntries(features.map((f) => [f, true]))
    return te.createFileGenerator(feat, data).filesToCreate(text, 'json', 'f.json', '', {}).map((r) => te.createProcessor(feat, data).process(r.fileContent, 'json', r.context))
  }
  const templates = [
    '{\n###< if (feature.A) { >###\n  "a": 1,\n###< } else { >###\n  "a": 0,\n###< } >###\n  "name": "###<= data.name >###"\n}\n',
    '###< data.items.forEach(function (i, k) { >###\n  line ###<= i >######< if (k < data.items.length - 1) { >###,###< } >###\n###< }); >###\n',
    '###<@ return data.items.map(function (i) { return { fileName: i + ".json", context: i }; }) >###\nitem: ###<= context >###\n',
    'plain text with no marker at all\n',
  ]
  for (const [i, text] of templates.entries()) {
    it(`gives the engine's own output for template ${i + 1}, with and without following it`, () => {
      const input = { features: ['A'], data: { name: 'demo', items: ['x', 'y', 'z'] } }
      const expected = engine(text, input)
      for (const debug of [false, true]) {
        const r = execute({ text, fileName: 'f.json', basePath: '', delimiters: D, debug, ...input })
        expect(r.ok).toBe(true)
        expect(r.outputs.map((o) => o.content)).toEqual(expected)
      }
    })
  }
})

describe('execute: values set by hand', () => {
  const D2 = ['###<', '>###']
  it('reads the values a file asks for and lets them be set', () => {
    const base = { text: '###<= data.basicData.name >### ###< if (data.flag) { >###on###< } >###', fileName: 'f.json', basePath: '', delimiters: D2, features: [], data: { basicData: { name: 'demo' }, flag: false }, debug: true, probe: ['basicData.name', 'flag', 'nope.deep'] }
    const a = execute(base)
    expect(a.outputs[0].content).toBe('demo ')
    expect(a.values['basicData.name']).toMatchObject({ type: 'string', json: '"demo"' })
    expect(a.values.flag.type).toBe('boolean')
    expect(a.values['nope.deep'].text).toBe('undefined')
    const b = execute({ ...base, overrides: { 'basicData.name': 'other', flag: true } })
    expect(b.outputs[0].content).toBe('other on')
    expect(b.values.flag.json).toBe('true')
  })
})
