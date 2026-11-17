// Everything the editor asks: LINEA's repository API for files and commits (the same for every git host) and the plugin's own routes
// for annotations. The app's axios carries the session.

let http = null
export const setApi = (api) => { http = api }

// the public settings of the plugin (`ui.settings`)
export let settings = { maxFileKb: 512, editableExtensions: [] }
export const setSettings = (value) => { settings = { ...settings, ...(value ?? {}) } }

const PLUGIN = '/plugins/spl-code-editor'
const repo = (lineId) => `/lines/${encodeURIComponent(lineId)}/repo`

export const decode = (b64 = '') => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}
export const encode = (text) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const repoApi = {
  info: (lineId) => http.get(repo(lineId)).then((r) => r.data),
  branches: (lineId) => http.get(`${repo(lineId)}/branches`).then((r) => r.data),
  createBranch: (lineId, branch, ref) => http.post(`${repo(lineId)}/branches`, { branch, ref }).then((r) => r.data),
  files: (lineId, ref) => http.get(`${repo(lineId)}/files`, { params: { ref } }).then((r) => r.data),
  file: (lineId, path, ref) => http.get(`${repo(lineId)}/file`, { params: { path, ref } }).then((r) => r.data),
  commit: (lineId, branch, message, actions) => http.post(`${repo(lineId)}/commits`, { branch, message, actions }).then((r) => r.data),
}

export const pluginApi = {
  features: (lineId, ref) => http.get(`${PLUGIN}/lines/${encodeURIComponent(lineId)}/features`, { params: { ref } }).then((r) => r.data),
  annotate: (lineId, body) => http.post(`${PLUGIN}/lines/${encodeURIComponent(lineId)}/annotate`, body).then((r) => r.data),
  reindex: (lineId, ref) => http.post(`${PLUGIN}/lines/${encodeURIComponent(lineId)}/reindex`, { ref, force: true }).then((r) => r.data),
  tryDerivation: (lineId, body) => http.post(`${PLUGIN}/lines/${encodeURIComponent(lineId)}/try`, body).then((r) => r.data),
}

/** The message of a failed call, in the server's words when it gave any. */
export const messageOf = (error) => error?.response?.data?.error ?? error?.response?.data?.message ?? error?.message ?? String(error)
