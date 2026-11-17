// Which regions of a file are on for a configuration (the features a person ticked): what the editor dims, and what the bar says.

const SAFE = /^[\w$\s|&!()]+$/;

/** true / false for a region's condition (`a && !b`) under the enabled features; null when it is not a plain condition of names. */
export const evalExpression = (expression, enabled) => {
  const text = String(expression ?? '').trim();
  if (!text || !SAFE.test(text) || /^[\s|&!()]*$/.test(text)) return null;
  try {
    // the names are replaced by true/false: nothing of the file's own code is run
    const source = text.replace(/[A-Za-z_$][\w$]*/g, (n) => (n === 'true' || n === 'false' ? n : String(enabled.has(n))));
    return Boolean(new Function(`return (${source});`)());
  } catch { return null; }
};

// Walks the regions in order and says, for each one, whether it is off. A region is off when its condition is false, when one that holds
// it is off, or, for an `else if` / `else`, when an earlier branch of its chain was taken (only one branch of a chain is written).
// `contains(entry, region)` says whether a region that was open is still open when `region` starts.
const walk = (regions, enabled, closedBefore, mark) => {
  const stack = []
  for (const region of regions) {
    let previous = null
    while (stack.length && closedBefore(stack[stack.length - 1], region)) previous = stack.pop()
    const inside = stack.some((r) => r.off)
    const value = evalExpression(region.expression, enabled)
    let taken // is the branch written, as far as it can be told: true, false, or null (not a plain condition)
    if (region.elseOf !== undefined) {
      // a branch of a chain: it is written only if no earlier branch was
      const before = previous && previous.chain !== undefined ? previous.chain : null
      if (before === true) taken = false
      else if (region.plainElse) taken = before === null ? null : !before
      else taken = value === null ? null : (before === false || before === null) && value
    } else taken = value
    // whether some branch of the chain has been written so far: true / false / null (not known)
    const prevChain = region.elseOf !== undefined && previous ? previous.chain : null
    const chain = region.elseOf === undefined ? value : (prevChain === true ? true : (taken === null || prevChain === null ? null : Boolean(taken)))
    const entry = { endLine: region.endLine, contentEnd: region.contentEnd, off: inside || taken === false, chain }
    stack.push(entry)
    mark(region, entry)
  }
}

/**
 * The regions that are off under a configuration: `[{ startLine, endLine }]`. A condition that cannot be read is taken as on (nothing is
 * dimmed that might be there).
 */
export const inactiveRanges = (regions, enabled) => {
  const off = []
  walk(regions, enabled,
    // an else opens on the very line where its if closes: it is not inside it
    (top, region) => (region.elseOf !== undefined ? top.endLine <= region.startLine : top.endLine < region.startLine),
    (region, entry) => { if (entry.off) off.push({ startLine: region.startLine, endLine: region.endLine }) })
  return off
}

/** `{ on: [...], off: [...] }` of the features a file uses, for the summary. */
export const summary = (used, enabled) => ({ on: used.filter((f) => enabled.has(f)), off: used.filter((f) => !enabled.has(f)) });

// The pieces of text a configuration leaves out: [{ from, to }] (offsets). Only what a region holds is off: the code on the same line as
// its closing marker (an `else` before a marker that closes, then `if (x) {` after it) stays on. A region is off when its condition is
// false or one that holds it is.
export const inactiveSpans = (regions, enabled) => {
  const spans = []
  walk(regions.filter((r) => r.contentStart !== undefined), enabled,
    (top, region) => top.contentEnd <= region.markerStart,
    (region, entry) => { if (entry.off) spans.push({ from: region.contentStart, to: region.contentEnd }) })
  return spans
}
