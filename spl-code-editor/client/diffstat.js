// How many lines a change adds and removes (what the changes dialog shows beside each file); the same count a diff would give.

/** `{ added, removed }` between two texts, line by line. */
export const lineStats = (before, after) => {
  const a = before === '' ? [] : String(before).split(/\r?\n/);
  const b = after === '' ? [] : String(after).split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (!x.length || !y.length) return { added: y.length, removed: x.length };
  let common;
  if (x.length * y.length > 4_000_000) {
    // too big for the exact count: lines in common, whatever their order
    const seen = new Map();
    for (const line of x) seen.set(line, (seen.get(line) ?? 0) + 1);
    common = 0;
    for (const line of y) { const n = seen.get(line) ?? 0; if (n > 0) { common++; seen.set(line, n - 1); } }
  } else {
    let previous = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
      const row = [0];
      for (let j = 1; j <= y.length; j++) row[j] = x[i - 1] === y[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
      previous = row;
    }
    common = previous[y.length];
  }
  return { added: y.length - common, removed: x.length - common };
};
