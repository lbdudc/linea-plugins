// The annotations of the derivation engine (spl-js-engine): JavaScript between delimiters, `/*%` and `%*/` unless a file type says
// otherwise. A region is  `/*% if (feature.x) { %*/ ... /*% } %*/`  (also `else if` and `else`). This reads exactly that, nothing else.

export const DEFAULT_DELIMITERS = ['/*%', '%*/'];

const escape = (text) => text.replace(/[-/|\\{}()[\]^$+*?.]/g, '\\$&');
const FEATURE = /feature\.([A-Za-z0-9_$]+)/g;
const IF = /^if\s*\(([\s\S]*)\)\s*\{$/;
const ELSE_IF = /^\}\s*else\s+if\s*\(([\s\S]*)\)\s*\{$/;
const ELSE = /^\}\s*else\s*\{$/;
const CLOSE = /^\}$/;

/** `feature.a && !feature.b` -> `a && !b` */
export const plainExpression = (expression) => expression.replace(/feature\./g, '').replace(/\s+/g, ' ').trim();
export const featuresIn = (expression) => [...new Set([...expression.matchAll(FEATURE)].map((m) => m[1]))];

/**
 * The table `{ ext: [start, end] }` of a line's `src/platform/config.json` (`delimiters: [{ extension: [...], start, end }]`), which is
 * where the engine takes them from. `overrides` (a JSON text or object of the same shape as the result) win over it.
 */
export const delimiterTable = (configText, overrides = {}) => {
  const table = {};
  try {
    const config = typeof configText === 'string' ? JSON.parse(configText) : configText;
    for (const entry of config?.delimiters ?? []) {
      for (const ext of entry.extension ?? []) if (entry.start && entry.end) table[String(ext).toLowerCase()] = [entry.start, entry.end];
    }
  } catch { /* no usable config: the engine's defaults apply */ }
  let extra = overrides;
  if (typeof overrides === 'string') { try { extra = JSON.parse(overrides || '{}'); } catch { extra = {}; } }
  return { ...table, ...(extra && typeof extra === 'object' ? extra : {}) };
};

/** The delimiters of a file: `{ ext: [start, end] }` (a JSON text or an object), else the engine's. */
export const delimitersFor = (path, table = {}) => {
  let map = table;
  if (typeof table === 'string') { try { map = JSON.parse(table || '{}'); } catch { map = {}; } }
  const ext = String(path).split('/').pop().split('.').slice(1).pop()?.toLowerCase();
  const pair = ext && map?.[ext];
  return Array.isArray(pair) && pair.length === 2 && pair.every((p) => typeof p === 'string' && p) ? pair : DEFAULT_DELIMITERS;
};

/**
 * What a piece of JavaScript between markers does to the blocks, in order: `[{ type: 'open', kind: 'if' | 'elseif' | 'else' | 'block', condition? }, { type: 'close' }]`.
 * It reads tokens, not lines: strings, template literals and comments are skipped, `if (` is followed to its matching `)`, and every
 * other `{` (a function, a loop, an object) is a plain block, so a `}` always closes what really is open. Several braces in one marker
 * (`}); });`, `} else if (x) { var y = 1;`) are all counted.
 */
export const blockEvents = (code) => {
  const events = [];
  const src = String(code);
  let i = 0;
  let afterElse = false;
  const skipSpace = (k) => { while (k < src.length && /\s/.test(src[k])) k++; return k; };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
      i++; afterElse = false; continue;
    }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (ch === '{') { events.push({ type: 'open', kind: 'block' }); i++; afterElse = false; continue; }
    if (ch === '}') { events.push({ type: 'close' }); i++; afterElse = false; continue; }
    if (/[A-Za-z_$]/.test(ch)) {
      let k = i;
      while (k < src.length && /[\w$]/.test(src[k])) k++;
      const word = src.slice(i, k);
      const prev = src[i - 1];
      if (prev === '.' ) { i = k; afterElse = false; continue; } // a property called `if`/`else`: not a statement
      if (word === 'else') {
        const n = skipSpace(k);
        if (src[n] === '{') { events.push({ type: 'open', kind: 'else' }); i = n + 1; afterElse = false; continue; }
        afterElse = true; i = k; continue;
      }
      if (word === 'if') {
        const n = skipSpace(k);
        if (src[n] === '(') {
          let depth = 0; let q = n; let quote = '';
          for (; q < src.length; q++) {
            const c = src[q];
            if (quote) { if (c === '\\') q++; else if (c === quote) quote = ''; continue; }
            if (c === '"' || c === "'" || c === '`') quote = c;
            else if (c === '(') depth++;
            else if (c === ')' && --depth === 0) break;
          }
          const body = skipSpace(q + 1);
          if (depth === 0 && src[body] === '{') {
            events.push({ type: 'open', kind: afterElse ? 'elseif' : 'if', condition: src.slice(n + 1, q) });
            i = body + 1; afterElse = false; continue;
          }
          i = q + 1; afterElse = false; continue;
        }
      }
      i = k; afterElse = false; continue;
    }
    if (!/\s/.test(ch)) afterElse = false;
    i++;
  }
  return events;
};

/**
 * The annotated regions of a text: `[{ startLine, endLine, expression, features, elseOf?, plainElse?, unclosed? }]` (1-based, inclusive;
 * the lines are those of the markers). A region is an `if`, an `else if` or an `else` branch; they nest, and come in the order they open.
 * Loops, functions and other blocks open and close too, so the `}` of a loop never closes somebody else's `if`.
 */
export const parseAnnotations = (text, { delimiters = DEFAULT_DELIMITERS } = {}) => {
  const regions = [];
  const stack = []; // a region, or null for a block that is not one
  let lastClosed = null;
  for (const op of parseOperators(text, { delimiters })) {
    if (op.kind === 'echo' || op.kind === 'header') continue;
    lastClosed = null;
    for (const ev of blockEvents(op.code)) {
      if (ev.type === 'close') {
        const region = stack.pop();
        if (region) { region.endLine = op.endLine; region.contentEnd = op.start }
        lastClosed = region ?? { expression: undefined, features: [] };
        continue;
      }
      if (ev.kind === 'block') { stack.push(null); lastClosed = null; continue; }
      let region;
      // `contentStart`..`contentEnd` are the offsets of what the region holds: from the end of its opening marker to the start of its closing one
      if (ev.kind === 'if') region = { startLine: op.startLine, endLine: op.startLine, expression: plainExpression(ev.condition), features: featuresIn(ev.condition) };
      else if (ev.kind === 'elseif') region = { startLine: op.startLine, endLine: op.startLine, expression: plainExpression(ev.condition), features: featuresIn(ev.condition), elseOf: lastClosed?.expression ?? '' };
      else region = { startLine: op.startLine, endLine: op.startLine, expression: `!(${lastClosed?.expression ?? ''})`, features: lastClosed?.features ?? [], elseOf: lastClosed?.expression ?? '', plainElse: true };
      Object.assign(region, { markerStart: op.start, contentStart: op.end, contentEnd: text.length });
      lastClosed = null;
      regions.push(region);
      stack.push(region);
    }
  }
  const last = text.split('\n').length;
  for (const region of stack) if (region) { region.endLine = last; region.unclosed = true; region.contentEnd = text.length; }
  return regions;
};

// Every marker of a text, whatever it does: the three things the engine reads between delimiters.
//  - header  (start + @ ... end) at the very start of the file: JavaScript that returns the files to make out of it
//            ([{ fileName, basePath, context }]), the file is made once for each of them.
//  - echo    (start + = expression + end): the value of the expression is written in the output, as text.
//  - if elseif else close loop code: plain JavaScript run while deriving (conditions, loops, `var x = ...`).
// Result: [{ kind, startLine, endLine, code, start, end, features, vars }] (1-based lines, offsets of the whole marker; `code` is what
// is between the delimiters without the `@` or `=`; `features` the names after `feature.`; `vars` what var/let/const declares).
export const parseOperators = (text, { delimiters = DEFAULT_DELIMITERS } = {}) => {
  const [start, end] = delimiters;
  const block = new RegExp(`${escape(start)}([\\s\\S]*?)${escape(end)}`, 'g');
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0; let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const out = [];
  for (const match of text.matchAll(block)) {
    const raw = match[1];
    const base = { startLine: lineOf(match.index), endLine: lineOf(match.index + match[0].length - 1), start: match.index, end: match.index + match[0].length };
    if (raw.startsWith('@') && match.index === 0) { out.push({ ...base, kind: 'header', code: raw.slice(1).trim(), features: featuresIn(raw), vars: [] }); continue; }
    if (raw.trim().startsWith('=')) { out.push({ ...base, kind: 'echo', code: raw.trim().slice(1).trim(), features: featuresIn(raw), vars: [] }); continue; }
    const code = raw.trim().replace(/\s+/g, ' ');
    const opens = /\{\s*$/.test(code);
    let kind = 'code';
    if (IF.test(code)) kind = 'if';
    else if (ELSE_IF.test(code)) kind = 'elseif';
    else if (ELSE.test(code)) kind = 'else';
    else if (CLOSE.test(code)) kind = 'close';
    else if (opens && /^(for|while|do|switch)\b|\.(forEach|map|filter|flatMap|reduce)\s*\(/.test(code)) kind = 'loop';
    else if (/^\}/.test(code) || opens) kind = opens ? 'loop' : 'close';
    out.push({ ...base, kind, code: raw.trim(), features: featuresIn(raw), vars: declared(raw) });
  }
  return out;
};

/** The names a piece of JavaScript declares with `var`, `let` or `const` (`var a = 1, b = f(2, 3)`: a and b). */
export const declared = (code) => {
  const text = String(code);
  const names = [];
  for (const m of text.matchAll(/\b(?:var|let|const)\s+/g)) {
    let depth = 0; let quote = ''; let piece = ''; const pieces = [];
    for (let i = m.index + m[0].length; i < text.length; i++) {
      const ch = text[i];
      if (quote) { piece += ch; if (ch === '\\') piece += text[++i] ?? ''; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; piece += ch; continue; }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (--depth < 0) break; } else if (depth === 0 && ch === ';') break;
      if (depth === 0 && ch === ',') { pieces.push(piece); piece = ''; continue; }
      piece += ch;
    }
    pieces.push(piece);
    for (const p of pieces) { const id = /^\s*([A-Za-z_$][\w$]*)\s*(=|$)/.exec(p); if (id) names.push(id[1]); }
  }
  return [...new Set(names)];
};

const RESERVED = new Set(['true', 'false', 'null', 'undefined']);
/** What a person may type as the condition: names joined by `&& || ! ( )`; a `feature.` before a name is accepted. Returns the plain text or null. */
export const cleanExpression = (feature) => {
  const text = String(feature ?? '').trim().replace(/\bfeature\./g, '');
  if (!text || !/^[\w$\s|&!()]+$/.test(text) || /^[\s|&!()]*$/.test(text)) return null;
  const words = text.match(/[\w$]+/g) ?? [];
  if (!words.every((w) => /^[A-Za-z_$][\w$]*$/.test(w) && !RESERVED.has(w))) return null;
  let depth = 0;
  for (const ch of text) { if (ch === '(') depth++; else if (ch === ')' && --depth < 0) return null; }
  return depth === 0 ? text : null;
};
const toExpression = (feature) => {
  const text = cleanExpression(feature);
  if (!text) throw Object.assign(new Error('Not a feature expression'), { status: 400 });
  return text.replace(/[A-Za-z_$][\w$]*/g, (id) => `feature.${id}`);
};

const lineSplit = (text) => { const eol = text.includes('\r\n') ? '\r\n' : '\n'; return { eol, lines: text.split(/\r?\n/) }; };

/** `text` with lines `startLine`..`endLine` (1-based) wrapped in a region of `feature` (a name or an expression of names). */
export const annotateRange = (text, { startLine, endLine, feature, delimiters = DEFAULT_DELIMITERS }) => {
  const { eol, lines } = lineSplit(text);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw Object.assign(new Error('Lines out of range'), { status: 400 });
  }
  const expression = toExpression(feature);
  // the empty "line" after the last line break is no line: a selection of the whole file ends before it
  if (endLine === lines.length && endLine > startLine && lines[endLine - 1] === '') endLine--;
  const indent = /^\s*/.exec(lines[startLine - 1])[0];
  const [s, e] = delimiters;
  lines.splice(endLine, 0, `${indent}${s} } ${e}`);
  lines.splice(startLine - 1, 0, `${indent}${s} if (${expression}) { ${e}`);
  return lines.join(eol);
};

/** `text` without the region that starts at `line` (its markers; the code between stays). Branches of an else are refused. */
export const removeAnnotation = (text, { line, delimiters = DEFAULT_DELIMITERS }) => {
  const region = parseAnnotations(text, { delimiters }).find((r) => r.startLine === line);
  if (!region) throw Object.assign(new Error('No annotation starts there'), { status: 404 });
  const regions = parseAnnotations(text, { delimiters });
  // a branch of an if/else, or an `if` that has an else after it: taking one marker away would leave the others unbalanced
  if (region.elseOf !== undefined || regions.some((r) => r.elseOf !== undefined && r.startLine === region.endLine)) throw Object.assign(new Error('Remove the whole if/else by hand'), { status: 400 });
  const { eol, lines } = lineSplit(text);
  const [s, e] = delimiters;
  const marker = new RegExp(`${escape(s)}[\\s\\S]*?${escape(e)}`);
  const strip = (index) => {
    const value = lines[index];
    if (value.replace(marker, '').trim() === '') lines[index] = null; else lines[index] = value.replace(marker, '');
  };
  strip(region.endLine - 1);
  strip(region.startLine - 1);
  return lines.filter((l) => l !== null).join(eol);
};

const UVL_WORDS = new Set(['features', 'constraints', 'imports', 'include', 'namespace', 'mandatory', 'optional', 'or', 'alternative', 'cardinality']);
/** The feature names of a feature model, UVL (indented names) or XML (`name="..."`). */
export const featureNames = (model) => {
  const text = String(model ?? '');
  if (/^\s*</.test(text)) return [...new Set([...text.matchAll(/<(?:feature|and|or|alt|branch|leaf|struct)[^>]*\bname="([^"]+)"/g)].map((m) => m[1]))];
  const names = [];
  let inFeatures = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '');
    if (/^features\s*$/.test(line)) { inFeatures = true; continue; }
    if (/^constraints\s*$/.test(line)) break;
    if (!inFeatures || !line.trim()) continue;
    const m = /^\s*(?:"([^"]+)"|([A-Za-z_][\w.]*))/.exec(line);
    const name = m?.[1] ?? m?.[2];
    if (name && !UVL_WORDS.has(name)) names.push(name);
  }
  return [...new Set(names)];
};

/** The feature names of LINEA's own feature model text (`feature A { optional { feature B } }`), root first. */
export const lineaModelNames = (text) => {
  const clean = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return [...new Set([...clean.matchAll(/\bfeature\s+("([^"]+)"|[A-Za-z_][\w$.]*)/g)].map((m) => m[2] ?? m[1]))];
};
