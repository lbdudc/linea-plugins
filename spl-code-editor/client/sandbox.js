// Runs ONE template the way spl-js-engine does (same delimiters, same code it builds, same helpers), and can follow what it does:
// the value of every `=` expression, which way every condition went, what the variables hold, the files a `@` header makes.
//
// `execute` must stay self-contained (no imports, nothing from outside the function): its source text is what the sandboxed frame runs
// (see sandboxHost.js), and the tests call it directly. It never touches the page: it gets plain data and answers plain data.
//
// input:  { text, fileName, basePath?, delimiters: [start, end], features: ['A', 'B.C'] | { A: true }, data, extraJS?, debug?, limits? }
// output: { ok, outputs: [{ fileName, basePath, path, content, empty }], marks, trace, truncated, error?: { phase, message, marker?, line?, hint? } }
//         marks: by marker number { kind, line, hits, value?, last?, vars? }  trace: [{ marker, ev, value }] in the order things happened
export function execute(input) {
  const { text, fileName = 'file', basePath = '', delimiters, extraJS = '', debug = false } = input
  let data = input.data ?? {}
  const [start, end] = delimiters && delimiters.length === 2 ? delimiters : ['/*%', '%*/']
  const limits = { events: 2000, ...(input.limits ?? {}) }

  // ---- the model transformation of the SPL (transformation.js: `module.exports = function (spec) { return { features, data } }`) ----
  let names = Array.isArray(input.features) ? input.features : Object.keys(input.features ?? {}).filter((k) => input.features[k])
  if (input.transformation) {
    try {
      const mod = { exports: {} }
      new Function('module', 'exports', input.transformation)(mod, mod.exports)
      if (typeof mod.exports !== 'function') throw new Error('transformation.js must export a function (module.exports = ...)')
      const product = mod.exports({ ...(input.spec ?? {}), features: names }) ?? {}
      data = product.data || {}
      names = Array.isArray(product.features) ? product.features : []
    } catch (error) {
      return { ok: false, outputs: [], marks: {}, trace: [], truncated: false, error: { phase: 'transformation', message: String(error && error.message ? error.message : error) } }
    }
  }

  // ---- values set by hand over what the transformation made (`{ 'basicData.name': 'x' }`), to see what a template does with them ----
  const setPath = (root, path, value) => {
    const keys = String(path).split('.')
    let at = root
    keys.forEach((k, i) => {
      if (i === keys.length - 1) at[k] = value
      else { if (at[k] === null || typeof at[k] !== 'object') at[k] = {}; at = at[k] }
    })
  }
  if (input.overrides && typeof data === 'object') for (const [path, value] of Object.entries(input.overrides)) { try { setPath(data, path, value) } catch { /* a path that cannot be set is skipped */ } }

  // ---- the features, as the engine hands them to a template: { A: true, B: { C: true } } for 'A' and 'B.C' ----
  const features = {}
  for (const f of names) {
    if (f.includes('.')) {
      const keys = f.split('.')
      let current = features
      keys.forEach((k, i) => {
        if (i === keys.length - 1) current[k] = true
        else { if (!current[k] || current[k] === true) current[k] = {}; current = current[k] }
      })
    } else features[f] = true
  }

  // ---- what the engine puts before every template (engine.js: getTemplateHelperMethods) ----
  const helpers = `function normalize(str, upper) {
              return str
                .normalize('NFKD')
                .replace(/[\u0300-\u036F]/g, '')
                .replace(/[-_]+/g, ' ')
                .replace(/[^\\w\\s]/gi, '')
                .replace(/\\s(.)/g, function($1) { return $1.toUpperCase(); })
                .replace(/\\s/g, '')
                .replace(/^(.)/, function($1) { return upper ? $1.toUpperCase() : $1.toLowerCase(); });
            }\n
            function log(str) {
              console.log(str);
            }\n
            function comment(str) {
            }\n
            function camelToSnake(string) {
              return string.replace(/[\\w]([A-Z])/g, function(m) {
                return m[0] + "_" + m[1];
              }).toLowerCase();
            }\n
            ${extraJS}`

  // ---- the delimiters (delimiter.js) ----
  const esc = (s) => String(s).replace(/[-/|\\{}()[\]^$+*?.]/g, '\\$&')
  const regular = () => new RegExp('(([ \\r\\t])+|\\n|^)' + esc(start) + '([^=])(([^' + esc(end[0]) + ']|\\\\' + esc(end[0]) + ')+?)' + esc(end) + '\\n|' + esc(start) + '(([^' + ']|\\\\' + esc(end[0]) + ')+?)' + esc(end), 'g')
  const header = new RegExp('^' + esc(start) + '@(([^' + esc(end[0]) + ']|\\\\' + esc(end[0]) + ')+?)' + esc(end))

  // ---- showing values ----
  const fmt = (value, depth = 0, seen = []) => {
    const cut = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s)
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return cut(JSON.stringify(value), 400)
    if (typeof value === 'function') return `ƒ ${value.name || ''}()`
    if (typeof value !== 'object') return String(value)
    if (seen.includes(value)) return '[Circular]'
    if (Array.isArray(value)) {
      if (depth >= 3) return `Array(${value.length})`
      const items = value.slice(0, 8).map((v) => fmt(v, depth + 1, [...seen, value]))
      return cut(`[${items.join(', ')}${value.length > 8 ? `, … +${value.length - 8}` : ''}]`, 400)
    }
    if (depth >= 3) return '{…}'
    const keys = Object.keys(value)
    const items = keys.slice(0, 8).map((k) => `${k}: ${fmt(value[k], depth + 1, [...seen, value])}`)
    return cut(`{ ${items.join(', ')}${keys.length > 8 ? `, … +${keys.length - 8}` : ''} }`, 400)
  }

  // ---- following what happens ----
  const marks = {}
  const trace = []
  let truncated = false
  let current = -1
  const mark = (i) => marks[i]
  const note = (i, ev, value) => { if (trace.length < limits.events) trace.push({ marker: i, ev, value }); else truncated = true }
  const hooks = {
    step: (i) => { current = i; mark(i).hits++ },
    echo: (i, v) => {
      const s = fmt(v); const m = mark(i); if (m.value === undefined) m.value = s; m.last = s; note(i, 'echo', s)
      if (prov) {
        let size = 0
        try { size = v === null || v === undefined ? 0 : String(v).length } catch { size = 0 }
        if (prov.pieces.length < 20000) prov.pieces.push([prov.pos, prov.pos + size, prov.markers[i].line, prov.markers[i].endLine, 1, whyOf(prov.echoChains[i] ?? []), i, s])
        prov.pos += size
      }
      return v
    },
    text: (id, str) => {
      if (prov) {
        if (id >= 0 && str.length && prov.pieces.length < 20000) { const sg = prov.segs[id]; prov.pieces.push([prov.pos, prov.pos + str.length, sg.startLine, sg.endLine, 0, whyOf(sg.chain), -1]) }
        prov.pos += str.length
      }
      return str
    },
    cond: (i, v) => {
      current = i
      const m = mark(i); const s = v ? 'true' : 'false'
      m.hits++
      if (m.value === undefined) m.value = s
      m.last = s; m.trues = (m.trues ?? 0) + (v ? 1 : 0); note(i, 'cond', s); return v
    },
    vars: (i, values) => {
      const m = mark(i); const shown = {}
      for (const k of Object.keys(values)) shown[k] = fmt(values[k])
      if (!m.vars) m.vars = shown
      m.lastVars = shown; note(i, 'vars', shown)
    },
  }

  // ---- where a marker is: its line in the file as it was written (a header that was taken off the front moved the rest up) ----
  const countLines = (s) => s.split('\n').length
  const lineFinder = (content) => {
    const starts = [0]
    for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1)
    const shift = countLines(text) - countLines(content)
    return (offset) => {
      let lo = 0; let hi = starts.length - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1 }
      return lo + 1 + shift
    }
  }

  // ---- the declared names of a piece of code ----
  const declaredIn = (code) => {
    const found = []
    for (const m of code.matchAll(/\b(?:var|let|const)\s+/g)) {
      let depth = 0; let quote = ''; let piece = ''; const pieces = []
      for (let i = m.index + m[0].length; i < code.length; i++) {
        const ch = code[i]
        if (quote) { piece += ch; if (ch === '\\') piece += code[++i] ?? ''; else if (ch === quote) quote = ''; continue }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; piece += ch; continue }
        if ('([{'.includes(ch)) depth++
        else if (')]}'.includes(ch)) { if (--depth < 0) break } else if (depth === 0 && ch === ';') break
        if (depth === 0 && ch === ',') { pieces.push(piece); piece = ''; continue }
        piece += ch
      }
      pieces.push(piece)
      for (const p of pieces) { const id = /^\s*([A-Za-z_$][\w$]*)\s*(=|$)/.exec(p); if (id) found.push(id[1]) }
    }
    return [...new Set(found)]
  }

  // `if (COND) {` -> `if (__c(i, COND)) {`: the condition is looked at, not run twice
  const watchCondition = (code, i) => {
    const m = /^(\}\s*else\s+)?if\s*\(/.exec(code)
    if (!m) return code
    let depth = 1; let quote = ''
    for (let k = m[0].length; k < code.length; k++) {
      const ch = code[k]
      if (quote) { if (ch === '\\') k++; else if (ch === quote) quote = ''; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '(') depth++
      else if (ch === ')' && --depth === 0) return `${m[0]}__c(${i}, ${code.slice(m[0].length, k)})${code.slice(k)}`
    }
    return code
  }

  // ---- how a marker's JavaScript opens and closes blocks (the same reading as the editor's own parser) ----
  const eventsOf = (src) => {
    const out = []
    let i = 0
    let afterElse = false
    const skip = (k) => { while (k < src.length && /\s/.test(src[k])) k++; return k }
    while (i < src.length) {
      const ch = src[i]
      if (ch === '"' || ch === "'" || ch === '`') { for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++; i++; afterElse = false; continue }
      if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
      if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue }
      if (ch === '{') { out.push({ type: 'open', kind: 'block' }); i++; afterElse = false; continue }
      if (ch === '}') { out.push({ type: 'close' }); i++; afterElse = false; continue }
      if (/[A-Za-z_$]/.test(ch)) {
        let k = i
        while (k < src.length && /[\w$]/.test(src[k])) k++
        const word = src.slice(i, k)
        if (src[i - 1] === '.') { i = k; afterElse = false; continue }
        if (word === 'else') { const n = skip(k); if (src[n] === '{') { out.push({ type: 'open', kind: 'else' }); i = n + 1; afterElse = false; continue } afterElse = true; i = k; continue }
        if (word === 'if') {
          const n = skip(k)
          if (src[n] === '(') {
            let depth = 0; let q = n; let quote = ''
            for (; q < src.length; q++) { const c = src[q]; if (quote) { if (c === '\\') q++; else if (c === quote) quote = ''; continue } if (c === '"' || c === "'" || c === '`') quote = c; else if (c === '(') depth++; else if (c === ')' && --depth === 0) break }
            const body = skip(q + 1)
            if (depth === 0 && src[body] === '{') { out.push({ type: 'open', kind: afterElse ? 'elseif' : 'if', condition: src.slice(n + 1, q) }); i = body + 1; afterElse = false; continue }
            i = q + 1; afterElse = false; continue
          }
        }
        i = k; afterElse = false; continue
      }
      if (!/\s/.test(ch)) afterElse = false
      i++
    }
    return out
  }

  // ---- provenance: which line of the template each piece of the output comes from, and why it is there (debug only) ----
  let prov = null // { pieces, whys, whyIndex, pos, segs, echoChains, markers }
  const whyOf = (chain) => {
    // what the code around a piece decided, outermost first: conditions with the value they had, loops with the turn they were on
    const list = []
    for (const e of chain) {
      const m = prov.markers[e.marker]
      const mk = marks[e.marker]
      const item = { marker: e.marker, line: m.line, kind: e.kind, condition: e.condition }
      if (e.kind === 'if' || e.kind === 'elseif') item.value = mk?.last
      if (e.kind === 'else' || e.kind === 'elseif') {
        item.after = []
        for (let p = e.prev; p; p = p.prev) item.after.push({ marker: p.marker, line: prov.markers[p.marker].line, condition: p.condition, value: marks[p.marker]?.last ?? 'false' })
      }
      list.push(item)
    }
    const key = JSON.stringify(list)
    let id = prov.whyIndex.get(key)
    if (id === undefined) { id = prov.whys.length; prov.whys.push(list); prov.whyIndex.set(key, id) }
    return id
  }

  // ---- the code of a template (processor.js: process) ----
  const escText = (line) => line.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/"/g, '\\"')
  const textLine = (line) => 'lines.push("'.concat(escText(line), '");\n')
  const jsLine = (line) => line.trim().replace(/\n/g, '').replace(/[ ]{2,}/g, ' ').concat('\n')

  const compile = (content) => {
    let code = helpers + 'var lines = [];\n'
    let cursor = 0
    let match
    const markers = []
    const lineAt = lineFinder(content)
    const re = regular()
    const segs = []
    const echoChains = {}
    const blocks = []
    const stack = [] // the blocks open at this point of the template: { marker, kind, condition, prev, block }
    let lastClosed = null
    const text = (from, to) => {
      const s = content.slice(from, to)
      if (!debug) { code += textLine(s); return }
      if (s === '') { code += textLine(s); return }
      segs.push({ from, to, startLine: lineAt(from), endLine: lineAt(Math.max(from, to - 1)), chain: stack.slice() })
      code += `lines.push(__t(${segs.length - 1}, "${escText(s)}"));\n`
    }
    while ((match = re.exec(content)) !== null) {
      text(cursor, match.index)
      if (match[1] === '\n') code += debug ? 'lines.push(__t(-1, "\\n"));\n' : 'lines.push("\\n");\n'
      const joined = match.slice(1).join('')
      const at = match.index + (match[3] !== undefined ? (match[1] ?? '').length : 0)
      const echo = joined.trim().charAt(0) === '='
      if (debug) {
        const i = markers.length
        const line = lineAt(at)
        const endLine = lineAt(match.index + match[0].length - 1)
        if (echo) {
          markers.push({ kind: 'echo', line, endLine, code: joined.trim().substr(1).trim().slice(0, 240) })
          echoChains[i] = stack.slice()
          code += `lines.push((__s(${i}), __e(${i}, ${joined.trim().substr(1)})));\n`
        } else {
          const js = jsLine(joined)
          const trimmed = js.trim()
          const names = declaredIn(trimmed).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
          const kind = /^(\}\s*else\s+)?if\s*\(/.test(trimmed) ? 'if' : (/^\}\s*else\s*\{$/.test(trimmed) ? 'else' : (/^\}/.test(trimmed) ? 'close' : (/\{$/.test(trimmed) ? 'loop' : 'code')))
          markers.push({ kind, line, endLine, code: trimmed.slice(0, 240) })
          // the blocks this marker opens and closes, in the order it does
          lastClosed = null
          for (const ev of eventsOf(trimmed)) {
            if (ev.type === 'close') {
              const e = stack.pop()
              if (e) { blocks[e.block].endLine = endLine; lastClosed = e }
              continue
            }
            const entry = { marker: i, kind: ev.kind, condition: ev.condition, prev: ev.kind === 'else' || ev.kind === 'elseif' ? lastClosed : null }
            entry.block = blocks.length
            blocks.push({ marker: i, kind: ev.kind, condition: ev.condition, startLine: line, endLine: line, depth: stack.length, prev: entry.prev ? entry.prev.marker : null })
            stack.push(entry)
            lastClosed = null
          }
          const after = names.length && !/\{$/.test(trimmed) ? `;__v(${i}, {${names.map((n) => `${JSON.stringify(n)}: (typeof ${n} === 'undefined' ? undefined : ${n})`).join(', ')}});` : ''
          // a step is taken where the marker's own work begins: for `} else {` that is inside the new block, not before the `}` that ends the old one
          if (kind === 'if') code += `${watchCondition(trimmed, i)}\n`
          else if (kind === 'else') code += `${trimmed}__s(${i});\n`
          else if (kind === 'close') code += `${trimmed}\n`
          else code += `__s(${i});${trimmed}${after}\n`
        }
      } else {
        code += echo ? `lines.push(${joined.trim().substr(1)});\n` : jsLine(joined)
      }
      cursor = match.index + match[0].length
    }
    text(cursor, content.length)
    code = (code + 'return lines.join("");').replace(/[\r\t\n]/g, '')
    return { code, markers, segs, echoChains, blocks, open: stack.length }
  }

  // the structure of the JavaScript between the markers: which block is left open, which `}` has nothing to close
  const structure = (content) => {
    const stack = []; const problems = []
    const lineAt = lineFinder(content)
    const re = regular()
    let match
    while ((match = re.exec(content)) !== null) {
      const joined = match.slice(1).join('')
      if (joined.trim().charAt(0) === '=') continue
      const at = match.index + (match[3] !== undefined ? (match[1] ?? '').length : 0)
      let quote = ''
      for (let k = 0; k < joined.length; k++) {
        const ch = joined[k]
        if (quote) { if (ch === '\\') k++; else if (ch === quote) quote = ''; continue }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch
        else if (ch === '{') stack.push(lineAt(at))
        else if (ch === '}') { if (stack.length) stack.pop(); else problems.push({ line: lineAt(at), message: 'closes a block that was never opened' }) }
      }
    }
    for (const line of stack) problems.push({ line, message: 'opens a block that is never closed' })
    return problems
  }

  // the values the open file reads from `data`, as they are when it runs (`probe`: the paths it names)
  const values = {}
  for (const path of input.probe ?? []) {
    let at = data
    for (const k of String(path).split('.')) at = at === null || at === undefined ? undefined : at[k]
    values[path] = { type: at === null ? 'null' : Array.isArray(at) ? 'array' : typeof at, text: fmt(at), json: (() => { try { return JSON.stringify(at) } catch { return undefined } })() }
  }
  const failure = (phase, error, extra = {}) => ({ ok: false, phase, outputs: [], marks, trace, truncated, values, error: { phase, message: String(error && error.message ? error.message : error), ...extra } })

  // ---- the files a header makes (file-generator.js) ----
  const filesToCreate = (content, name, base, context) => {
    const found = header.exec(content)
    if (!found) return [{ fileContent: content, fileName: name, basePath: base, context }]
    let results
    try {
      const run = new Function('feature', 'data', 'fileName', 'basePath', 'context', helpers + found[1])
      results = run(features, data, name, base, context)
    } catch (error) {
      throw Object.assign(new Error(error && error.message ? error.message : String(error)), { phase: 'header', line: 1 })
    }
    if (!Array.isArray(results)) throw Object.assign(new Error('the header must return a list of files: [{ fileName, basePath, context }]'), { phase: 'header', line: 1 })
    const rest = content.replace(header, '').replace(/^[\n\r\t]/, '')
    const out = []
    for (const r of results) out.push(...filesToCreate(rest, r.fileName, r.basePath, r.context))
    return out
  }

  let made
  try { made = filesToCreate(text, fileName, basePath, {}) } catch (error) {
    return failure('header', error, { line: 1, marker: 0 })
  }
  const headerLines = {}
  if (header.test(text)) headerLines.made = made.map((r) => r.fileName)

  const outputs = []
  for (const r of made) {
    const compiled = compile(r.fileContent)
    const { code, markers } = compiled
    let fn
    try { fn = new Function('feature', 'data', 'context', '__s', '__e', '__c', '__v', '__t', code) } catch (error) {
      const problems = structure(r.fileContent)
      return failure('compile', error, { problems, hint: problems.length ? problems.map((p) => `line ${p.line}: ${p.message}`).join('; ') : undefined, line: problems[0]?.line })
    }
    markers.forEach((m, i) => { marks[i] = { kind: m.kind, line: m.line, hits: 0 } })
    prov = debug ? { pieces: [], whys: [], whyIndex: new Map(), pos: 0, segs: compiled.segs, echoChains: compiled.echoChains, markers } : null
    let content
    try { content = fn(features, data, r.context, hooks.step, hooks.echo, hooks.cond, hooks.vars, hooks.text) } catch (error) {
      const m = current >= 0 ? markers[current] : null
      return failure('run', error, m ? { marker: current, line: m.line } : {})
    }
    // the engine puts the file next to the template, whatever `basePath` the header gave (that one only travels with the context)
    const folder = basePath || ''
    const name = r.fileName ?? fileName
    // what each piece of the output comes from; dropped when it does not add up to the output (code that wrote on its own)
    const provenance = prov && typeof content === 'string' && prov.pos === content.length ? { pieces: prov.pieces, whys: prov.whys, markers: markers.map((m, i) => ({ ...m, last: marks[i]?.last, hits: marks[i]?.hits })), blocks: compiled.blocks.map((b) => ({ ...b, value: marks[b.marker]?.kind === 'if' || marks[b.marker]?.kind === 'else' ? marks[b.marker]?.last : undefined, hits: marks[b.marker]?.hits ?? 0 })), features: names } : null
    outputs.push({ provenance, fileName: name, basePath: folder, path: folder ? `${String(folder).replace(/\/$/, '')}/${name}` : name, content: typeof content === 'string' ? content : String(content), empty: typeof content === 'string' ? !content.trim() : !content })
  }
  return { ok: true, outputs, marks, trace, truncated, values, ...headerLines }
}
