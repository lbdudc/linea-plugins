// Where a template runs: a frame with no way into the page. The templates of a repository are code somebody else may have written, so
// they never run in the page itself: the frame has an opaque origin (no session, no storage, no access to LINEA), no network, and it is
// thrown away when it takes too long.
import { execute } from './sandbox.js'

const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'"

/** Runs `execute(input)` in a sandboxed frame; answers its result, or `{ ok: false, error: { phase: 'timeout' } }` when it takes over `timeout` ms. */
export const runSandboxed = (input, timeout = 8000) => new Promise((resolve) => {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.display = 'none'
  let settled = false
  let timer = null
  const finish = (result) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    window.removeEventListener('message', onMessage)
    frame.remove()
    resolve(result)
  }
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow) return
    const msg = event.data ?? {}
    if (msg.type === 'ready') {
      try { frame.contentWindow.postMessage({ type: 'run', input: JSON.parse(JSON.stringify(input)) }, '*') } catch (error) { finish({ ok: false, outputs: [], marks: {}, trace: [], error: { phase: 'run', message: String(error.message ?? error) } }) }
    }
    else if (msg.type === 'result') finish(msg.result)
    else if (msg.type === 'failed') finish({ ok: false, outputs: [], marks: {}, trace: [], error: { phase: 'run', message: msg.message } })
  }
  window.addEventListener('message', onMessage)
  timer = setTimeout(() => finish({ ok: false, outputs: [], marks: {}, trace: [], error: { phase: 'timeout', message: `the template took more than ${Math.round(timeout / 1000)} s (an endless loop?)` } }), timeout)
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><script>
const execute = ${execute.toString()};
addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'run') return;
  try { parent.postMessage({ type: 'result', result: JSON.parse(JSON.stringify(execute(event.data.input))) }, '*'); }
  catch (error) { parent.postMessage({ type: 'failed', message: String(error && error.message || error) }, '*'); }
});
parent.postMessage({ type: 'ready' }, '*');
<\/script>`
  document.body.appendChild(frame)
})
