
// LCS-based line diff over two arrays of lines. Bounded: very large inputs fall
// back to remove-then-add rather than an O(n·m) table.
const diffArrays = (a, b) => {
  const n = a.length;
  const m = b.length;

  if (n * m > 1_500_000) {
    return [...a.map((t) => ({ type: 'del', text: t })), ...b.map((t) => ({ type: 'add', text: t }))];
  }

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
};

// For DiffView: split raw (a trailing newline shows as a trailing blank line).
export const lineDiff = (oldText, newText) =>
  diffArrays((oldText ?? '').split('\n'), (newText ?? '').split('\n'));

// Group a flat line-diff into unified-diff hunks with `context` lines around each
// change. Returns [{ oldStart, oldLines, newStart, newLines, rows }].
const toHunks = (rows, context = 3) => {
  // Mark which rows are "interesting" (changes) plus their context window.
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, idx) => {
    if (r.type === 'ctx') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k++) keep[k] = true;
  });

  const hunks = [];
  let cur = null;
  let oldLine = 1;
  let newLine = 1;

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    if (keep[idx]) {
      if (!cur) cur = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, rows: [] };
      cur.rows.push(r);
      if (r.type !== 'add') cur.oldLines++;
      if (r.type !== 'del') cur.newLines++;
    } else if (cur) {
      hunks.push(cur);
      cur = null;
    }
    if (r.type !== 'add') oldLine++;
    if (r.type !== 'del') newLine++;
  }
  if (cur) hunks.push(cur);
  return hunks;
};

const sign = (type) => (type === 'add' ? '+' : type === 'del' ? '-' : ' ');

// Drop a single trailing empty element produced by splitting trailing-newline text.
const splitLines = (text) => {
  const arr = (text ?? '').split('\n');
  if (arr.length > 1 && arr[arr.length - 1] === '') arr.pop();
  return arr;
};

const NO_NL = '\\ No newline at end of file';
const lacksTrailingNewline = (text) => text !== '' && text != null && !text.endsWith('\n');

// Sentinel appended to a side's final line when that side has no trailing newline.
// Tagging makes the differ treat "c" (no newline, EOF) as distinct from "c\n"
// (mid-file), which is exactly how git produces correct `\ No newline` markers.
const NONL_TAG = '  NO_NEWLINE  ';

const taggedLines = (text, noNL) => {
  const lines = splitLines(text);
  if (noNL && lines.length) lines[lines.length - 1] += NONL_TAG;
  return lines;
};

/** A unified diff for one file. Handles create (empty old) and delete (empty new). */
export const buildUnifiedDiff = ({ path, oldText, newText, action }) => {
  const old = oldText ?? '';
  const next = newText ?? '';
  if (old === next) return '';

  const isCreate = action === 'create' || old === '';
  const isDelete = action === 'delete' || next === '';

  // Whole-file add/remove: emit a clean -0,0 / +0,0 hunk (no context artifacts).
  if (isCreate || isDelete) {
    const body = isCreate ? splitLines(next) : splitLines(old);
    if (!body.length) return '';
    const header = [`diff --git a/${path} b/${path}`];
    header.push(isCreate ? 'new file mode 100644' : 'deleted file mode 100644');
    header.push(`--- ${isCreate ? '/dev/null' : `a/${path}`}`, `+++ ${isDelete ? '/dev/null' : `b/${path}`}`);
    header.push(isCreate ? `@@ -0,0 +1,${body.length} @@` : `@@ -1,${body.length} +0,0 @@`);
    for (const line of body) header.push(`${isCreate ? '+' : '-'}${line}`);
    if ((isCreate && lacksTrailingNewline(next)) || (isDelete && lacksTrailingNewline(old))) header.push(NO_NL);
    return header.join('\n');
  }

  // Tag each side's final line when it lacks a trailing newline, diff over the
  // clean (no sentinel) lines so hunk counts are exact, then render the tag as a
  // `\ No newline at end of file` marker.
  const rows = diffArrays(taggedLines(old, lacksTrailingNewline(old)), taggedLines(next, lacksTrailingNewline(next)));
  const hunks = toHunks(rows);
  if (!hunks.length) return '';

  const lines = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const oldHdr = `${h.oldLines === 0 ? h.oldStart - 1 : h.oldStart},${h.oldLines}`;
    const newHdr = `${h.newLines === 0 ? h.newStart - 1 : h.newStart},${h.newLines}`;
    lines.push(`@@ -${oldHdr} +${newHdr} @@`);
    for (const r of h.rows) {
      if (r.text.endsWith(NONL_TAG)) {
        lines.push(`${sign(r.type)}${r.text.slice(0, -NONL_TAG.length)}`);
        lines.push(NO_NL);
      } else {
        lines.push(`${sign(r.type)}${r.text}`);
      }
    }
  }
  return lines.join('\n');
};

/** Combine several file changes into one downloadable patch. */
export const buildPatch = (files) => {
  const parts = (files ?? [])
    .map((f) => buildUnifiedDiff({ path: f.path, oldText: f.old, newText: f.new, action: f.action }))
    .filter(Boolean);
  return parts.length ? `${parts.join('\n')}\n` : '';
};

/** Trigger a browser download of `content` as `filename`. */
export const downloadText = (filename, content) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
