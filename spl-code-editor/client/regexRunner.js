// A search with a regular expression of the user's own can take for ever (`(a+)+$`): it runs in a worker that is stopped when it takes too long.
const SOURCE = `
self.onmessage = (e) => {
  const { id, text, query, flags, limit } = e.data;
  try {
    const re = new RegExp(query, flags);
    const lines = String(text).split(/\\r?\\n/);
    const found = [];
    for (let i = 0; i < lines.length && found.length < limit; i++) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) && found.length < limit) {
        if (!m[0].length) { re.lastIndex++; continue; }
        found.push({ line: i + 1, column: m.index + 1, length: m[0].length, preview: lines[i] });
      }
    }
    self.postMessage({ id, found });
  } catch (error) { self.postMessage({ id, error: String(error.message) }); }
};`;

export const createRegexRunner = ({ timeout = 2000 } = {}) => {
  let worker = null;
  let seq = 0;
  const stop = () => { worker?.terminate(); worker = null; };
  const run = (text, { source, flags }, limit = 200) => new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') return reject(Object.assign(new Error('no worker'), { unsupported: true }));
    if (!worker) worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' })));
    const id = ++seq;
    const w = worker;
    const timer = setTimeout(() => { stop(); reject(Object.assign(new Error('Search too slow'), { slow: true })); }, timeout);
    w.onmessage = (e) => { if (e.data.id !== id) return; clearTimeout(timer); if (e.data.error) reject(Object.assign(new Error(e.data.error), { invalid: true })); else resolve(e.data.found); };
    w.onerror = (e) => { clearTimeout(timer); stop(); reject(new Error(e.message)); };
    w.postMessage({ id, text, query: source, flags, limit });
  });
  return { run, stop };
};
