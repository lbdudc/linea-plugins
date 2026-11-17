<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, shallowRef, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import FileTree from './FileTree.vue'
import Splitter from './Splitter.vue'
import { readLayout, fit, dockPosition, compareSize, DEFAULT_LAYOUT, COMPACT_WIDTH, clamp, LIMITS } from './panes.js'
import { buildTree, regionAt } from './tree.js'
import { repoApi, pluginApi, decode, encode, messageOf, settings } from './api.js'
import { delimitersFor, parseAnnotations, parseOperators, annotateRange, removeAnnotation, cleanExpression } from '../shared/parser.js'
import { runSandboxed } from './sandboxHost.js'
import { readModel, completeSelection } from './selection.js'
import * as scen from './scenarios.js'
import ProblemsList from './ProblemsList.vue'
import ProductView from './ProductView.vue'
import { parseProblems, fixFor, fixAll } from './diagnose.js'
import { MODEL_PATH, derivedPath, featureModelNames, addFeatures, diagnose, undeclared, suggestions } from './assist.js'
import { createRegexRunner } from './regexRunner.js'
import { inactiveSpans, summary } from './config.js'
import { lineStats } from './diffstat.js'
import { rankFiles, parseQuickInput, searchText, replaceText, searchRegExp, nextRegionLine, nextFeatureLine } from './nav.js'
import { colorMap, css, decorationRuns, lookOf, presetIds, STRENGTH, DEFAULT_PRESET, FALLBACK } from './colors.js'

defineOptions({ inheritAttrs: false })
const props = defineProps({ lineId: { type: String, required: true }, line: { type: Object, default: () => ({}) } })
const { t } = useI18n()

const root = ref(null)
const container = ref(null)
const monaco = shallowRef(null)
let editor = null
const models = new Map() // path -> monaco model
const originals = new Map() // path -> { text, revision } of what the branch has
let decorations = []
let dims = []

const info = ref(null)
const branches = ref([])
const branch = ref('')
const files = ref([])
const changes = reactive({}) // path -> { action: create | update | delete, content?, revision? }
const current = ref(null)
const notice = ref('')
const status = ref({ kind: '', text: '' })
const loading = ref(true)
const panel = ref('files')
// the left bar folds away to give the code all the width; it is remembered
const readSide = () => { try { return localStorage.getItem('spl-code-editor.side') !== 'closed' } catch { return true } }
const sideOpen = ref(readSide())
watch(sideOpen, (on) => { try { localStorage.setItem('spl-code-editor.side', on ? 'open' : 'closed') } catch { /* not kept */ } })
const PANELS = [['files', 'pi-folder'], ['search', 'pi-search'], ['features', 'pi-tags']]
const panelLabel = (p) => p
const showPanel = (name) => { panel.value = name; sideOpen.value = true }

// ---------- the panes: sizes, where the dock sits, which of its three views is on ----------
// Side bar | code | dock. The dock is where everything about "what would this file be for a product" lives: its Result, the Scenario that
// is being simulated (features and data) and the Debugger. Every line between panes can be dragged; narrow windows fold the side bar and
// put the dock under the code. All of it is remembered.
const LAYOUT_KEY = 'spl-code-editor.layout'
const layout = reactive(readLayout((() => { try { return localStorage.getItem(LAYOUT_KEY) } catch { return null } })()))
watch(layout, () => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...layout })) } catch { /* not kept */ } }, { deep: true })
const size = reactive({ width: 1200, height: 700 })
const compact = computed(() => size.width < COMPACT_WIDTH)
const dockPos = computed(() => (debugFull.value ? 'right' : dockPosition(layout.pos, size.width)))
const dockBottom = computed(() => dockPos.value === 'bottom')
const sideWidth = computed(() => fit('side', layout.side, size.width))
// in the debugger the code and the product go side by side (half each) unless the person set another size
const sideBySide = computed(() => layout.tab === 'debug' && layout.compare && !dockBottom.value)
const dockSize = computed(() => {
  // the product gets the room; each view added next to it takes a bit more from the code
  if (debugFull.value) return Math.round(size.width * layout.fullDock)
  if (dockBottom.value) return fit('dockBottom', layout.dockBottom, size.height)
  if (sideBySide.value) return compareSize(size.width - (sideOpen.value ? sideWidth.value + 1 : 44))
  return fit('dock', layout.dock, size.width)
})
const dockStyle = computed(() => ({ flex: `0 0 ${dockSize.value}px` }))
const dragSide = (dx) => { layout.side = clamp(sideWidth.value + dx, ...LIMITS.side) }
const dragDock = (delta) => {
  if (debugFull.value) { layout.fullDock = clamp(layout.fullDock - delta / Math.max(1, size.width), 0.25, 0.85); return }
  // the dock grows when its line moves towards the code: left on the right, up at the bottom
  if (dockBottom.value) layout.dockBottom = clamp(dockSize.value - delta, ...LIMITS.dockBottom)
  else { layout.dock = clamp(dockSize.value - delta, ...LIMITS.dock); layout.compare = false }
}
const resetSide = () => { layout.side = DEFAULT_LAYOUT.side }
const resetDock = () => {
  layout.fullDock = DEFAULT_LAYOUT.fullDock
  layout.dock = DEFAULT_LAYOUT.dock; layout.dockBottom = DEFAULT_LAYOUT.dockBottom; layout.compare = true }
const toggleCompare = () => { layout.compare = !layout.compare; if (layout.compare) { layout.pos = 'right'; layout.tab = 'debug'; derived.open = true } }
const DOCK_TABS = [['result', 'pi-eye'], ['scenario', 'pi-sliders-h'], ['debug', 'pi-bug']]
// opening a view opens the dock; the code of the open file is derived for it
const openDock = (tab) => { layout.tab = tab; derived.open = true }
const toggleDockPos = () => { layout.pos = layout.pos === 'right' ? 'bottom' : 'right' }
let sizeObserver = null
let compactSeen = false
watch(compact, (on) => { if (on && !compactSeen) { sideOpen.value = false } compactSeen = compactSeen || on })
watch(() => layout.tab, () => { if (derived.open) scheduleDerive(0) })
const cfgFilter = ref('')
const onlyHere = ref(false)

// annotations
const serverNames = ref([]) // the features of the model the branch has
const delimiters = ref({}) // by extension, from the line's engine config
const byFeature = ref({})
const regions = ref([])
const featureInput = ref('')
const filter = ref('')

// trial
// the configuration being looked at: remembered for the line, so it is there next time
const cfgKey = () => `spl-code-editor.config.${props.lineId}`
const readConfig = () => { try { return new Set(JSON.parse(localStorage.getItem(cfgKey()) ?? '[]')) } catch { return new Set() } }
const config = ref(readConfig())
watch(config, (value) => { try { localStorage.setItem(cfgKey(), JSON.stringify([...value])) } catch { /* not kept */ } })
const trial = ref(null)
const trialRunning = ref(false)

// moving around: the open files, the recent ones, going to a file, searching in all of them, the whole window
const tabs = ref([]) // paths of the open files, in the order they were opened
const recent = ref([])
const viewStates = new Map() // path -> where the cursor and the scroll were
const treeFilter = ref('')
const maximized = ref(false)
const quick = reactive({ open: false, text: '', index: 0 })
const quickInput = ref(null)
const search = reactive({ query: '', replace: '', caseSensitive: false, regex: false, word: false, running: false, done: false, error: '', results: [], total: 0 })
const contentCache = new Map() // branch + path -> text of what the branch has, for searching what is not open
let searchRun = 0
const regexRunner = createRegexRunner()
let themeWatch = null

// asking for a path (new file / rename)
const pathAsk = reactive({ open: false, kind: '', from: '', value: '' })
// the commit dialog
const commit = reactive({ open: false, branch: '', message: '', busy: false, error: '' })
// what git refuses in a branch name, said before asking the server
const branchProblem = computed(() => {
  const b = commit.branch.trim()
  if (!b) return ''
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(b) || b.includes('..') || b.includes('@{') || b.includes('//') || /^[/.-]|[/.]$|\.lock$|\/\./.test(b) || b === '@') return t('splCodeEditor.branch_invalid')
  return ''
})
const readable = (text) => (/^error_messages\./.test(text) ? t(text) : text)

let statusTimer = null
// a message stays long enough to read and then goes; the next one replaces it
const say = (kind, text) => { status.value = { kind, text }; clearTimeout(statusTimer); statusTimer = setTimeout(() => { status.value = { kind: '', text: '' } }, kind === 'error' ? 10000 : 5000) }
const base = computed(() => info.value?.defaultBranch ?? 'main')
const allowed = computed(() => {
  const list = Array.isArray(settings.editableExtensions) ? settings.editableExtensions : String(settings.editableExtensions ?? '').split(',')
  return new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))
})
const editable = (path) => path.endsWith('.featuremodel') || !allowed.value.size || allowed.value.has(path.split('/').pop().split('.').slice(1).pop()?.toLowerCase() ?? '')

const visiblePaths = computed(() => {
  const all = new Set(files.value)
  for (const [path, change] of Object.entries(changes)) if (change.action === 'create') all.add(path)
  return [...all].sort()
})
const treePaths = computed(() => { const f = treeFilter.value.trim().toLowerCase(); return f ? visiblePaths.value.filter((p) => p.toLowerCase().includes(f)) : visiblePaths.value })
const tree = computed(() => buildTree(treePaths.value))
const changeCount = computed(() => Object.keys(changes).length)
const branchExists = computed(() => branches.value.includes(branch.value))

const darkMode = () => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor)
  return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.5 : false
}

// ---------- colors ----------
// every feature has its own color (see colors.js); the rules of the looks in use are written to one stylesheet
const readPreset = () => { try { const id = localStorage.getItem('spl-code-editor.palette'); return presetIds.includes(id) ? id : DEFAULT_PRESET } catch { return DEFAULT_PRESET } }
const preset = ref(readPreset())
const setPreset = () => { try { localStorage.setItem('spl-code-editor.palette', preset.value) } catch { /* not kept */ } }
// the features of the model, root first: the branch's, or the model's own text once it is being edited here
const names = computed(() => {
  const pending = changes[MODEL_PATH]
  return pending && pending.action !== 'delete' && pending.content !== undefined ? featureModelNames(pending.content) : serverNames.value
})
const featureChoices = computed(() => names.value.slice(1)) // the root is in every configuration: nothing to annotate with it
// what is ticked and still exists in the model (a remembered name that was renamed or removed is not sent)
const enabledFeatures = computed(() => [...config.value].filter((n) => featureChoices.value.includes(n)))
const missing = computed(() => (names.value.length ? undeclared([...Object.keys(byFeature.value), ...regions.value.flatMap((r) => r.features)], names.value) : []))
const colors = computed(() => colorMap([...names.value, ...Object.keys(byFeature.value), ...regions.value.flatMap((r) => r.features)], preset.value))
const swatch = (name) => ({ background: css(colors.value[name] ?? FALLBACK) })
const legendOpen = ref(false)
const onLegendOut = (event) => { if (!event.currentTarget.contains(event.relatedTarget)) legendOpen.value = false }
const fileFeatures = computed(() => [...new Set(regions.value.flatMap((r) => r.features))])
const looks = new Map() // key -> class number
let sheet = null
const lookClass = (run) => {
  const key = `${run.key}|${JSON.stringify(run.chain.map((r) => r.features.map((f) => colors.value[f])))}`
  let n = looks.get(key)
  if (n === undefined) {
    n = looks.size
    looks.set(key, n)
    if (!sheet) { sheet = document.createElement('style'); sheet.dataset.sce = ''; document.head.appendChild(sheet) }
    const look = lookOf(run.chain, run.marker, colors.value, STRENGTH[preset.value])
    sheet.appendChild(document.createTextNode(`.sce-bg-${n}{background:${look.background}}.sce-mg-${n}{background:${look.margin}}\n`))
  }
  return n
}

// ---------- the three things the engine reads ----------
const operators = ref([])
let opDecor = []
const OP_CLASS = { echo: 'sce-op sce-op-echo', header: 'sce-op sce-op-header', code: 'sce-op sce-op-code', loop: 'sce-op sce-op-code' }
const dark0 = () => darkMode()
const opHover = (o) => {
  const kind = t(`splCodeEditor.op_${o.kind}`)
  const what = t(`splCodeEditor.op_${o.kind}_help`)
  return `**${kind}**\n\n${what}\n\n\`${o.code.replace(/\s+/g, ' ').slice(0, 160)}\``
}
const opCounts = computed(() => {
  const c = { header: 0, echo: 0, code: 0, cond: 0 }
  for (const o of operators.value) {
    if (o.kind === 'header') c.header++
    else if (o.kind === 'echo') c.echo++
    else if (o.kind === 'if' || o.kind === 'elseif') c.cond++
    else if (o.kind === 'code' || o.kind === 'loop') c.code++
  }
  return c
})
const shownOperators = computed(() => operators.value.filter((o) => ['header', 'echo', 'code', 'loop'].includes(o.kind)))

// ---------- the editor ----------
const refreshDecorations = () => {
  if (!editor || !current.value) return
  const model = editor.getModel()
  if (!model) return
  const table = delimiters.value
  regions.value = parseAnnotations(model.getValue(), { delimiters: delimitersFor(current.value, table) })
  operators.value = parseOperators(model.getValue(), { delimiters: delimitersFor(current.value, table) })
  const M = monaco.value
  // the other things the engine reads: `=` writes a value, `@` makes files, plain code runs: each has its own color and a hover that says so
  opDecor = editor.deltaDecorations(opDecor, operators.value.filter((o) => OP_CLASS[o.kind]).map((o) => {
    const from = model.getPositionAt(o.start)
    const to = model.getPositionAt(o.end)
    return { range: new M.Range(from.lineNumber, from.column, to.lineNumber, to.column), options: { inlineClassName: `${OP_CLASS[o.kind]} ${dark0() ? 'sce-op--dark' : 'sce-op--light'}`, hoverMessage: { value: opHover(o) } } }
  }))
  M.editor.setModelMarkers(model, 'sce', diagnose(regions.value, names.value).map((d) => ({
    severity: d.kind === 'unclosed' ? M.MarkerSeverity.Error : M.MarkerSeverity.Warning,
    message: d.kind === 'unclosed' ? t('splCodeEditor.diag_unclosed') : t('splCodeEditor.diag_unknown', { name: d.feature }),
    startLineNumber: d.line, endLineNumber: d.line, startColumn: 1, endColumn: model.getLineMaxColumn(d.line),
  })))
  // what the chosen configuration leaves out is dimmed (only in the files that are part of the product)
  dims = editor.deltaDecorations(dims, derivedPath(current.value) ? inactiveSpans(regions.value, new Set(enabledFeatures.value)).map((s) => { const a = model.getPositionAt(s.from); const b = model.getPositionAt(s.to); return { range: new M.Range(a.lineNumber, a.column, b.lineNumber, b.column), options: { inlineClassName: 'sce-off' } } }) : [])
  const dark = darkMode()
  decorations = editor.deltaDecorations(decorations, decorationRuns(regions.value, model.getLineCount()).flatMap((run) => {
    const n = lookClass(run)
    const inner = run.chain[run.chain.length - 1]
    const list = [{
      range: new M.Range(run.from, 1, run.to, 1),
      options: {
        isWholeLine: true,
        className: `sce-bg-${n}`,
        linesDecorationsClassName: `sce-mg-${n}`,
        hoverMessage: { value: run.chain.map((r) => `**${r.elseOf !== undefined ? '¬ ' : ''}${r.expression}**`).join(' › ') },
        overviewRuler: { color: css(colors.value[inner.features[0]] ?? FALLBACK, 0.9), position: M.editor.OverviewRulerLane.Right },
      },
    }]
    // the text of a marker (`/*% if (...) { %*/`) is a comment to the editor's theme: dim green on a tint, hard to read; it gets its own color
    if (run.marker) list.push({ range: new M.Range(run.from, 1, run.to, model.getLineMaxColumn(run.to)), options: { inlineClassName: dark ? 'sce-marker-text sce-marker-text--dark' : 'sce-marker-text sce-marker-text--light' } })
    return list
  }))
}

const onChange = (path) => {
  const model = models.get(path)
  if (!model) return
  const text = model.getValue()
  const original = originals.get(path)
  if (!original) changes[path] = { action: 'create', content: text }
  else if (text === original.text) delete changes[path]
  else changes[path] = { action: 'update', content: text, revision: original.revision }
  if (path === current.value) refreshDecorations()
  // what the debugger showed belongs to the text it ran on: it goes unless it is about to run again
  if (debug.result && !(derived.open && (derived.source === 'local' || layout.tab === 'debug'))) { debug.result = null; refreshDebugDecorations() }
  scheduleDerive(800)
}

// extensions Monaco does not know by itself: the closest language it has (.vue is HTML with script and style)
const LANGUAGE_OF = { vue: 'html', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', properties: 'ini', env: 'ini', conf: 'ini', jsp: 'html', xhtml: 'html', svg: 'xml', sld: 'xml', gradle: 'java', tsx: 'typescript', zsh: 'shell', bash: 'shell', yml: 'yaml' }
const modelFor = (path, text) => {
  const M = monaco.value
  const uri = M.Uri.parse(`inmemory:///${encodeURI(path)}`)
  let model = M.editor.getModel(uri)
  if (!model) model = M.editor.createModel(text, LANGUAGE_OF[path.split('.').pop().toLowerCase()], uri)
  models.set(path, model)
  model.onDidChangeContent(() => onChange(path))
  return model
}

// the model of a file (made when it is first needed), or why there is none: too big, not text
const loadModel = async (path) => {
  if (models.has(path)) return { model: models.get(path) }
  let text = changes[path]?.content
  if (text === undefined) {
    const file = await repoApi.file(props.lineId, path, branch.value)
    text = decode(file.content)
    if (text.length > settings.maxFileKb * 1024) return { notice: t('splCodeEditor.too_big', { kb: settings.maxFileKb }) }
    if (text.includes('\0')) return { notice: t('splCodeEditor.binary') }
    originals.set(path, { text, revision: file.revision })
  }
  return { model: modelFor(path, text) }
}

const track = (path) => {
  if (!tabs.value.includes(path)) tabs.value = [...tabs.value, path]
  recent.value = [path, ...recent.value.filter((p) => p !== path)].slice(0, 30)
}

const showNotice = (path, text) => { current.value = path; editor?.setModel(null); regions.value = []; notice.value = text; track(path) }

const open = async (path, line, column, length) => {
  notice.value = ''
  if (current.value && current.value !== path && editor?.getModel()) viewStates.set(current.value, editor.saveViewState())
  if (!editable(path)) { showNotice(path, t('splCodeEditor.binary')); return }
  try {
    const loaded = await loadModel(path)
    if (!loaded.model) { showNotice(path, loaded.notice); return }
    current.value = path
    track(path)
    editor.setModel(loaded.model)
    refreshDecorations()
    const saved = viewStates.get(path)
    if (saved && !line) editor.restoreViewState(saved)
    if (line) {
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: column ?? 1 })
      if (column && length) editor.setSelection(new monaco.value.Range(line, column, line, column + length))
    }
    editor.focus()
  } catch (error) { say('error', messageOf(error)) }
}

const closeTab = (path) => {
  const index = tabs.value.indexOf(path)
  if (index < 0) return
  if (current.value === path && editor?.getModel()) viewStates.set(path, editor.saveViewState())
  tabs.value = tabs.value.filter((p) => p !== path)
  if (current.value !== path) return
  const next = tabs.value[index] ?? tabs.value[index - 1]
  if (next) open(next)
  else { current.value = null; editor?.setModel(null); regions.value = []; notice.value = '' }
}
const tabLabel = (path) => {
  const name = path.split('/').pop()
  return tabs.value.some((p) => p !== path && p.split('/').pop() === name) ? path.split('/').slice(-2).join('/') : name
}
const crumbs = computed(() => (current.value ? current.value.split('/') : []))
const filterFolder = (index) => { treeFilter.value = `${crumbs.value.slice(0, index + 1).join('/')}/`; panel.value = 'files' }

// ---------- files ----------
const dropModel = (path) => { models.get(path)?.dispose(); models.delete(path) }
const askPath = (kind, from = '') => { Object.assign(pathAsk, { open: true, kind, from, value: from }); nextTick(() => document.querySelector('.sce__pathinput input')?.focus()) }
// why a path is refused ('' when it is fine)
const pathProblem = (p) => {
  if (!p) return t('splCodeEditor.path_empty')
  if (p.startsWith('/') || p.endsWith('/') || /\\|\0/.test(p) || p.split('/').some((part) => part === '..' || part === '.' || part === '')) return t('splCodeEditor.path_invalid')
  if (visiblePaths.value.includes(p)) return t('splCodeEditor.path_exists', { path: p })
  if (visiblePaths.value.some((f) => f.startsWith(`${p}/`) || p.startsWith(`${f}/`))) return t('splCodeEditor.path_clash')
  return ''
}

const submitPath = async () => {
  const value = pathAsk.value.trim().replace(/^\.\//, '')
  const problem = pathProblem(value)
  if (problem) { say('error', problem); return }
  pathAsk.open = false
  if (pathAsk.kind === 'new') {
    changes[value] = { action: 'create', content: '' }
    modelFor(value, '')
    await open(value)
  } else {
    const from = pathAsk.from
    let text = models.get(from)?.getValue() ?? changes[from]?.content
    if (text === undefined) text = decode((await repoApi.file(props.lineId, from, branch.value)).content)
    removeFile(from)
    changes[value] = { action: 'create', content: text }
    modelFor(value, text)
    await open(value)
  }
}

const removeFile = (path) => {
  dropModel(path)
  if (changes[path]?.action === 'create') delete changes[path]
  else changes[path] = { action: 'delete', revision: originals.get(path)?.revision }
  const index = tabs.value.indexOf(path)
  tabs.value = tabs.value.filter((p) => p !== path)
  recent.value = recent.value.filter((p) => p !== path)
  if (current.value === path) {
    const next = tabs.value[index] ?? tabs.value[index - 1]
    current.value = null; editor?.setModel(null); regions.value = []
    if (next) open(next)
  }
}

const discard = () => {
  for (const path of [...models.keys()]) dropModel(path)
  for (const key of Object.keys(changes)) delete changes[key]
  originals.clear()
  // the tabs of files that exist stay (as in VS Code); only the new files are gone
  const kept = tabs.value.filter((p) => files.value.includes(p))
  tabs.value = kept
  viewStates.clear()
  const keep = kept.includes(current.value) ? current.value : kept[kept.length - 1]
  current.value = null
  editor?.setModel(null)
  if (keep) open(keep)
}

// ---------- branches, index, saving ----------
let loadedBranch = '' // the branch whose files are on screen
const loadFiles = async () => { loadedBranch = branch.value; contentCache.clear(); files.value = await repoApi.files(props.lineId, branch.value) }
const loadFeatures = async () => {
  try {
    const data = await pluginApi.features(props.lineId, branch.value)
    serverNames.value = data.names ?? []
    delimiters.value = data.delimiters ?? {}
    byFeature.value = data.annotations ?? {}
  } catch (error) { say('error', messageOf(error)) }
}

// switching with changes not saved asks first, in the app's own dialog (a native confirm freezes the page)
const switchAsk = reactive({ open: false, target: '' })
const goToBranch = async () => {
  discard()
  await loadFiles()
  await loadFeatures()
}
const switchBranch = async (event) => {
  if (changeCount.value && branch.value !== loadedBranch) {
    switchAsk.target = branch.value
    switchAsk.open = true
    branch.value = loadedBranch
    if (event?.target) event.target.value = loadedBranch
    return
  }
  await goToBranch()
}
const confirmSwitch = async () => {
  switchAsk.open = false
  branch.value = switchAsk.target
  await goToBranch()
}

const openCommit = () => { Object.assign(commit, { open: true, branch: branch.value, message: t('splCodeEditor.commit_default'), error: '' }) }
const doCommit = async () => {
  if (branchProblem.value || !commit.message.trim()) return
  commit.busy = true
  commit.error = ''
  try {
    const target = commit.branch.trim()
    if (!branches.value.includes(target)) {
      await repoApi.createBranch(props.lineId, target, branch.value)
      branches.value = [...branches.value, target]
    }
    const actions = Object.entries(changes).map(([path, c]) => (c.action === 'delete'
      ? { action: 'delete', path }
      : { action: c.action, path, content: c.content, encoding: 'text', ...(c.action === 'update' && target === branch.value && c.revision ? { expectedRevision: c.revision } : {}) }))
    await repoApi.commit(props.lineId, target, commit.message, actions)
    commit.open = false
    say('ok', t('splCodeEditor.saved', { branch: target }))
    const keep = current.value
    const keepTabs = [...tabs.value]
    branch.value = target
    discard()
    await loadFiles()
    tabs.value = keepTabs.filter((p) => files.value.includes(p))
    await pluginApi.reindex(props.lineId, target).catch(() => {})
    await loadFeatures()
    if (keep && files.value.includes(keep)) await open(keep)
  } catch (error) { commit.error = readable(messageOf(error)) } finally { commit.busy = false }
}

const reindex = async () => {
  try { await pluginApi.reindex(props.lineId, branch.value); await loadFeatures(); say('ok', t('splCodeEditor.reindex')) } catch (error) { say('error', messageOf(error)) }
}

// ---------- annotations ----------
// Done here, on what the editor holds: no round trip, and it works on text that is not saved yet.
const annotateWith = (feature) => {
  const model = editor?.getModel()
  if (!model || !current.value) { say('error', t('splCodeEditor.nothing_to_annotate')); return }
  const selection = editor.getSelection()
  const startLine = selection.startLineNumber
  const endLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber
  try {
    const text = annotateRange(model.getValue(), { startLine, endLine, feature, delimiters: delimitersFor(current.value, delimiters.value) })
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
    editor.revealLineInCenterIfOutsideViewport(startLine)
    editor.setPosition({ lineNumber: startLine + 1, column: 1 })
    featureInput.value = ''
    say('ok', t('splCodeEditor.annotated', { feature, from: startLine, to: endLine }))
  } catch (error) { say('error', error.status === 400 && /feature expression/i.test(error.message) ? t('splCodeEditor.bad_expression') : error.message) }
}
const unannotateHere = () => {
  const model = editor?.getModel()
  if (!model || !current.value) { say('error', t('splCodeEditor.nothing_to_annotate')); return }
  const region = regionAt(regions.value, editor.getPosition().lineNumber)
  if (!region) { say('error', t('splCodeEditor.no_region_here')); return }
  try {
    const text = removeAnnotation(model.getValue(), { line: region.startLine, delimiters: delimitersFor(current.value, delimiters.value) })
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
  } catch (error) { say('error', error.message) }
}
// the button: with a feature typed it annotates; without, it asks which (the features of the model, or a new one)
const annotate = (remove = false) => {
  if (remove) return unannotateHere()
  const typed = featureInput.value.trim()
  if (typed) annotateWith(typed); else openPick()
}

const pick = reactive({ open: false, text: '', index: 0 })
const pickInput = ref(null)
const pickItems = computed(() => {
  const q = pick.text.trim()
  const list = featureChoices.value.filter((n) => !q || n.toLowerCase().includes(q.toLowerCase())).map((name) => ({ name, unknown: [] }))
  const typed = cleanExpression(q)
  if (typed && !featureChoices.value.includes(typed)) list.push({ name: typed, unknown: undeclared(typed.match(/[A-Za-z_$][\w$]*/g) ?? [], names.value) })
  return list
})
watch(() => pick.text, () => { pick.index = 0 })
const openPick = () => {
  if (!editor?.getModel() || !current.value) { say('error', t('splCodeEditor.nothing_to_annotate')); return }
  Object.assign(pick, { open: true, text: '', index: 0 })
  nextTick(() => pickInput.value?.focus())
}
const closePick = () => { pick.open = false; editor?.focus() }
const choosePick = (item) => {
  pick.open = false
  annotateWith(item.name)
  if (item.unknown.length) addToModel(item.unknown)
  editor?.focus()
}
const onPickKey = (event) => {
  const count = pickItems.value.length
  if (event.key === 'ArrowDown') { event.preventDefault(); if (count) pick.index = (pick.index + 1) % count }
  else if (event.key === 'ArrowUp') { event.preventDefault(); if (count) pick.index = (pick.index - 1 + count) % count }
  else if (event.key === 'Enter') { event.preventDefault(); if (count) choosePick(pickItems.value[pick.index]) }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePick() }
}

// declare features in the feature model (the file is edited here, like any other, and saved with the rest)
const missingHere = computed(() => missing.value.filter((n) => fileFeatures.value.includes(n)))
const dismissedMissing = ref(new Set())
const addToModel = async (list) => {
  if (!files.value.includes(MODEL_PATH) && !changes[MODEL_PATH]) { say('error', t('splCodeEditor.no_model')); return }
  try {
    const loaded = await loadModel(MODEL_PATH)
    if (!loaded.model) throw new Error(loaded.notice)
    const before = loaded.model.getValue()
    const after = addFeatures(before, list)
    if (after === before) { say('error', t('splCodeEditor.model_unchanged')); return }
    loaded.model.pushEditOperations([], [{ range: loaded.model.getFullModelRange(), text: after }], () => null)
    say('ok', t('splCodeEditor.model_updated', { names: list.join(', ') }))
  } catch (error) { say('error', messageOf(error)) }
}

const shownNames = computed(() => names.value.filter((n) => !filter.value || n.toLowerCase().includes(filter.value.toLowerCase())))
const countOf = (name) => byFeature.value[name]?.length ?? 0
const places = computed(() => Object.entries(byFeature.value).filter(([name]) => !filter.value || name.toLowerCase().includes(filter.value.toLowerCase())))

// ---------- going to a file, searching, jumping ----------
const quickParsed = computed(() => parseQuickInput(quick.text))
const quickResults = computed(() => {
  const { query, line } = quickParsed.value
  if (!query && line) return []
  return rankFiles(query, visiblePaths.value.filter((p) => changes[p]?.action !== 'delete'), recent.value).slice(0, 60)
})
watch(() => quick.text, () => { quick.index = 0 })
const segments = (path, positions) => {
  const hits = new Set(positions)
  const out = []
  for (let i = 0; i < path.length; i++) {
    const hit = hits.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += path[i]; else out.push({ text: path[i], hit })
  }
  return out
}
const openQuick = () => { Object.assign(quick, { open: true, text: '', index: 0 }); nextTick(() => quickInput.value?.focus()) }
const closeQuick = () => { quick.open = false; editor?.focus() }
const pickQuick = (result) => {
  const { line, column } = quickParsed.value
  quick.open = false
  open(result.path, line ?? undefined, column ?? undefined)
}
const onQuickKey = (event) => {
  const count = quickResults.value.length
  if (event.key === 'ArrowDown') { event.preventDefault(); if (count) quick.index = (quick.index + 1) % count }
  else if (event.key === 'ArrowUp') { event.preventDefault(); if (count) quick.index = (quick.index - 1 + count) % count }
  else if (event.key === 'Enter') {
    event.preventDefault()
    const { line, column } = quickParsed.value
    if (count) pickQuick(quickResults.value[quick.index])
    else if (line && editor?.getModel()) { quick.open = false; editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: column ?? 1 }); editor.focus() }
  } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeQuick() }
}

const searchOptions = () => ({ query: search.query, caseSensitive: search.caseSensitive, regex: search.regex, word: search.word })
const textOf = async (path) => {
  const model = models.get(path)
  if (model) return model.getValue()
  if (changes[path]?.content !== undefined) return changes[path].content
  const key = `${branch.value}\0${path}`
  if (contentCache.has(key)) return contentCache.get(key)
  const text = decode((await repoApi.file(props.lineId, path, branch.value)).content)
  const value = text.length > settings.maxFileKb * 1024 || text.includes('\0') ? null : text
  contentCache.set(key, value)
  return value
}
const runSearch = async () => {
  const run = ++searchRun
  search.error = ''
  const options = searchOptions()
  let compiled
  try { compiled = searchRegExp(options) } catch (error) {
    search.error = error.invalid ? t('splCodeEditor.search_invalid') : ''
    Object.assign(search, { results: [], total: 0, running: false, done: false })
    return
  }
  search.running = true
  const paths = visiblePaths.value.filter((p) => editable(p) && changes[p]?.action !== 'delete')
  const results = []
  let total = 0
  let next = 0
  let slow = false
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++]
      try {
        const text = await textOf(path)
        if (run !== searchRun) return
        if (text == null) continue
        const matches = options.regex ? await regexRunner.run(text, { source: compiled.source, flags: compiled.flags }) : searchText(text, options)
        if (run !== searchRun) return
        if (matches.length) { results.push({ path, matches }); total += matches.length }
      } catch (error) {
        if (error.slow || error.invalid) { slow = error.slow ? true : slow; next = paths.length; if (error.invalid) search.error = t('splCodeEditor.search_invalid') }
        /* otherwise a file that cannot be read is left out */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.regex ? 1 : 6, paths.length) }, worker))
  if (run !== searchRun) return
  results.sort((a, b) => a.path.localeCompare(b.path))
  if (slow) search.error = t('splCodeEditor.search_slow')
  // an incomplete search must not feed "replace all"
  Object.assign(search, search.error ? { results: [], total: 0, running: false, done: false } : { results, total, running: false, done: true })
}
let searchTimer = null
watch(() => [search.query, search.caseSensitive, search.regex, search.word], () => { clearTimeout(searchTimer); regexRunner.stop(); searchTimer = setTimeout(runSearch, 250) })
const replaceAll = async () => {
  const options = searchOptions()
  let files = 0
  let count = 0
  for (const { path, matches } of search.results) {
    const loaded = await loadModel(path)
    if (!loaded.model) continue
    const before = loaded.model.getValue()
    const after = replaceText(before, options, search.replace)
    if (after === before) continue
    loaded.model.pushEditOperations([], [{ range: loaded.model.getFullModelRange(), text: after }], () => null)
    files++
    count += matches.length
  }
  say('ok', t('splCodeEditor.replaced', { n: count, f: files }))
  await runSearch()
}
const previewParts = (m) => {
  const lead = m.preview.length - m.preview.trimStart().length
  const start = Math.max(lead, m.column - 1)
  const before = m.preview.slice(lead, start)
  return { before: before.length > 30 ? `…${before.slice(-30)}` : before, hit: m.preview.slice(start, start + m.length), after: m.preview.slice(start + m.length, start + m.length + 80) }
}
const openSearch = () => {
  panel.value = 'search'
  sideOpen.value = true // a folded side bar would leave the typing in the editor
  const selection = editor?.getModel() && editor.getSelection()
  if (selection && !selection.isEmpty() && selection.startLineNumber === selection.endLineNumber) search.query = editor.getModel().getValueInRange(selection)
  nextTick(() => document.querySelector('[data-test=search-input]')?.select())
}
const searchSummary = computed(() => t('splCodeEditor.search_summary', { n: search.total, f: search.results.length }))

const jumpTo = (line) => {
  if (line == null) { say('error', t('splCodeEditor.no_region')); return }
  editor.revealLineInCenter(line)
  editor.setPosition({ lineNumber: line, column: 1 })
  editor.focus()
}
const jumpRegion = (direction) => { if (editor?.getModel()) jumpTo(nextRegionLine(regions.value, editor.getPosition().lineNumber, direction)) }
const jumpFeature = (name) => { if (editor?.getModel()) jumpTo(nextFeatureLine(regions.value, name, editor.getPosition().lineNumber)) }

const setMaximized = async (on) => {
  maximized.value = on
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.()
    else if (!on && document.fullscreenElement) await document.exitFullscreen()
  } catch { /* the window alone is enough */ }
  nextTick(() => editor?.layout())
}
const onFullscreenChange = () => { if (!document.fullscreenElement && maximized.value) { maximized.value = false; if (debugFull.value) exitDebugFull() } nextTick(() => editor?.layout()) }

// heard on the whole page (a click on an empty part of the editor leaves the focus outside it), but only while the editor is on screen
const onKey = (event) => {
  if (!root.value || !root.value.getClientRects().length) return
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (mod && !event.shiftKey && !event.altKey && key === 'p') { event.preventDefault(); openQuick() }
  else if (mod && event.shiftKey && !event.altKey && key === 'f') { event.preventDefault(); openSearch() }
  else if (mod && !event.shiftKey && !event.altKey && key === 's') { event.preventDefault(); if (changeCount.value) openCommit() }
  else if (mod && !event.shiftKey && !event.altKey && key === 'b') { event.preventDefault(); sideOpen.value = !sideOpen.value }
  else if (event.key === 'F7') { event.preventDefault(); jumpRegion(event.shiftKey ? -1 : 1) }
  else if (event.key === 'Escape' && !event.defaultPrevented && debugFull.value && !quick.open && !commit.open) exitDebugFull()
  else if (event.key === 'Escape' && !event.defaultPrevented && maximized.value && !quick.open && !commit.open) setMaximized(false)
}
const warnUnsaved = (event) => { if (changeCount.value) { event.preventDefault(); event.returnValue = '' } }

// ---------- the output of a file for a configuration ----------
const derived = reactive({ open: false, running: false, state: 'idle', error: '', diagnostics: [], files: 0, ms: 0, path: '', source: 'linea', options: [], problems: [], rest: [], warnings: [], fileCheck: null, localError: null, lineaOk: null })
const derivedBox = ref(null)
let derivedEditor = null
let deriveRun = 0
let deriveTimer = null
const derivedTarget = computed(() => derivedPath(current.value))
const scheduleDerive = (delay = 600) => { if (!derived.open) return; clearTimeout(deriveTimer); deriveTimer = setTimeout(runDerive, delay) }
const overridesOf = () => Object.entries(changes).map(([path, c]) => ({ path, action: c.action, ...(c.action === 'delete' ? {} : { content: c.content }) }))
const showDerived = async (path, text) => {
  await nextTick()
  const M = monaco.value
  if (!derivedEditor) {
    derivedEditor = M.editor.create(derivedBox.value, { readOnly: true, automaticLayout: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, glyphMargin: false, theme: darkMode() ? 'vs-dark' : 'vs', model: null })
  }
  const uri = M.Uri.parse(`derived:///${encodeURI(path)}`)
  let model = M.editor.getModel(uri)
  if (!model) model = M.editor.createModel(text, undefined, uri)
  else if (model.getValue() !== text) model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
  if (derivedEditor.getModel() !== model) derivedEditor.setModel(model)
}
const runDerive = async () => {
  // the scenario tab asks LINEA (is it a valid product?); the debugger and the Browser source run here
  if ((derived.source === 'local' && layout.tab !== 'scenario') || layout.tab === 'debug') return runLocal()
  const run = ++deriveRun
  const target = derivedTarget.value
  derived.path = target ?? ''
  if (!current.value) { derived.state = 'idle'; return }
  if (!target) { derived.state = 'outside'; return }
  derived.running = true
  const started = performance.now()
  try {
    // a template that is named otherwise in the product, or that makes several files, is asked for by what it makes
    const made = (await madePaths(current.value)) ?? [target]
    if (run !== deriveRun) return
    derived.options = made
    const result = await pluginApi.tryDerivation(props.lineId, { features: enabledFeatures.value, ref: branch.value, files: overridesOf(), include: made.slice(0, 20), ...specPart() })
    if (run !== deriveRun) return
    derived.files = result.files?.length ?? 0
    if (!result.ok) {
      const { problems, rest } = parseProblems(result.error, result.diagnostics ?? [])
      // is it the file, or the scenario? the file is tried here, on its own
      let fileCheck = null
      try { const check = await runSandboxed(await sandboxInput(current.value, false)); fileCheck = { ok: check.ok, n: check.outputs?.length ?? 0, error: check.error?.message, line: check.error?.line } } catch { fileCheck = null }
      if (run !== deriveRun) return
      Object.assign(derived, { state: 'failed', error: result.error, diagnostics: result.diagnostics ?? [], problems, rest, warnings: (result.diagnostics ?? []).filter((d) => d.severity !== 'error'), fileCheck, localError: null, lineaOk: false })
      return
    }
    Object.assign(derived, { problems: [], rest: [], warnings: result.diagnostics ?? [], fileCheck: null, localError: null, lineaOk: true })
    const shown = made[Math.min(debug.selected, made.length - 1)]
    const text = result.contents?.[shown]
    if (text === undefined) { derived.state = result.files.includes(shown) ? 'binary' : 'absent'; return }
    derived.state = 'ok'
    await showDerived(shown, text)
  } catch (error) { if (run === deriveRun) Object.assign(derived, { state: 'failed', error: messageOf(error), diagnostics: [] }) } finally {
    if (run === deriveRun) { derived.running = false; derived.ms = Math.round(performance.now() - started) }
  }
}

// ---------- the data the templates see, and the debugger ----------
// The `=` and `@` markers and the plain code of a template work on `data` (the product's spec as the SPL's transformation.js makes it):
// a sample of that spec is part of the configuration. LINEA's derivation gets it too, and so does the debugger, which runs the open
// file in a sandboxed frame of this page and says what every marker did.
const dataKey = () => `spl-code-editor.data.${props.lineId}`
const DEFAULT_DATA = '{\n  "basicData": { "name": "demo", "version": "1.0.0" }\n}'
const readData = () => { try { return localStorage.getItem(dataKey()) ?? DEFAULT_DATA } catch { return DEFAULT_DATA } }
const debug = reactive({ data: readData(), overrides: (() => { try { const o = JSON.parse(localStorage.getItem(`spl-code-editor.overrides.${props.lineId}`) ?? '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch { return {} } })(), useTransformation: true, running: false, result: null, selected: 0, ms: 0, forPath: '', showAll: false })
watch(() => debug.data, (value) => { try { localStorage.setItem(dataKey(), value) } catch { /* not kept */ } })
watch(() => debug.overrides, (value) => { try { localStorage.setItem(OVR_KEY(), JSON.stringify(value)) } catch { /* not kept */ } if (derived.open) scheduleDerive(250) }, { deep: true })
const specProblem = computed(() => {
  if (!debug.data.trim()) return ''
  try { const v = JSON.parse(debug.data); return v && typeof v === 'object' && !Array.isArray(v) ? '' : t('splCodeEditor.data_object') } catch (error) { return error.message }
})
const specOf = () => (specProblem.value || !debug.data.trim() ? undefined : JSON.parse(debug.data))

// the values of `data` the open file reads: the paths it names (`data.basicData.name`), cut where a method starts
const METHODS = new Set(['find', 'map', 'filter', 'forEach', 'some', 'every', 'reduce', 'flatMap', 'length', 'includes', 'indexOf', 'join', 'slice', 'push', 'split', 'toLowerCase', 'toUpperCase', 'sort', 'concat', 'keys', 'values', 'entries', 'trim', 'replace', 'startsWith', 'endsWith', 'toString'])
const probePaths = computed(() => {
  const found = new Set()
  for (const o of operators.value) {
    for (const m of o.code.matchAll(/\bdata((?:\??\.[A-Za-z_$][\w$]*)+)/g)) {
      const parts = m[1].replace(/\?/g, '').split('.').filter(Boolean)
      const cut = parts.findIndex((p) => METHODS.has(p))
      const path = (cut < 0 ? parts : parts.slice(0, cut)).join('.')
      if (path) found.add(path)
    }
  }
  return [...found].slice(0, 40)
})
const valueRows = computed(() => {
  const result = debug.result
  const values = result && debug.forPath === current.value ? result.values ?? {} : {}
  return probePaths.value.filter((p) => values[p] && values[p].type !== 'function').map((path) => ({ path, ...values[path], changed: path in debug.overrides }))
})
const shownValue = (row) => {
  if (row.changed) { const v = debug.overrides[row.path]; return typeof v === 'string' ? v : JSON.stringify(v) }
  return row.type === 'string' ? JSON.parse(row.json ?? '""') : (row.json ?? row.text)
}
const parseValue = (text, type) => {
  if (type === 'string') return text
  if (type === 'number') { const n = Number(text); return text.trim() !== '' && Number.isFinite(n) ? n : text }
  try { return JSON.parse(text) } catch { return text }
}
const setValue = (row, text) => {
  const value = parseValue(text, row.type)
  const original = row.json === undefined ? undefined : (() => { try { return JSON.parse(row.json) } catch { return undefined } })()
  const next = { ...debug.overrides }
  if (JSON.stringify(value) === JSON.stringify(original) && !row.changed) return
  next[row.path] = value
  debug.overrides = next
}
const setBool = (row, on) => { debug.overrides = { ...debug.overrides, [row.path]: on } }
const resetValue = (path) => { const next = { ...debug.overrides }; delete next[path]; debug.overrides = next }
const resetValues = () => { debug.overrides = {} }
const toggleHereFeature = (name) => { toggleFeature(name) }

// the choices the feature model asks for (LINEA says them when a scenario is not a valid product), made with one click
const currentSet = computed(() => new Set(enabledFeatures.value))
const applyChange = ({ add, remove }) => { const next = new Set(config.value); remove.forEach((n) => next.delete(n)); add.forEach((n) => next.add(n)); config.value = next }
const pickOption = (problem, option) => applyChange(fixFor(problem, currentSet.value, option))
const fixAllProblems = () => { config.value = new Set([...fixAll(derived.problems, currentSet.value), ...[...config.value].filter((n) => !featureChoices.value.includes(n))]) }
const colorOf = (name) => swatch(name)
const diag = computed(() => {
  if (derived.localError) return { headline: t(`splCodeEditor.phase_${derived.localError.phase}`), cause: derived.localError.hint || derived.localError.message, kind: 'file' }
  if (derived.problems.length) return { headline: t('splCodeEditor.diag_scenario_invalid'), cause: t('splCodeEditor.diag_scenario_cause', { n: derived.problems.length }, derived.problems.length), kind: 'scenario' }
  if (derived.fileCheck && !derived.fileCheck.ok) return { headline: t('splCodeEditor.diag_file_failed'), cause: derived.fileCheck.error, kind: 'file' }
  if (derived.fileCheck?.ok) return { headline: t('splCodeEditor.diag_other_failed'), cause: t('splCodeEditor.diag_other_cause'), kind: 'other' }
  return { headline: t('splCodeEditor.try_fail'), cause: t('splCodeEditor.diag_unknown_cause'), kind: 'unknown' }
})
const featureStats = computed(() => ({ on: hereFeatures.value.filter((n) => config.value.has(n)).length, total: hereFeatures.value.length }))
const valueStats = computed(() => ({ count: valueRows.value.length, changed: valueRows.value.filter((r) => r.changed).length }))
const dbgFilter = ref('')
const dbgFeatures = computed(() => { const f = dbgFilter.value.trim().toLowerCase(); return hereFeatures.value.filter((n) => !f || n.toLowerCase().includes(f)) })
const dataLabel = computed(() => { if (specProblem.value) return t('splCodeEditor.scenario_data_bad'); const s = specOf(); const name = s?.basicData?.name; return name ? `"${name}"` : (s && Object.keys(s).length ? t('splCodeEditor.scenario_data_some') : t('splCodeEditor.scenario_data_none')) })
const resetData = () => { debug.data = DEFAULT_DATA }
const specPart = () => { const spec = specOf(); return spec && Object.keys(spec).length ? { spec } : {} }


// ---------- scenarios: going back to earlier ones, and the values changed by hand ----------
// The scenario is the features ticked, the sample data and the values changed by hand over it. Every change is remembered (a history walked
// with back / forward like undo) and a scenario can be given a name to keep it. Values changed by hand are applied over `data` in the
// Browser source and in the debugger; LINEA's own derivation takes the sample data only.
const SCEN_KEY = () => `spl-code-editor.scenarios.${props.lineId}`
const OVR_KEY = () => `spl-code-editor.overrides.${props.lineId}`
const readOverrides = () => { try { const o = JSON.parse(localStorage.getItem(OVR_KEY()) ?? '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} } catch { return {} } }
const scenarios = reactive(scen.read((() => { try { return localStorage.getItem(SCEN_KEY()) } catch { return null } })()))
const scenName = ref('')
const scenOpen = ref(false)
const persistScenarios = () => { try { localStorage.setItem(SCEN_KEY(), JSON.stringify({ recent: scenarios.recent, saved: scenarios.saved })) } catch { /* not kept */ } }
const currentSnap = () => scen.snapshot({ features: enabledFeatures.value, data: debug.data, overrides: debug.overrides })
const scenWords = (snap) => scen.describe(snap, { featuresWord: (n) => t('splCodeEditor.scen_features', { n }), changedWord: (n) => t('splCodeEditor.scen_changed', { n }) })
const currentWords = computed(() => scenWords(currentSnap()))
const canBack = computed(() => scen.canBack(scenarios))
const canForward = computed(() => scen.canForward(scenarios))
const applyScenario = (snap) => {
  config.value = new Set(snap.features)
  debug.data = snap.data
  debug.overrides = { ...snap.overrides }
}
const goHistory = (direction) => {
  const cursor = scen.step(scenarios, direction)
  if (cursor === scenarios.cursor) return
  scenarios.cursor = cursor
  applyScenario(scenarios.recent[cursor])
}
const pickRecent = (index) => { scenarios.cursor = index; applyScenario(scenarios.recent[index]); scenOpen.value = false }
const pickSaved = (item) => { applyScenario(item.snap); scenOpen.value = false }
const saveScenario = () => {
  const saved = scen.save(scenarios.saved, scenName.value, currentSnap())
  if (saved === scenarios.saved) return
  scenarios.saved = saved
  persistScenarios()
  say('ok', t('splCodeEditor.scen_saved', { name: scenName.value.trim() }))
  scenName.value = ''
}
const dropScenario = (name) => { scenarios.saved = scen.remove(scenarios.saved, name); persistScenarios() }
const onScenOut = (event) => { if (!event.currentTarget.contains(event.relatedTarget)) scenOpen.value = false }
let scenTimer = null
const remember = () => {
  clearTimeout(scenTimer)
  scenTimer = setTimeout(() => {
    const snap = currentSnap()
    // looking at an entry of the history that has not changed: nothing new
    if (scenarios.recent[scenarios.cursor] && scen.same(scenarios.recent[scenarios.cursor], snap)) return
    Object.assign(scenarios, scen.record(scenarios, snap))
    persistScenarios()
  }, 1000)
}

// ---------- the product line by line: where each line comes from, and why ----------
const debugView = ref('product')
const TWEAKS_KEY = 'spl-code-editor.tweaks'
const tweaksOpen = ref((() => { try { return localStorage.getItem(TWEAKS_KEY) !== 'closed' } catch { return true } })())
watch(tweaksOpen, (on) => { try { localStorage.setItem(TWEAKS_KEY, on ? 'open' : 'closed') } catch { /* not kept */ } })
const cursorLine = ref(0)
let originDecor = []
const showOrigin = (lines) => {
  const model = editor?.getModel()
  if (!model) return
  const M = monaco.value
  const unique = [...new Set(lines)].filter((n) => n >= 1 && n <= model.getLineCount())
  originDecor = editor.deltaDecorations(originDecor, unique.map((n) => ({ range: new M.Range(n, 1, n, 1), options: { isWholeLine: true, className: 'sce-origin-line', linesDecorationsClassName: 'sce-origin-margin' } })))
}
const clearOrigin = () => { if (editor) originDecor = editor.deltaDecorations(originDecor, []) }
const fillView = computed(() => layout.tab === 'debug' && Boolean(debug.result?.ok) && debug.forPath === current.value)

// ---------- the debugger on the whole screen: code | product | decisions | controls, side by side ----------
const debugFull = ref(false)
// which views besides the product go next to it on the whole screen (the product is always there); kept
const FULL_KEY = 'spl-code-editor.fullviews'
const readFullViews = () => { try { const l = JSON.parse(localStorage.getItem(FULL_KEY) ?? '[]'); return new Set(Array.isArray(l) ? l.filter((v) => ['decisions', 'controls', 'trace'].includes(v)) : []) } catch { return new Set() } }
const fullViews = ref(readFullViews())
const toggleFullView = (view) => { const next = new Set(fullViews.value); if (next.has(view)) next.delete(view); else next.add(view); fullViews.value = next; try { localStorage.setItem(FULL_KEY, JSON.stringify([...next])) } catch { /* not kept */ } }
const fullProductViews = computed(() => ['product', ...(fullViews.value.has('decisions') ? ['decisions'] : [])])
const COLS_KEY = 'spl-code-editor.fullcols'
const readCols = () => { try { const o = JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} } }
const fullWeights = ref({ product: 1.5, decisions: 1, controls: 1, trace: 1, ...readCols() })
const fullVisible = computed(() => ['product', ...['decisions', 'controls', 'trace'].filter((v) => fullViews.value.has(v))])
const colStyle = (view) => (debugFull.value ? { gridColumn: 2 * fullVisible.value.indexOf(view) + 1, gridRow: 1 } : null)
const fullColumns = computed(() => fullVisible.value.map((v) => `minmax(0, ${fullWeights.value[v] ?? 1}fr)`).join(' 7px '))
const fullGrid = ref(null)
const dragCol = (index, dx) => {
  const a = fullVisible.value[index]
  const b = fullVisible.value[index + 1]
  const width = (fullGrid.value?.getBoundingClientRect().width ?? 600) - 7 * (fullVisible.value.length - 1)
  const total = fullVisible.value.reduce((sum, v) => sum + (fullWeights.value[v] ?? 1), 0)
  const delta = dx / Math.max(1, width / total)
  const next = { ...fullWeights.value }
  const wa = Math.max(0.35, (next[a] ?? 1) + delta)
  const wb = Math.max(0.35, (next[b] ?? 1) - delta)
  if (wa === 0.35 && delta < 0) return
  if (wb === 0.35 && delta > 0) return
  next[a] = wa; next[b] = wb
  fullWeights.value = next
}
const saveCols = () => { try { localStorage.setItem(COLS_KEY, JSON.stringify(fullWeights.value)) } catch { /* not kept */ } }
const resetCols = () => { fullWeights.value = { product: 1.5, decisions: 1, controls: 1, trace: 1 }; saveCols() }
// the bars around the code are not in the full-screen debugger unless the person asks for them
const PANELS_KEY = 'spl-code-editor.fullpanels'
const readFullPanels = () => { try { const l = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '[]'); return new Set(Array.isArray(l) ? l.filter((v) => ['annotate', 'scenario', 'crumbs', 'side'].includes(v)) : []) } catch { return new Set() } }
const fullPanels = ref(readFullPanels())
const toggleFullPanel = (name) => { const next = new Set(fullPanels.value); if (next.has(name)) next.delete(name); else next.add(name); fullPanels.value = next; if (name === 'side') sideOpen.value = next.has('side'); try { localStorage.setItem(PANELS_KEY, JSON.stringify([...next])) } catch { /* not kept */ } }
const bar = (name) => !debugFull.value || fullPanels.value.has(name)
const showControls = computed(() => (debugFull.value ? fullViews.value.has('controls') : debugView.value === 'controls'))
const showTrace = computed(() => (debugFull.value ? fullViews.value.has('trace') : debugView.value === 'trace'))
let beforeFull = null
const enterDebugFull = async () => {
  beforeFull = { maximized: maximized.value, side: sideOpen.value, pos: layout.pos, tab: layout.tab, view: debugView.value }
  debugFull.value = true
  layout.tab = 'debug'
  layout.pos = 'right'
  sideOpen.value = fullPanels.value.has('side')
  derived.open = true
  if (!maximized.value) await setMaximized(true)
  scheduleDerive(0)
}
const exitDebugFull = async () => {
  debugFull.value = false
  if (!beforeFull) return
  const was = beforeFull
  beforeFull = null
  sideOpen.value = was.side
  layout.pos = was.pos
  debugView.value = was.view
  if (!was.maximized) await setMaximized(false)
}
const debugOutput = computed(() => (debug.result?.ok && debug.forPath === current.value ? debug.result.outputs[Math.min(debug.selected, debug.result.outputs.length - 1)] ?? null : null))
const templateText = computed(() => { void cursorLine.value; void debug.result; return editor?.getModel()?.getValue() ?? '' })
const colorStyle = (name) => swatch(name)
watch(() => [current.value, layout.tab, debugView.value], clearOrigin)

watch([enabledFeatures, () => debug.data, () => debug.overrides], remember, { deep: true })
// the first scenario of the visit is where the history starts
watch(featureChoices, (list, before) => { if (list.length && !before?.length && !scenarios.recent.length) { Object.assign(scenarios, scen.record(scenarios, currentSnap())); persistScenarios() } })

let localRun = 0
let debugDecor = []
// the files a template makes, named by what tells them apart (their folder, when the name is the same)
const optionLabels = computed(() => {
  const parts = derived.options.map((p) => p.split('/'))
  let common = 0
  while (parts.length > 1 && parts.every((p) => p.length > common + 1 && p[common] === parts[0][common])) common++
  return parts.map((p) => p.slice(common).join('/'))
})
const localOutput = computed(() => debug.result?.outputs?.[debug.selected] ?? null)
const kindWord = (kind) => t(`splCodeEditor.op_${kind}`)

// what each marker did, shown at the end of its line: the value of an `=`, the way a condition went, what a declaration made
const refreshDebugDecorations = () => {
  const model = editor?.getModel()
  if (!model) return
  const M = monaco.value
  const result = debug.result
  const marks = result && debug.forPath === current.value ? result.marks : {}
  const list = []
  for (const m of Object.values(marks ?? {})) {
    if (!m.line || m.line > model.getLineCount() || m.kind === 'close') continue
    let text = ''
    let cls = 'sce-dbg'
    if (m.hits === 0) { text = t('splCodeEditor.dbg_not_run'); cls = 'sce-dbg sce-dbg--off' }
    else if (m.kind === 'echo') text = `→ ${m.value}${m.hits > 1 ? ` (×${m.hits})` : ''}`
    else if (m.kind === 'if') text = `→ ${m.value}${m.hits > 1 ? ` (${m.trues}/${m.hits})` : ''}`
    else if (m.vars) text = `${Object.entries(m.vars).map(([k, v]) => `${k} = ${v}`).join(', ')}${m.hits > 1 ? ` (×${m.hits})` : ''}`
    else if (m.hits > 1) text = `×${m.hits}`
    if (!text) continue
    list.push({ range: new M.Range(m.line, model.getLineMaxColumn(m.line), m.line, model.getLineMaxColumn(m.line)), options: { after: { content: `  ${text.length > 140 ? `${text.slice(0, 140)}…` : text}`, inlineClassName: cls }, showIfCollapsed: true } })
  }
  debugDecor = editor.deltaDecorations(debugDecor, list)
  const e = result && !result.ok && debug.forPath === current.value ? result.error : null
  M.editor.setModelMarkers(model, 'sce-debug', e?.line ? [{ severity: M.MarkerSeverity.Error, message: `${e.message}${e.hint ? `\n${e.hint}` : ''}`, startLineNumber: e.line, endLineNumber: e.line, startColumn: 1, endColumn: model.getLineMaxColumn(Math.min(e.line, model.getLineCount())) }] : [])
}

const showLocalOutput = async () => {
  derived.localError = null
  const out = localOutput.value
  if (!out) return
  derived.state = out.empty ? 'empty' : 'ok'
  if (!out.empty) await showDerived(`local/${debug.forPath}/${out.path}`, out.content)
}

// what the sandbox is given for the open file: its text, the delimiters, the configuration completed, the SPL's own helpers and the sample data
const sandboxInput = async (path, debugOn) => {
  const target = derivedPath(path)
  const slash = target.lastIndexOf('/')
  const [extra, transformation, modelText] = await Promise.all([
    textOf('src/platform/extra.js').catch(() => null),
    debug.useTransformation ? textOf('src/platform/transformation.js').catch(() => null) : null,
    textOf(MODEL_PATH).catch(() => null),
  ])
  return {
    text: editor.getModel().getValue(),
    fileName: target.slice(slash + 1),
    basePath: slash < 0 ? '' : target.slice(0, slash),
    delimiters: delimitersFor(path, delimiters.value),
    features: completeSelection(readModel(modelText), enabledFeatures.value),
    spec: specOf() ?? {},
    data: (specOf() ?? {}).data ?? {},
    transformation: transformation ?? undefined,
    extraJS: extra ?? '',
    overrides: { ...debug.overrides },
    probe: probePaths.value,
    debug: debugOn,
  }
}
// the files the open template makes (a `@` header, or a name the engine changes): what LINEA has to be asked for
const madePaths = async (path) => {
  try {
    const result = await runSandboxed(await sandboxInput(path, false))
    return result.ok && result.outputs.length ? result.outputs.filter((o) => !o.empty).map((o) => o.path) : null
  } catch { return null }
}

const runLocal = async () => {
  const run = ++localRun
  const path = current.value
  derived.path = derivedPath(path) ?? ''
  if (!path || !editor?.getModel()) { derived.state = 'idle'; return }
  if (!derived.path) { derived.state = 'outside'; return }
  derived.running = derived.source === 'local'; debug.running = true
  const started = performance.now()
  try {
    const result = await runSandboxed(await sandboxInput(path, true))
    if (run !== localRun) return
    debug.result = result
    debug.forPath = path
    if (derived.source === 'local') {
      derived.options = (result.outputs ?? []).map((o) => o.path)
      debug.selected = Math.min(debug.selected, Math.max(0, derived.options.length - 1))
      derived.files = result.outputs?.length ?? 0
    }
    if (derived.source !== 'local') { /* the output pane shows LINEA's: the debugger only decorates the code */ } else if (result.ok) await showLocalOutput()
    else Object.assign(derived, { state: 'failed', error: `${t(`splCodeEditor.phase_${result.error.phase}`)}: ${result.error.message}${result.error.hint ? `\n${result.error.hint}` : ''}`, diagnostics: [], problems: [], rest: [], warnings: [], fileCheck: null, localError: result.error })
    refreshDebugDecorations()
  } catch (error) { if (run === localRun) Object.assign(derived, { state: 'failed', error: messageOf(error), diagnostics: [] }) } finally {
    if (run === localRun) { derived.running = false; debug.running = false; debug.ms = Math.round(performance.now() - started); if (derived.source === 'local') derived.ms = debug.ms }
  }
}
const running = computed(() => derived.running || debug.running)
// run again with the scenario as it is now, whichever view is open (it opens the Result when nothing is)
const rerun = () => { if (!derived.open) { derived.open = true; return } clearTimeout(deriveTimer); runDerive() }
const debugRun = () => { if (!derived.open) derived.open = true; else runLocal() }
const setSource = (source) => { derived.source = source; if (derived.open) scheduleDerive(0); if (source !== 'local') refreshDebugDecorations() }
watch(() => debug.selected, () => { if (derived.source === 'local' && debug.result?.ok) showLocalOutput(); else if (derived.source === 'linea') scheduleDerive(0) })
watch(() => [debug.data, debug.useTransformation], () => { if (derived.source === 'local') scheduleDerive(500) })
const jumpToMarker = (line) => { if (editor?.getModel()) jumpTo(line) }
const traceRows = computed(() => {
  const result = debug.result
  if (!result || debug.forPath !== current.value) return []
  const rows = []
  for (const ev of result.trace ?? []) {
    const m = result.marks[ev.marker]
    if (!m) continue
    rows.push({ line: m.line, kind: m.kind, ev: ev.ev, value: typeof ev.value === 'object' ? Object.entries(ev.value).map(([k, v]) => `${k} = ${v}`).join(', ') : ev.value })
  }
  return debug.showAll ? rows : rows.slice(0, 200)
})
watch(() => derived.open, (on) => { if (on) scheduleDerive(0) })
watch(() => [enabledFeatures.value.join('|'), current.value, branch.value], () => scheduleDerive(150))
watch(enabledFeatures, () => refreshDecorations())
const unclosedLines = computed(() => regions.value.filter((r) => r.unclosed).map((r) => r.startLine))
const hereFeatures = computed(() => fileFeatures.value.filter((n) => featureChoices.value.includes(n)))
const fileSummary = computed(() => summary(hereFeatures.value, config.value))
const otherActive = computed(() => enabledFeatures.value.filter((n) => !hereFeatures.value.includes(n)))
// the list of the configuration panel: every feature of the model (the filter narrows it, never hides what is ticked without saying so)
const shownChoices = computed(() => {
  const f = cfgFilter.value.trim().toLowerCase()
  return featureChoices.value.filter((n) => (!f || n.toLowerCase().includes(f)) && (!onlyHere.value || hereFeatures.value.includes(n)))
})
// choosing a configuration is for seeing the result: the output opens with the first choice
const toggleHere = (name) => { toggleFeature(name) }
const setHere = (on) => { const next = new Set(config.value); for (const n of hereFeatures.value) { if (on) next.add(n); else next.delete(n) } config.value = next }
const setAll = (on) => { config.value = on ? new Set(featureChoices.value) : new Set() }
const editConfig = () => openDock('scenario')

// the whole derived product as a zip (not only the open file): with the configuration chosen and the changes not saved yet
const zipping = ref(false)
const downloadZip = async () => {
  zipping.value = true
  try {
    const result = await pluginApi.tryDerivation(props.lineId, { features: enabledFeatures.value, ref: branch.value, files: overridesOf(), zip: true, ...specPart() })
    if (!result.ok) { say('error', result.error || t('splCodeEditor.try_fail')); return }
    const bytes = Uint8Array.from(atob(result.zip), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
    const link = document.createElement('a')
    const slug = (text) => String(text).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
    link.href = url
    link.download = `${slug(props.line?.name || 'product')}-${slug(enabledFeatures.value.join('+') || 'base')}.zip`
    document.body.appendChild(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    say('ok', t('splCodeEditor.zip_done', { n: result.files.length }))
  } catch (error) { say('error', readable(messageOf(error))) } finally { zipping.value = false }
}
const selectionFeatures = computed(() => new Set(fileFeatures.value))

// ---------- trying a derivation ----------
const toggleFeature = (name) => {
  const next = new Set(config.value)
  if (next.has(name)) next.delete(name); else next.add(name)
  config.value = next
}
const runTrial = async () => {
  // (the whole product: the files it makes; `Derived output` shows what one of them holds)
  trialRunning.value = true
  trial.value = null
  try {
    const overrides = Object.entries(changes).map(([path, c]) => ({ path, action: c.action, ...(c.action === 'delete' ? {} : { content: c.content }) }))
    trial.value = await pluginApi.tryDerivation(props.lineId, { features: enabledFeatures.value, ref: branch.value, files: overrides, ...specPart() })
  } catch (error) { trial.value = { ok: false, error: messageOf(error), diagnostics: [] } } finally { trialRunning.value = false }
}

// ---------- reviewing the changes ----------
// what has been changed and not saved, each one with its differences and a way to take back only that one
const readSideBySide = () => { try { return localStorage.getItem('spl-code-editor.diff') === 'side' } catch { return false } }
const review = reactive({ open: false, selected: '', sideBySide: readSideBySide(), confirmAll: false, stats: {} })
watch(() => review.sideBySide, (on) => { try { localStorage.setItem('spl-code-editor.diff', on ? 'side' : 'inline') } catch { /* not kept */ } diffEditor?.updateOptions({ renderSideBySide: on }) })
const diffBox = ref(null)
let diffEditor = null
let diffSeq = 0
const changeList = computed(() => Object.entries(changes).map(([path, c]) => ({ path, action: c.action })).sort((a, b) => a.path.localeCompare(b.path)))
const originalText = async (path) => {
  const kept = originals.get(path)
  if (kept) return kept.text
  try { return decode((await repoApi.file(props.lineId, path, branch.value)).content) } catch { return '' }
}
const disposeDiff = () => { const m = diffEditor?.getModel(); diffEditor?.dispose(); diffEditor = null; m?.original.dispose(); m?.modified.dispose() }
const showDiff = async () => {
  const path = review.selected
  const change = changes[path]
  if (!review.open || !path || !change) { disposeDiff(); return }
  const before = change.action === 'create' ? '' : await originalText(path)
  const after = change.action === 'delete' ? '' : (models.get(path)?.getValue() ?? change.content ?? '')
  await nextTick()
  if (!diffBox.value || review.selected !== path || !review.open) return
  const M = monaco.value
  if (!diffEditor) diffEditor = M.editor.createDiffEditor(diffBox.value, { readOnly: true, automaticLayout: true, renderSideBySide: review.sideBySide, useInlineViewWhenSpaceIsLimited: false, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, theme: darkMode() ? 'vs-dark' : 'vs' })
  const old = diffEditor.getModel()
  const uri = (kind) => M.Uri.parse(`sce-diff-${kind}:///${encodeURI(path)}?${++diffSeq}`)
  diffEditor.setModel({ original: M.editor.createModel(before, undefined, uri('before')), modified: M.editor.createModel(after, undefined, uri('after')) })
  old?.original.dispose(); old?.modified.dispose()
}
// lines added / removed by each change, for the list (the text before is read from the branch when the file was never opened)
const loadStats = async () => {
  const entries = await Promise.all(changeList.value.map(async ({ path, action }) => {
    const before = action === 'create' ? '' : await originalText(path)
    const after = action === 'delete' ? '' : (models.get(path)?.getValue() ?? changes[path]?.content ?? '')
    return [path, lineStats(before, after)]
  }))
  review.stats = Object.fromEntries(entries)
}
const reviewTotals = computed(() => {
  const totals = { added: 0, removed: 0, create: 0, update: 0, delete: 0 }
  for (const { path, action } of changeList.value) { totals[action]++; totals.added += review.stats[path]?.added ?? 0; totals.removed += review.stats[path]?.removed ?? 0 }
  return totals
})
const openReview = () => {
  if (!changeList.value.length) return
  Object.assign(review, { open: true, confirmAll: false, selected: current.value && changes[current.value] ? current.value : changeList.value[0].path })
  loadStats()
  nextTick(() => document.querySelector('[data-test=review-list]')?.focus())
}
const moveReview = (step) => {
  const list = changeList.value
  if (!list.length) return
  const at = list.findIndex((c) => c.path === review.selected)
  review.selected = list[(at + step + list.length) % list.length].path
}
const openFromReview = () => { const path = review.selected; if (!path || changes[path]?.action === 'delete') return; review.open = false; open(path) }
const splitPath = (path) => { const at = path.lastIndexOf('/'); return { name: path.slice(at + 1), folder: at < 0 ? '' : path.slice(0, at) } }
const discardOne = (path) => {
  const change = changes[path]
  if (!change) return
  if (change.action === 'create') removeFile(path) // a file that was only here: it goes
  else {
    const model = models.get(path)
    const original = originals.get(path)
    if (change.action === 'update' && model && original) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: original.text }], () => null)
    delete changes[path]
  }
  say('ok', t('splCodeEditor.review_discarded', { path }))
  if (!changeList.value.length) review.open = false
  else { if (!changes[review.selected]) review.selected = changeList.value[0].path; loadStats() }
}
// two steps, so a click by mistake loses nothing
const discardAllFromReview = () => { if (!review.confirmAll) { review.confirmAll = true; return }; discard(); review.open = false }
const saveFromReview = () => { review.open = false; openCommit() }
watch(() => [review.open, review.selected, changes[review.selected]?.content], showDiff)
watch(() => review.open, (on) => { if (!on) disposeDiff() })
watch(() => review.selected, () => { review.confirmAll = false })

// ---------- the open files come back after a reload (this browser, per line; the default branch only) ----------
const sessionKey = () => `spl-code-editor.session.${props.lineId}`
watch([tabs, current], () => {
  if (loading.value) return
  try { localStorage.setItem(sessionKey(), JSON.stringify({ branch: branch.value, tabs: tabs.value, current: current.value })) } catch { /* not kept */ }
}, { deep: true })
const restoreSession = async () => {
  let saved
  try { saved = JSON.parse(localStorage.getItem(sessionKey()) ?? 'null') } catch { saved = null }
  if (!saved || saved.branch !== branch.value) return
  const alive = (saved.tabs ?? []).filter((p) => files.value.includes(p))
  if (!alive.length) return
  tabs.value = alive
  await open(alive.includes(saved.current) ? saved.current : alive[alive.length - 1])
}

// ---------- preferences of the editor (kept in this browser) and the status bar ----------
const PREFS_KEY = 'spl-code-editor.prefs'
const readPrefs = () => { try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'); return { wrap: !!p.wrap, minimap: !!p.minimap } } catch { return { wrap: false, minimap: false } } }
const prefs = reactive(readPrefs())
const posInfo = reactive({ line: 1, col: 1, sel: 0, lang: '', indent: '', eol: 'LF' })
const applyPrefs = () => editor?.updateOptions({ wordWrap: prefs.wrap ? 'on' : 'off', minimap: { enabled: prefs.minimap } })
watch(prefs, () => { applyPrefs(); try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs })) } catch { /* not kept */ } }, { deep: true })
const refreshStatus = () => {
  const model = editor?.getModel()
  if (!model) return
  const pos = editor.getPosition() ?? { lineNumber: 1, column: 1 }
  const selection = editor.getSelection()
  const options = model.getOptions()
  posInfo.line = pos.lineNumber
  posInfo.col = pos.column
  posInfo.sel = selection && !selection.isEmpty() ? model.getValueInRange(selection).length : 0
  posInfo.lang = model.getLanguageId()
  posInfo.indent = t(options.insertSpaces ? 'splCodeEditor.status_spaces' : 'splCodeEditor.status_tabs', { n: options.tabSize })
  posInfo.eol = model.getEOL() === '\r\n' ? 'CRLF' : 'LF'
}

const disposables = []
const registerAssistance = () => {
  const M = monaco.value
  if (!M.languages.getLanguages().some((l) => l.id === 'featuremodel')) {
    M.languages.register({ id: 'featuremodel', extensions: ['.featuremodel'] })
    M.languages.setMonarchTokensProvider('featuremodel', { tokenizer: { root: [
      [/\/\/.*$/, 'comment'],
      [/\b(featuremodel|feature|optional|mandatory|or|alternative|group|cardinality|constraint|constraints|imports)\b/, 'keyword'],
      [/[{}]/, 'delimiter.curly'],
      [/[A-Za-z_][\w$]*/, 'identifier'],
    ] } })
  }
  const kinds = { feature: M.languages.CompletionItemKind.EnumMember, snippet: M.languages.CompletionItemKind.Snippet, keyword: M.languages.CompletionItemKind.Keyword }
  disposables.push(M.languages.registerCompletionItemProvider('*', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems: (model, position) => {
      if (model.uri.scheme !== 'inmemory') return { suggestions: [] }
      const path = decodeURI(model.uri.path.slice(1))
      if (path.endsWith('.featuremodel')) return { suggestions: [] }
      const word = model.getWordUntilPosition(position)
      const range = new M.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)
      const prefix = model.getValueInRange(new M.Range(position.lineNumber, 1, position.lineNumber, position.column))
      return { suggestions: suggestions({ prefix, names: names.value, delimiters: delimitersFor(path, delimiters.value) }).map((item) => ({
        label: item.label, kind: kinds[item.kind], insertText: item.insertText, detail: item.detail, filterText: item.filterText, sortText: item.sortText, range,
        ...(item.snippet ? { insertTextRules: M.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
      })) }
    },
  }))
  disposables.push(editor.onDidChangeCursorPosition((e) => { cursorLine.value = e.position.lineNumber }))
  disposables.push(editor.addAction({ id: 'sce.wrap', label: t('splCodeEditor.wrap_title'), keybindings: [M.KeyMod.Alt | M.KeyCode.KeyZ], run: () => { prefs.wrap = !prefs.wrap } }))
  disposables.push(editor.onDidChangeCursorSelection(refreshStatus), editor.onDidChangeModel(refreshStatus), editor.onDidChangeModelContent(refreshStatus))
  disposables.push(editor.addAction({ id: 'sce.annotate', label: t('splCodeEditor.annotate_action'), keybindings: [M.KeyMod.CtrlCmd | M.KeyMod.Alt | M.KeyCode.KeyA], contextMenuGroupId: '1_modification', contextMenuOrder: 0.5, run: () => openPick() }))
  disposables.push(editor.addAction({ id: 'sce.unannotate', label: t('splCodeEditor.unannotate'), keybindings: [M.KeyMod.CtrlCmd | M.KeyMod.Alt | M.KeyCode.KeyU], contextMenuGroupId: '1_modification', contextMenuOrder: 0.6, run: () => unannotateHere() }))
}
watch(names, () => refreshDecorations())

onMounted(async () => {
  if (root.value && typeof ResizeObserver !== 'undefined') {
    sizeObserver = new ResizeObserver(([entry]) => { size.width = entry.contentRect.width; size.height = entry.contentRect.height })
    sizeObserver.observe(root.value)
  }
  try {
    monaco.value = await import('monaco-editor')
    editor = monaco.value.editor.create(container.value, {
      automaticLayout: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, glyphMargin: false,
      theme: darkMode() ? 'vs-dark' : 'vs', model: null, lineDecorationsWidth: 22,
      wordWrap: prefs.wrap ? 'on' : 'off', minimap: { enabled: prefs.minimap },
      bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, stickyScroll: { enabled: true },
      renderWhitespace: 'selection', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', mouseWheelZoom: true, formatOnPaste: false,
      folding: true, showFoldingControls: 'mouseover', matchBrackets: 'always', occurrencesHighlight: 'singleFile', padding: { top: 4 },
    })
    document.addEventListener('keydown', onKey)
    registerAssistance()
    // the app's theme can change while the editor is open: the editor's theme and the text of the markers follow it
    themeWatch = new MutationObserver(() => { monaco.value.editor.setTheme(darkMode() ? 'vs-dark' : 'vs'); refreshDecorations() })
    for (const node of [document.documentElement, document.body]) themeWatch.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    window.addEventListener('beforeunload', warnUnsaved)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    info.value = await repoApi.info(props.lineId)
    const list = await repoApi.branches(props.lineId)
    branches.value = list.map((b) => (typeof b === 'string' ? b : b.name))
    branch.value = base.value
    await loadFiles()
    loading.value = false
    await restoreSession()
    await loadFeatures()
  } catch (error) { loading.value = false; say('error', messageOf(error)) }
})
onBeforeUnmount(() => { sizeObserver?.disconnect(); themeWatch?.disconnect(); clearTimeout(deriveTimer); for (const d of disposables) d.dispose(); derivedEditor?.getModel()?.dispose(); derivedEditor?.dispose(); document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', warnUnsaved); regexRunner.stop(); document.removeEventListener('fullscreenchange', onFullscreenChange); clearTimeout(searchTimer); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); for (const model of models.values()) model.dispose(); editor?.dispose(); sheet?.remove(); sheet = null; looks.clear() })
watch(() => `${preset.value}${JSON.stringify(colors.value)}`, () => { looks.clear(); if (sheet) sheet.textContent = ''; refreshDecorations() })
watch(() => props.lineId, () => { /* the page loads another line: the tab is made again */ })
defineExpose({ open })
</script>

<template>
  <!-- maximized, it moves to the body: an ancestor of the page may hold a fixed child inside its own box -->
  <Teleport to="body" :disabled="!maximized">
  <section class="sce" :class="{ 'sce--max': maximized, 'sce--narrow': size.width < 1000, 'sce--short': size.height < 520 }" ref="root" data-test="spl-code-editor">
    <header class="sce__bar">
      <label class="sce__branch">
        <span>{{ $t('splCodeEditor.branch') }}</span>
        <select v-model="branch" data-test="branch" @change="switchBranch($event)">
          <option v-for="b in branches" :key="b" :value="b">{{ b }}</option>
        </select>
      </label>
      <Button icon="pi pi-search" :label="$t('splCodeEditor.quick_open')" text size="small" :title="`${$t('splCodeEditor.quick_open')} (Ctrl/Cmd+P)`" data-test="quick-open" @click="openQuick" />
      <Button icon="pi pi-download" :label="$t('splCodeEditor.zip_button')" text size="small" :loading="zipping" :title="$t('splCodeEditor.zip_title')" data-test="download-zip" @click="downloadZip" />
      <span class="sce__spacer" />
      <button v-if="changeCount" type="button" class="sce__count" :title="$t('splCodeEditor.review_open')" data-test="change-count" @click="openReview">{{ $t('splCodeEditor.changes', { n: changeCount }, changeCount) }}</button>
      <Button v-if="changeCount" :label="$t('splCodeEditor.discard')" text size="small" @click="discard" />
      <Button :label="$t('splCodeEditor.save')" icon="pi pi-check" size="small" :disabled="!changeCount" :title="`${$t('splCodeEditor.save')} (Ctrl/Cmd+S)`" data-test="save" @click="openCommit" />
      <Button :icon="maximized ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" text size="small" :aria-label="maximized ? $t('splCodeEditor.exit_fullscreen') : $t('splCodeEditor.fullscreen')" :title="maximized ? $t('splCodeEditor.exit_fullscreen') : $t('splCodeEditor.fullscreen')" data-test="fullscreen" @click="setMaximized(!maximized)" />
    </header>
    <p v-if="status.text" class="sce__status" :class="`sce__status--${status.kind}`" role="status" data-test="status">{{ status.text }}</p>

    <div class="sce__body">
      <aside v-show="bar('side')" class="sce__side" :class="{ 'sce__side--closed': !sideOpen }" :style="sideOpen ? { width: `${sideWidth}px` } : null" data-test="side">
        <nav v-if="sideOpen" class="sce__tabs" role="tablist">
          <button v-for="[p] in PANELS" :key="p" type="button" role="tab" :aria-selected="panel === p" :class="{ 'sce__tab--on': panel === p }" :data-test="`tab-${p}`" @click="panel = p">
            {{ $t(`splCodeEditor.${panelLabel(p)}`) }}
          </button>
          <button type="button" class="sce__fold" :title="`${$t('splCodeEditor.fold_side')} (Ctrl/Cmd+B)`" :aria-label="$t('splCodeEditor.fold_side')" data-test="fold-side" @click="sideOpen = false"><i class="pi pi-angle-double-left" /></button>
        </nav>
        <nav v-else class="sce__rail" data-test="side-rail">
          <button type="button" class="sce__railbtn" :title="`${$t('splCodeEditor.unfold_side')} (Ctrl/Cmd+B)`" :aria-label="$t('splCodeEditor.unfold_side')" data-test="unfold-side" @click="sideOpen = true"><i class="pi pi-angle-double-right" /></button>
          <button v-for="[p, icon] in PANELS" :key="p" type="button" class="sce__railbtn" :class="{ 'sce__railbtn--on': panel === p }" :title="$t(`splCodeEditor.${panelLabel(p)}`)" :aria-label="$t(`splCodeEditor.${panelLabel(p)}`)" :data-test="`rail-${p}`" @click="showPanel(p)"><i class="pi" :class="icon" /></button>
        </nav>

        <template v-if="sideOpen">
        <div v-if="panel === 'files'" class="sce__panel">
          <div class="sce__tools">
            <Button icon="pi pi-plus" :label="$t('splCodeEditor.new_file')" text size="small" data-test="new-file" @click="askPath('new')" />
          </div>
          <div class="sce__tools">
            <InputText v-model="treeFilter" size="small" :placeholder="$t('splCodeEditor.tree_filter')" class="sce__filter" data-test="tree-filter" />
            <Button v-if="treeFilter" icon="pi pi-times" text size="small" :aria-label="$t('splCodeEditor.close')" @click="treeFilter = ''" />
          </div>
          <form v-if="pathAsk.open" class="sce__pathinput" @submit.prevent="submitPath">
            <InputText v-model="pathAsk.value" size="small" :placeholder="$t(pathAsk.kind === 'new' ? 'splCodeEditor.new_file_prompt' : 'splCodeEditor.rename_prompt')" data-test="path-input" />
            <Button type="submit" icon="pi pi-check" size="small" text :aria-label="$t('splCodeEditor.save')" />
            <Button type="button" icon="pi pi-times" size="small" text :aria-label="$t('splCodeEditor.cancel')" @click="pathAsk.open = false" />
          </form>
          <p v-if="loading" class="sce__muted">{{ $t('splCodeEditor.loading') }}</p>
          <FileTree :nodes="tree" :current="current" :changes="changes" @open="open($event)" @rename="askPath('rename', $event)" @remove="removeFile" />
        </div>

        <div v-else-if="panel === 'search'" class="sce__panel" data-test="search-panel">
          <form class="sce__searchform" @submit.prevent="runSearch">
            <div class="sce__searchrow">
              <InputText v-model="search.query" size="small" :placeholder="$t('splCodeEditor.search_placeholder')" class="sce__filter" data-test="search-input" />
              <button type="button" class="sce__toggle" :class="{ 'sce__toggle--on': search.caseSensitive }" :title="$t('splCodeEditor.match_case')" :aria-pressed="search.caseSensitive" data-test="opt-case" @click="search.caseSensitive = !search.caseSensitive">Aa</button>
              <button type="button" class="sce__toggle" :class="{ 'sce__toggle--on': search.word }" :title="$t('splCodeEditor.whole_word')" :aria-pressed="search.word" data-test="opt-word" @click="search.word = !search.word"><u>ab</u></button>
              <button type="button" class="sce__toggle" :class="{ 'sce__toggle--on': search.regex }" :title="$t('splCodeEditor.use_regex')" :aria-pressed="search.regex" data-test="opt-regex" @click="search.regex = !search.regex">.*</button>
            </div>
            <div class="sce__searchrow">
              <InputText v-model="search.replace" size="small" :placeholder="$t('splCodeEditor.replace_placeholder')" class="sce__filter" data-test="replace-input" />
              <Button type="button" :label="$t('splCodeEditor.replace_all')" size="small" text :disabled="!search.results.length" data-test="replace-all" @click="replaceAll" />
            </div>
          </form>
          <p v-if="search.error" class="sce__muted sce__muted--bad" data-test="search-error">{{ search.error }}</p>
          <p v-else-if="search.running" class="sce__muted">{{ $t('splCodeEditor.searching') }}</p>
          <p v-else-if="search.done" class="sce__muted" data-test="search-summary">{{ search.total ? searchSummary : $t('splCodeEditor.search_none') }}</p>
          <details v-for="group in search.results" :key="group.path" class="sce__feature" open data-test="search-group">
            <summary><strong :title="group.path">{{ group.path.split('/').pop() }}</strong> <span class="sce__muted sce__muted--inline">{{ group.path.split('/').slice(0, -1).join('/') }}</span> <span class="sce__badge">{{ group.matches.length }}</span></summary>
            <button v-for="(m, i) in group.matches" :key="i" type="button" class="sce__spot" data-test="search-hit" @click="open(group.path, m.line, m.column, m.length)">
              <span class="sce__muted sce__muted--inline">{{ m.line }}</span> {{ previewParts(m).before }}<mark>{{ previewParts(m).hit }}</mark>{{ previewParts(m).after }}
            </button>
          </details>
        </div>

        <div v-else-if="panel === 'features'" class="sce__panel">
          <div class="sce__tools">
            <InputText v-model="filter" size="small" :placeholder="$t('splCodeEditor.filter')" class="sce__filter" />
            <Button icon="pi pi-refresh" text size="small" :aria-label="$t('splCodeEditor.reindex')" :title="$t('splCodeEditor.reindex')" @click="reindex" />
          </div>
          <p class="sce__muted">{{ $t('splCodeEditor.not_committed') }}</p>
          <p v-if="!places.length" class="sce__muted">{{ $t('splCodeEditor.annotated_none') }}</p>
          <details v-for="[name, spots] in places" :key="name" class="sce__feature" open>
            <summary><i class="sce__dot" :style="swatch(name)" /><strong>{{ name }}</strong> <span class="sce__badge">{{ spots.length }}</span></summary>
            <button v-for="(s, i) in spots" :key="i" type="button" class="sce__spot" :title="s.path" @click="open(s.path, s.startLine)">
              {{ s.path.split('/').pop() }}<span class="sce__muted">:{{ s.startLine }}–{{ s.endLine }}</span>
            </button>
          </details>
        </div>

        <div v-else class="sce__panel" />
        </template>
      </aside>
      <Splitter v-if="sideOpen && bar('side')" :label="$t('splCodeEditor.resize_side')" @resize="dragSide" @reset="resetSide" />

      <div class="sce__main">
        <div v-if="tabs.length" class="sce__files" role="tablist" data-test="open-tabs">
          <div v-for="p in tabs" :key="p" class="sce__file" :class="{ 'sce__file--on': p === current }" role="tab" :aria-selected="p === current" :title="p" data-test="open-tab" @click="open(p)" @auxclick.middle.prevent="closeTab(p)">
            <span class="sce__fname">{{ tabLabel(p) }}</span>
            <span v-if="changes[p]" class="sce__dirty" :class="`sce__dirty--${changes[p].action}`" aria-hidden="true">●</span>
            <button type="button" class="sce__x" :aria-label="$t('splCodeEditor.close')" @click.stop="closeTab(p)"><i class="pi pi-times" /></button>
          </div>
        </div>
        <div v-if="current && bar('crumbs')" class="sce__crumbs" data-test="breadcrumbs">
          <template v-for="(part, i) in crumbs" :key="i">
            <span v-if="i" class="sce__sep">›</span>
            <button v-if="i < crumbs.length - 1" type="button" class="sce__crumb" @click="filterFolder(i)">{{ part }}</button>
            <span v-else class="sce__crumb sce__crumb--file">{{ part }}</span>
          </template>
        </div>
        <!-- two bars, each with one job: ANNOTATE edits the code (marks lines with a feature); SCENARIO says what product the dock simulates -->
        <div v-show="bar('annotate')" class="sce__annot" :class="{ 'sce__annot--off': !current || notice }" role="toolbar" :aria-label="$t('splCodeEditor.annotate_group')">
          <span class="sce__group">
            <span class="sce__grouplabel">{{ $t('splCodeEditor.annotate_group') }}</span>
            <InputText v-model="featureInput" size="small" list="sce-names" :placeholder="$t('splCodeEditor.feature_expr')" class="sce__featureinput" data-test="feature-input" @keydown.enter.prevent="annotate(false)" />
            <datalist id="sce-names"><option v-for="n in featureChoices" :key="n" :value="n" /></datalist>
            <Button :label="$t('splCodeEditor.annotate')" icon="pi pi-tag" size="small" data-test="annotate" :title="$t('splCodeEditor.annotate_title')" @click="annotate(false)" />
            <Button icon="pi pi-eraser" :label="$t('splCodeEditor.unannotate')" size="small" text severity="secondary" :title="$t('splCodeEditor.unannotate_title')" data-test="unannotate" @click="annotate(true)" />
          </span>
          <span class="sce__group">
            <span class="sce__grouplabel">{{ $t('splCodeEditor.regions_group') }}</span>
            <Button icon="pi pi-chevron-up" size="small" text severity="secondary" :aria-label="$t('splCodeEditor.prev_region')" :title="$t('splCodeEditor.prev_region')" data-test="prev-region" @click="jumpRegion(-1)" />
            <Button icon="pi pi-chevron-down" size="small" text severity="secondary" :aria-label="$t('splCodeEditor.next_region')" :title="$t('splCodeEditor.next_region')" data-test="next-region" @click="jumpRegion(1)" />
          </span>
          <span class="sce__spacer" />
          <span class="sce__legendwrap" @focusout="onLegendOut" @keydown.esc="legendOpen = false">
            <Button icon="pi pi-palette" :label="$t('splCodeEditor.legend_button', { n: fileFeatures.length })" size="small" text severity="secondary" :aria-expanded="legendOpen" data-test="legend-toggle" :title="$t('splCodeEditor.legend_title')" @click="legendOpen = !legendOpen" />
            <div v-if="legendOpen" class="sce__legend" data-test="legend-panel" tabindex="-1">
              <p class="sce__legendhead">{{ $t('splCodeEditor.legend_head') }}</p>
              <p v-if="!fileFeatures.length" class="sce__muted">{{ $t('splCodeEditor.legend_none') }}</p>
              <button v-for="f in fileFeatures" :key="f" type="button" class="sce__legenditem" :title="$t('splCodeEditor.next_of', { name: f })" data-test="legend" @click="jumpFeature(f)"><i class="sce__dot" :style="swatch(f)" /><span>{{ f }}</span><i class="pi pi-arrow-down-right" aria-hidden="true" /></button>
              <label class="sce__palette">{{ $t('splCodeEditor.palette') }}
                <select v-model="preset" data-test="palette" @change="setPreset">
                  <option v-for="id in presetIds" :key="id" :value="id">{{ $t(`splCodeEditor.palette_${id}`) }}</option>
                </select>
              </label>
            </div>
          </span>
        </div>
        <div v-if="current && !notice && bar('scenario')" class="sce__cfg" data-test="file-config">
          <button type="button" class="sce__scenario" :title="$t('splCodeEditor.config_edit_title')" data-test="cfg-edit" @click="editConfig">
            <i class="pi pi-sliders-h" aria-hidden="true" />
            <span class="sce__grouplabel">{{ $t('splCodeEditor.scenario_title') }}</span>
            <strong data-test="cfg-summary">{{ enabledFeatures.length ? $t('splCodeEditor.config_active', { n: enabledFeatures.length, total: featureChoices.length }) : $t('splCodeEditor.config_none_active') }}</strong>
            <span class="sce__muted sce__muted--inline">· {{ $t('splCodeEditor.scenario_data', { name: dataLabel }) }}</span>
            <i class="pi pi-pencil sce__scenarioedit" aria-hidden="true" />
          </button>
          <button v-if="derived.problems.length" type="button" class="sce__badgebtn" :title="$t('splCodeEditor.diag_scenario_invalid')" data-test="scenario-invalid" @click="editConfig"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ $t('splCodeEditor.badge_choices', { n: derived.problems.length }, derived.problems.length) }}</button>
          <span class="sce__spacer" />
          <Button :icon="running ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" :label="$t('splCodeEditor.run_button')" size="small" severity="secondary" outlined :disabled="running || !!specProblem || !derivedTarget" :title="$t('splCodeEditor.run_title')" data-test="debug-run" @click="rerun" />
          <span class="sce__seg sce__seg--view" role="group" :aria-label="$t('splCodeEditor.view_group')">
            <button type="button" :class="{ 'sce__seg--on': derived.open && layout.tab === 'result' }" :aria-pressed="derived.open && layout.tab === 'result'" :title="$t('splCodeEditor.derive_title')" data-test="derive-toggle" @click="derived.open && layout.tab === 'result' ? derived.open = false : openDock('result')"><i class="pi pi-eye" aria-hidden="true" /> {{ $t('splCodeEditor.dock_result') }}</button>
            <button type="button" :class="{ 'sce__seg--on': derived.open && layout.tab === 'debug' }" :aria-pressed="derived.open && layout.tab === 'debug'" :title="$t('splCodeEditor.debug_hint')" data-test="debug-toggle" @click="derived.open && layout.tab === 'debug' ? derived.open = false : openDock('debug')"><i class="pi pi-bug" aria-hidden="true" /> {{ $t('splCodeEditor.dock_debug') }}</button>
          </span>
        </div>
        <div v-if="current && bar('annotate') && missingHere.length && !dismissedMissing.has(missingHere.join('|'))" class="sce__banner" data-test="undeclared">
          <i class="pi pi-exclamation-triangle" aria-hidden="true" />
          <span class="sce__bannertext" :title="missingHere.join(', ')">{{ $t('splCodeEditor.missing_here', { n: missingHere.length }, missingHere.length) }}: <code>{{ missingHere.slice(0, 4).join(', ') }}{{ missingHere.length > 4 ? '…' : '' }}</code></span>
          <Button :label="$t('splCodeEditor.add_to_model')" size="small" text data-test="add-to-model" :title="$t('splCodeEditor.add_to_model_title')" @click="addToModel(missingHere)" />
          <button type="button" class="sce__iconbtn" :data-tip="$t('splCodeEditor.dismiss')" :aria-label="$t('splCodeEditor.dismiss')" @click="dismissedMissing = new Set([...dismissedMissing, missingHere.join('|')])"><i class="pi pi-times" /></button>
        </div>
        <div class="sce__split" :class="{ 'sce__split--col': dockBottom }">
          <div class="sce__editor">
            <div ref="container" class="sce__monaco" />
            <p v-if="!current || notice" class="sce__empty">{{ notice || $t('splCodeEditor.open_hint') }}</p>
          </div>
          <Splitter v-if="derived.open" :horizontal="dockBottom && !debugFull" :label="$t('splCodeEditor.resize_dock')" @resize="dragDock" @reset="resetDock" />
          <aside v-show="derived.open" class="sce__dock" :class="{ 'sce__dock--col': dockBottom, 'sce__dock--full': debugFull }" :style="dockStyle" data-test="derived-pane">
            <header class="sce__dockhead">
              <nav v-if="!debugFull" class="sce__docktabs" role="tablist" :aria-label="$t('splCodeEditor.dock_label')">
                <button v-for="[id, icon] in DOCK_TABS" :key="id" type="button" role="tab" :aria-selected="layout.tab === id" :class="{ 'sce__docktab--on': layout.tab === id }" :data-test="`dock-${id}`" @click="layout.tab = id">
                  <i class="pi" :class="icon" aria-hidden="true" /><span>{{ $t(`splCodeEditor.dock_${id}`) }}</span>
                </button>
              </nav>
              <span class="sce__spacer" />
              <span class="sce__history" @focusout="onScenOut" @keydown.esc="scenOpen = false" data-test="scenario-history">
                <button type="button" class="sce__iconbtn" :disabled="!canBack" :data-tip="$t('splCodeEditor.scen_back')" :aria-label="$t('splCodeEditor.scen_back')" data-test="scen-back" @click="goHistory(1)"><i class="pi pi-arrow-left" /></button>
                <button type="button" class="sce__iconbtn" :disabled="!canForward" :data-tip="$t('splCodeEditor.scen_forward')" :aria-label="$t('splCodeEditor.scen_forward')" data-test="scen-forward" @click="goHistory(-1)"><i class="pi pi-arrow-right" /></button>
                <button type="button" class="sce__histbtn" :aria-expanded="scenOpen" :title="$t('splCodeEditor.scen_title')" data-test="scen-toggle" @click="scenOpen = !scenOpen"><i class="pi pi-history" aria-hidden="true" /><span>{{ $t('splCodeEditor.scen_button') }}</span></button>
                <div v-if="scenOpen" class="sce__scenpop" data-test="scen-panel" tabindex="-1">
                  <p class="sce__legendhead">{{ $t('splCodeEditor.scen_now') }}</p>
                  <p class="sce__scenwords" data-test="scen-now">{{ currentWords }}</p>
                  <form class="sce__scensave" @submit.prevent="saveScenario">
                    <InputText v-model="scenName" size="small" :placeholder="$t('splCodeEditor.scen_name')" data-test="scen-name" />
                    <Button type="submit" icon="pi pi-bookmark" :label="$t('splCodeEditor.scen_save')" size="small" :disabled="!scenName.trim()" data-test="scen-save" />
                  </form>
                  <p class="sce__legendhead">{{ $t('splCodeEditor.scen_saved_title') }}</p>
                  <p v-if="!scenarios.saved.length" class="sce__muted">{{ $t('splCodeEditor.scen_saved_none') }}</p>
                  <div v-for="s in scenarios.saved" :key="s.name" class="sce__scenrow" data-test="scen-saved">
                    <button type="button" class="sce__scenpick" @click="pickSaved(s)"><strong>{{ s.name }}</strong><span class="sce__muted">{{ scenWords(s.snap) }}</span></button>
                    <button type="button" class="sce__iconbtn" :data-tip="$t('splCodeEditor.delete')" :aria-label="$t('splCodeEditor.delete')" @click="dropScenario(s.name)"><i class="pi pi-trash" /></button>
                  </div>
                  <p class="sce__legendhead">{{ $t('splCodeEditor.scen_recent_title') }}</p>
                  <p v-if="!scenarios.recent.length" class="sce__muted">{{ $t('splCodeEditor.scen_recent_none') }}</p>
                  <div v-for="(r, i) in scenarios.recent" :key="i" class="sce__scenrow" data-test="scen-recent">
                    <button type="button" class="sce__scenpick" :class="{ 'sce__scenpick--on': i === scenarios.cursor }" @click="pickRecent(i)"><span>{{ scenWords(r) }}</span><span class="sce__muted">{{ i === scenarios.cursor ? $t('splCodeEditor.scen_current') : '' }}</span></button>
                  </div>
                </div>
              </span>
              <button v-if="layout.tab === 'debug'" type="button" class="sce__iconbtn" :class="{ 'sce__iconbtn--on': debugFull }" :aria-pressed="debugFull" :data-tip="debugFull ? $t('splCodeEditor.full_off') : $t('splCodeEditor.full_on')" :aria-label="debugFull ? $t('splCodeEditor.full_off') : $t('splCodeEditor.full_on')" data-test="debug-full" @click="debugFull ? exitDebugFull() : enterDebugFull()"><i class="pi" :class="debugFull ? 'pi-window-minimize' : 'pi-expand'" /></button>
              <button v-if="!compact && !debugFull && layout.tab === 'debug'" type="button" class="sce__iconbtn" :class="{ 'sce__iconbtn--on': layout.compare }" :aria-pressed="layout.compare" :data-tip="layout.compare ? $t('splCodeEditor.compare_off') : $t('splCodeEditor.compare_on')" :aria-label="layout.compare ? $t('splCodeEditor.compare_off') : $t('splCodeEditor.compare_on')" data-test="dock-compare" @click="toggleCompare"><i class="pi pi-arrows-h" /></button>
              <button v-if="!compact && !debugFull" type="button" class="sce__iconbtn" :data-tip="dockBottom ? $t('splCodeEditor.dock_to_right') : $t('splCodeEditor.dock_to_bottom')" :aria-label="dockBottom ? $t('splCodeEditor.dock_to_right') : $t('splCodeEditor.dock_to_bottom')" data-test="dock-position" @click="toggleDockPos"><i class="pi" :class="dockBottom ? 'pi-arrow-up-right' : 'pi-arrow-down-left'" /></button>
              <button type="button" class="sce__iconbtn" :data-tip="$t('splCodeEditor.close')" :aria-label="$t('splCodeEditor.close')" data-test="dock-close" @click="derived.open = false"><i class="pi pi-times" /></button>
            </header>

            <!-- RESULT: what the open file becomes -->
            <section v-show="layout.tab === 'result'" class="sce__dockbody sce__dockbody--result" data-test="result-view">
              <div class="sce__resulthead">
                <strong class="sce__resultname" :title="derived.path">{{ derived.path ? derived.path.split('/').pop() : $t('splCodeEditor.derive_view') }}</strong>
                <span class="sce__spacer" />
                <select v-if="derived.options.length > 1" v-model="debug.selected" class="sce__outsel" data-test="output-select" :title="$t('splCodeEditor.debug_files')">
                  <option v-for="(o, i) in optionLabels" :key="i" :value="i">{{ o }}</option>
                </select>
                <span class="sce__seg" role="group" :aria-label="$t('splCodeEditor.source_label')">
                  <button type="button" :class="{ 'sce__seg--on': derived.source === 'linea' }" :aria-pressed="derived.source === 'linea'" :title="$t('splCodeEditor.source_linea_title')" data-test="source-linea" @click="setSource('linea')">LINEA</button>
                  <button type="button" :class="{ 'sce__seg--on': derived.source === 'local' }" :aria-pressed="derived.source === 'local'" :title="$t('splCodeEditor.source_local_title')" data-test="source-local" @click="setSource('local')">{{ $t('splCodeEditor.source_local') }}</button>
                </span>
              </div>
              <p class="sce__status2" data-test="derive-info">
                <i v-if="derived.running" class="pi pi-spin pi-spinner" aria-hidden="true" />
                <span v-if="derived.running">{{ $t('splCodeEditor.try_running') }}</span>
                <span v-else-if="derived.state === 'ok'" class="sce__ok"><i class="pi pi-check" aria-hidden="true" /> {{ $t('splCodeEditor.derive_info', { n: derived.files, ms: derived.ms }) }}</span>
                <span v-else-if="derived.state === 'failed'" class="sce__bad"><i class="pi pi-times-circle" aria-hidden="true" /> {{ $t('splCodeEditor.try_fail') }}</span>
              </p>
              <details class="sce__config" data-test="derive-config">
                <summary>
                  <span class="sce__muted sce__muted--inline">{{ hereFeatures.length ? $t('splCodeEditor.file_features_line', { n: hereFeatures.length, on: fileSummary.on.length, off: fileSummary.off.length }) : $t('splCodeEditor.config_none_here') }}</span>
                  <span v-if="otherActive.length" class="sce__muted sce__muted--inline" data-test="derive-other" :title="$t('splCodeEditor.other_active_title')">· +{{ otherActive.length }} {{ $t('splCodeEditor.other_active') }}</span>
                  <button type="button" class="sce__link" @click.prevent="openDock('scenario')">{{ $t('splCodeEditor.config_edit') }}</button>
                </summary>
                <p v-if="fileSummary.on.length" data-test="derive-on"><i class="pi pi-check" aria-hidden="true" /> {{ fileSummary.on.join(', ') }}</p>
                <p v-if="fileSummary.off.length" class="sce__muted" data-test="derive-off"><i class="pi pi-times" aria-hidden="true" /> {{ fileSummary.off.join(', ') }}</p>
              </details>
              <div v-show="derived.state === 'ok'" ref="derivedBox" class="sce__derivedbox" data-test="derived-output" />
              <div v-if="derived.state !== 'ok'" class="sce__derivedmsg" data-test="derived-message">
                <p v-if="derived.state === 'idle'" class="sce__muted">{{ $t('splCodeEditor.open_hint') }}</p>
                <p v-else-if="derived.state === 'outside'" class="sce__muted">{{ $t('splCodeEditor.derive_outside') }}</p>
                <p v-else-if="derived.state === 'empty'" class="sce__muted" data-test="derive-empty">{{ $t('splCodeEditor.derive_empty', { path: localOutput?.path }) }}</p>
                <p v-else-if="derived.state === 'absent'" class="sce__muted">{{ $t('splCodeEditor.derive_absent') }}</p>
                <p v-else-if="derived.state === 'binary'" class="sce__muted">{{ $t('splCodeEditor.derive_binary') }}</p>
                <div v-else-if="derived.state === 'failed'" class="sce__diag" data-test="diagnosis">
                  <header class="sce__diaghead">
                    <i class="pi pi-times-circle" aria-hidden="true" />
                    <div><strong data-test="diag-headline">{{ diag.headline }}</strong><p class="sce__diagcause">{{ diag.cause }}</p></div>
                  </header>
                  <ol v-if="derived.source === 'linea'" class="sce__steps" data-test="diag-steps">
                    <li :class="derived.problems.length ? 'sce__step--bad' : 'sce__step--ok'"><i class="pi" :class="derived.problems.length ? 'pi-times-circle' : 'pi-check-circle'" aria-hidden="true" />{{ derived.problems.length ? $t('splCodeEditor.step_scenario_bad', { n: derived.problems.length }, derived.problems.length) : $t('splCodeEditor.step_scenario_ok') }}</li>
                    <li :class="derived.fileCheck ? (derived.fileCheck.ok ? 'sce__step--ok' : 'sce__step--bad') : 'sce__step--unknown'"><i class="pi" :class="derived.fileCheck ? (derived.fileCheck.ok ? 'pi-check-circle' : 'pi-times-circle') : 'pi-question-circle'" aria-hidden="true" />{{ derived.fileCheck ? (derived.fileCheck.ok ? $t('splCodeEditor.step_file_ok') : $t('splCodeEditor.step_file_bad')) : $t('splCodeEditor.step_file_unknown') }}</li>
                  </ol>
                  <ProblemsList v-if="derived.problems.length" :problems="derived.problems" :current="currentSet" :colors="colorOf" @pick="pickOption" @fix-all="fixAllProblems" />
                  <ul v-if="derived.rest.length" class="sce__restlist"><li v-for="(line, i) in derived.rest" :key="i">{{ line }}</li></ul>
                  <p v-if="unclosedLines.length" class="sce__hint" data-test="derive-hint">{{ $t('splCodeEditor.derive_unclosed', { lines: unclosedLines.join(', ') }) }}</p>
                  <div class="sce__actions sce__actions--start">
                    <Button v-if="derived.localError?.line || derived.fileCheck?.line" :label="$t('splCodeEditor.debug_go_line', { line: derived.localError?.line ?? derived.fileCheck.line })" icon="pi pi-arrow-right" size="small" text @click="jumpToMarker(derived.localError?.line ?? derived.fileCheck.line)" />
                    <Button v-if="derived.source === 'linea' && derived.fileCheck?.ok" :label="$t('splCodeEditor.view_in_browser')" icon="pi pi-desktop" size="small" text data-test="view-browser" @click="setSource('local')" />
                    <Button v-if="derived.problems.length" :label="$t('splCodeEditor.fix_scenario')" icon="pi pi-sliders-h" size="small" text @click="openDock('scenario')" />
                  </div>
                  <details class="sce__tech" data-test="tech-details">
                    <summary>{{ $t('splCodeEditor.tech_details') }}</summary>
                    <pre>{{ derived.error }}</pre>
                    <ul v-if="derived.warnings.length"><li v-for="(w, i) in derived.warnings.slice(0, 20)" :key="i">{{ w.file ? `${w.file}: ` : '' }}{{ w.message }}</li></ul>
                  </details>
                </div>
              </div>
            </section>

            <!-- SCENARIO: what the product would be -->
            <section v-show="layout.tab === 'scenario'" class="sce__dockbody sce__dockbody--scroll" data-test="config-panel">
              <p class="sce__lead">{{ $t('splCodeEditor.scenario_lead') }}</p>
              <div v-if="derived.problems.length" class="sce__validity sce__validity--bad" data-test="scenario-validity">
                <p class="sce__validityhead"><i class="pi pi-exclamation-circle" aria-hidden="true" /> <strong>{{ $t('splCodeEditor.diag_scenario_invalid') }}</strong></p>
                <p class="sce__muted">{{ $t('splCodeEditor.diag_scenario_cause', { n: derived.problems.length }, derived.problems.length) }}</p>
                <ProblemsList :problems="derived.problems" :current="currentSet" :colors="colorOf" @pick="pickOption" @fix-all="fixAllProblems" />
              </div>
              <p v-else-if="derived.lineaOk === true" class="sce__validity sce__validity--ok" data-test="scenario-validity"><i class="pi pi-check-circle" aria-hidden="true" /> {{ $t('splCodeEditor.scenario_valid') }}</p>
              <details class="sce__sec" open>
                <summary><h4 class="sce__h">{{ $t('splCodeEditor.features_title') }}</h4><span class="sce__badge" data-test="config-count">{{ enabledFeatures.length }} / {{ featureChoices.length }}</span></summary>
                <p class="sce__muted">{{ $t('splCodeEditor.features_help') }}</p>
                <div class="sce__tools">
                  <InputText v-model="cfgFilter" size="small" :placeholder="$t('splCodeEditor.config_filter')" class="sce__filter" data-test="config-filter" />
                  <Button v-if="cfgFilter" icon="pi pi-times" text size="small" :aria-label="$t('splCodeEditor.close')" @click="cfgFilter = ''" />
                </div>
                <div class="sce__tools">
                  <Button :label="$t('splCodeEditor.select_all')" text size="small" data-test="cfg-all" @click="setAll(true)" />
                  <Button :label="$t('splCodeEditor.select_none')" text size="small" data-test="cfg-none" @click="setAll(false)" />
                </div>
                <div v-if="current && hereFeatures.length" class="sce__tools sce__tools--here" data-test="here-tools">
                  <span class="sce__muted sce__muted--inline">{{ $t('splCodeEditor.here_group', { n: hereFeatures.length }) }}</span>
                  <Button :label="$t('splCodeEditor.here_on')" icon="pi pi-check-square" text size="small" data-test="here-on" @click="setHere(true)" />
                  <Button :label="$t('splCodeEditor.here_off')" icon="pi pi-stop" text size="small" data-test="here-off" @click="setHere(false)" />
                  <label class="sce__only"><input v-model="onlyHere" type="checkbox" data-test="cfg-only-here">{{ $t('splCodeEditor.config_only_here') }}</label>
                </div>
                <div class="sce__checks" data-test="config-list">
                  <label v-for="n in shownChoices" :key="n" class="sce__check" :class="{ 'sce__check--on': config.has(n) }">
                    <input type="checkbox" :checked="config.has(n)" data-test="cfg-feature" @change="toggleHere(n)"><i class="sce__dot" :style="swatch(n)" /><span class="sce__checkname">{{ n }}</span>
                    <span v-if="hereFeatures.includes(n)" class="sce__badge" :title="$t('splCodeEditor.here_badge_title')">{{ $t('splCodeEditor.here_badge') }}</span>
                  </label>
                  <p v-if="!shownChoices.length" class="sce__muted">{{ featureChoices.length ? $t('splCodeEditor.config_no_match') : $t('splCodeEditor.derive_no_features') }}</p>
                </div>
                <div v-if="missing.length" class="sce__banner sce__banner--panel">
                  <i class="pi pi-exclamation-triangle" aria-hidden="true" />
                  <span class="sce__bannertext" :title="missing.join(', ')">{{ $t('splCodeEditor.missing_all', { n: missing.length }, missing.length) }}</span>
                  <Button :label="$t('splCodeEditor.add_to_model')" size="small" text :title="missing.join(', ')" @click="addToModel(missing)" />
                </div>
              </details>
              <details class="sce__sec" open>
                <summary><h4 class="sce__h">{{ $t('splCodeEditor.data_title') }}</h4><span class="sce__badge">{{ dataLabel }}</span></summary>
                <p class="sce__muted">{{ $t('splCodeEditor.data_hint') }}</p>
                <textarea v-model="debug.data" class="sce__data" rows="8" spellcheck="false" data-test="debug-data" :aria-invalid="!!specProblem" :aria-label="$t('splCodeEditor.data_title')" />
                <p v-if="specProblem" class="sce__muted sce__muted--bad" data-test="data-problem">{{ specProblem }}</p>
                <div class="sce__tools">
                  <label class="sce__only"><input v-model="debug.useTransformation" type="checkbox" data-test="debug-transformation">{{ $t('splCodeEditor.use_transformation') }}</label>
                  <span class="sce__spacer" />
                  <Button :label="$t('splCodeEditor.data_reset')" text size="small" @click="resetData" />
                </div>
              </details>
              <details class="sce__sec">
                <summary><h4 class="sce__h">{{ $t('splCodeEditor.full_title') }}</h4></summary>
                <p class="sce__muted">{{ $t('splCodeEditor.try_hint') }}</p>
                <Button :label="trialRunning ? $t('splCodeEditor.try_running') : $t('splCodeEditor.try_run')" icon="pi pi-play" size="small" :disabled="trialRunning" data-test="run-trial" @click="runTrial" />
                <div v-if="trial" class="sce__trial" :class="trial.ok ? 'sce__trial--ok' : 'sce__trial--bad'" data-test="trial-result">
                  <strong>{{ trial.ok ? $t('splCodeEditor.try_ok', { n: trial.files.length }) : $t('splCodeEditor.try_fail') }}</strong>
                  <pre v-if="!trial.ok">{{ trial.error }}</pre>
                  <ul v-if="!trial.ok && trial.diagnostics?.length"><li v-for="(d, i) in trial.diagnostics" :key="i">{{ d.file ? `${d.file}: ` : '' }}{{ d.message }}</li></ul>
                  <details v-if="trial.ok"><summary>{{ $t('splCodeEditor.files_made') }}</summary><ul><li v-for="f in trial.files.slice(0, 200)" :key="f">{{ f }}</li></ul></details>
                </div>
              </details>
            </section>

            <!-- DEBUG: what every marker of the file does -->
            <section v-show="layout.tab === 'debug'" class="sce__dockbody sce__dockbody--fill" :class="{ 'sce__dockbody--full': debugFull }" data-test="debug-panel">
              <div v-if="debugFull" class="sce__dbgbar">
                <strong class="sce__fulltitle"><i class="pi pi-bug" aria-hidden="true" /> {{ $t('splCodeEditor.debugger_title') }}</strong>
                <Button v-if="debugFull" :icon="running ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" :label="$t('splCodeEditor.run_button')" size="small" severity="secondary" outlined :disabled="running || !!specProblem || !derivedTarget" :title="$t('splCodeEditor.run_title')" class="sce__fullrun" data-test="debug-run-full" @click="rerun" />
                <span v-if="debugFull" class="sce__iconbar" role="group" :aria-label="$t('splCodeEditor.panels_title')" data-test="views-bar">
                  <button v-for="[n, icon] in [['annotate', 'pi-tag'], ['scenario', 'pi-sliders-h'], ['crumbs', 'pi-map-marker'], ['side', 'pi-folder']]" :key="n" type="button" class="sce__iconbtn sce__iconbtn--toggle" :class="{ 'sce__iconbtn--on': fullPanels.has(n) }" :aria-pressed="fullPanels.has(n)" :data-tip="`${fullPanels.has(n) ? $t('splCodeEditor.hide') : $t('splCodeEditor.show')}: ${$t(`splCodeEditor.panel_${n}`)}`" :aria-label="$t(`splCodeEditor.panel_${n}`)" :data-test="`panel-${n}`" @click="toggleFullPanel(n)"><i class="pi" :class="icon" /></button>
                </span>
              </div>
              <p v-if="!current" class="sce__muted">{{ $t('splCodeEditor.open_hint') }}</p>
              <p v-else-if="!derivedTarget" class="sce__muted">{{ $t('splCodeEditor.derive_outside') }}</p>
              <p v-else-if="!debug.result || debug.forPath !== current" class="sce__muted">{{ $t('splCodeEditor.pv_run_first') }}</p>
              <div v-else-if="!debug.result.ok" class="sce__trial sce__trial--bad" data-test="debug-result">
                <strong>{{ $t(`splCodeEditor.phase_${debug.result.error.phase}`) }}</strong>
                <pre data-test="debug-error">{{ debug.result.error.message }}</pre>
                <p v-if="debug.result.error.hint" class="sce__hint">{{ debug.result.error.hint }}</p>
                <button v-if="debug.result.error.line" type="button" class="sce__spot" @click="jumpToMarker(debug.result.error.line)">{{ $t('splCodeEditor.debug_go_line', { line: debug.result.error.line }) }}</button>
              </div>
              <p v-else-if="debugOutput?.empty" class="sce__muted">{{ $t('splCodeEditor.derive_empty', { path: debugOutput.path }) }}</p>
              <ProductView v-else-if="debugOutput" :output="debugOutput" :template-text="templateText" :source-line="cursorLine" :feature-stats="featureStats" :value-stats="valueStats" :colors="colorStyle" @jump="jumpToMarker" @highlight="showOrigin" @toggle-feature="toggleFeature">
                <template #bar>
                  <select v-if="(debug.result?.outputs?.length ?? 0) > 1" v-model="debug.selected" class="sce__outsel" :title="$t('splCodeEditor.debug_files')">
                    <option v-for="(o, i) in (debug.result?.outputs ?? [])" :key="i" :value="i">{{ o.fileName }}</option>
                  </select>
                  <span class="sce__ok" data-test="debug-status"><i class="pi pi-check" aria-hidden="true" /> {{ $t('splCodeEditor.debug_ok', { n: debug.result.outputs.length, ms: debug.ms }) }}</span>
                </template>
                <template #config>
                  <section v-if="hereFeatures.length || missingHere.length" class="cfg__section" data-test="debug-features">
                    <div class="cfg__head">
                      <span class="cfg__title">{{ $t('splCodeEditor.features_title') }}</span>
                      <span class="cfg__count">{{ featureStats.on }}/{{ featureStats.total }}</span>
                      <span class="cfg__links">
                        <button type="button" class="cfg__link" data-test="dbg-all-on" @click="setHere(true)">{{ $t('splCodeEditor.here_on') }}</button>
                        <button type="button" class="cfg__link" data-test="dbg-all-off" @click="setHere(false)">{{ $t('splCodeEditor.here_off') }}</button>
                      </span>
                    </div>
                    <input v-if="hereFeatures.length > 8" v-model="dbgFilter" class="cfg__search" type="search" :placeholder="$t('splCodeEditor.config_filter')" data-test="dbg-filter" :aria-label="$t('splCodeEditor.config_filter')">
                    <div class="cfg__list">
                      <label v-for="n in dbgFeatures" :key="n" class="cfg__row" :class="{ 'cfg__row--off': !config.has(n) }" data-test="dbg-feature"><input type="checkbox" :checked="config.has(n)" @change="toggleHereFeature(n)"><i class="sce__dot" :style="swatch(n)" /><span :title="n">{{ n }}</span></label>
                      <div v-for="n in missingHere" :key="n" class="cfg__row cfg__row--missing" :title="$t('splCodeEditor.dbg_missing')"><i class="pi pi-exclamation-triangle" aria-hidden="true" /><span>{{ n }}</span></div>
                    </div>
                  </section>
                  <section v-if="valueRows.length" class="cfg__section" data-test="debug-values">
                    <div class="cfg__head">
                      <span class="cfg__title">{{ $t('splCodeEditor.dbg_values') }}</span>
                      <span class="cfg__links"><button v-if="Object.keys(debug.overrides).length" type="button" class="cfg__link" data-test="dbg-reset-all" @click="resetValues">{{ $t('splCodeEditor.dbg_reset_all', { n: Object.keys(debug.overrides).length }) }}</button></span>
                    </div>
                    <div v-for="row in valueRows" :key="row.path" class="sce__valrow" :class="{ 'sce__valrow--changed': row.changed }" data-test="dbg-value">
                      <code :title="`data.${row.path}`">{{ row.path }}</code>
                      <label v-if="row.type === 'boolean'" class="sce__switch"><input type="checkbox" :checked="row.changed ? debug.overrides[row.path] : row.json === 'true'" @change="setBool(row, $event.target.checked)"><span>{{ (row.changed ? debug.overrides[row.path] : row.json === 'true') ? 'true' : 'false' }}</span></label>
                      <input v-else class="sce__valinput" :value="shownValue(row)" :placeholder="row.text" spellcheck="false" :aria-label="row.path" @change="setValue(row, $event.target.value)" @keydown.enter="$event.target.blur()">
                      <button v-if="row.changed" type="button" class="sce__iconbtn" :data-tip="$t('splCodeEditor.dbg_reset_one')" :aria-label="$t('splCodeEditor.dbg_reset_one')" @click="resetValue(row.path)"><i class="pi pi-undo" /></button>
                    </div>
                  </section>
                </template>
              </ProductView>
            </section>
          </aside>
        </div>
        <div v-if="current && !notice" class="sce__statusbar" role="status" data-test="status-bar">
          <span class="sce__stat" data-test="status-pos">{{ $t('splCodeEditor.status_pos', { line: posInfo.line, col: posInfo.col }) }}<template v-if="posInfo.sel"> {{ $t('splCodeEditor.status_sel', { n: posInfo.sel }) }}</template></span>
          <span class="sce__spacer" />
          <button type="button" class="sce__stat sce__stat--btn" :class="{ 'sce__stat--on': prefs.wrap }" :aria-pressed="prefs.wrap" :title="$t('splCodeEditor.wrap_title')" data-test="toggle-wrap" @click="prefs.wrap = !prefs.wrap">{{ $t('splCodeEditor.wrap') }}</button>
          <button type="button" class="sce__stat sce__stat--btn" :class="{ 'sce__stat--on': prefs.minimap }" :aria-pressed="prefs.minimap" :title="$t('splCodeEditor.minimap_title')" data-test="toggle-minimap" @click="prefs.minimap = !prefs.minimap">{{ $t('splCodeEditor.minimap') }}</button>
          <span class="sce__stat" :title="$t('splCodeEditor.status_indent')">{{ posInfo.indent }}</span>
          <span class="sce__stat" :title="$t('splCodeEditor.status_eol')">{{ posInfo.eol }}</span>
          <span class="sce__stat" data-test="status-lang">{{ posInfo.lang }}</span>
        </div>
      </div>
    </div>

    <div v-if="pick.open" class="sce__quick" data-test="pick-panel" @mousedown.self="closePick">
      <div class="sce__quickbox" role="dialog" :aria-label="$t('splCodeEditor.pick_feature')">
        <input ref="pickInput" v-model="pick.text" class="sce__quickinput" :placeholder="$t('splCodeEditor.pick_placeholder')" data-test="pick-input" autocomplete="off" spellcheck="false" @keydown="onPickKey">
        <ul class="sce__quicklist" role="listbox">
          <li v-for="(item, i) in pickItems" :key="item.name" role="option" :aria-selected="i === pick.index" class="sce__quickitem" :class="{ 'sce__quickitem--on': i === pick.index }" data-test="pick-item" @mousedown.prevent="choosePick(item)" @mousemove="pick.index = i">
            <i class="sce__dot" :style="swatch(item.name)" />
            <span class="sce__quickname">{{ item.unknown.length ? $t('splCodeEditor.pick_create', { name: item.name }) : item.name }}</span>
          </li>
          <li v-if="!pickItems.length" class="sce__quicknone">{{ $t('splCodeEditor.pick_none') }}</li>
        </ul>
        <p class="sce__quickhint">{{ $t('splCodeEditor.pick_hint') }}</p>
      </div>
    </div>

    <div v-if="quick.open" class="sce__quick" data-test="quick-panel" @mousedown.self="closeQuick">
      <div class="sce__quickbox" role="dialog" :aria-label="$t('splCodeEditor.quick_open')">
        <input ref="quickInput" v-model="quick.text" class="sce__quickinput" :placeholder="$t('splCodeEditor.quick_placeholder')" data-test="quick-input" autocomplete="off" spellcheck="false" @keydown="onQuickKey">
        <ul class="sce__quicklist" role="listbox">
          <li v-for="(r, i) in quickResults" :key="r.path" role="option" :aria-selected="i === quick.index" :class="{ 'sce__quickitem--on': i === quick.index }" class="sce__quickitem" data-test="quick-item" @mousedown.prevent="pickQuick(r)" @mousemove="quick.index = i">
            <span class="sce__quickname"><template v-for="(seg, k) in segments(r.path, r.positions)" :key="k"><b v-if="seg.hit">{{ seg.text }}</b><template v-else>{{ seg.text }}</template></template></span>
            <span v-if="changes[r.path]" class="sce__dirty" :class="`sce__dirty--${changes[r.path].action}`">●</span>
          </li>
          <li v-if="!quickResults.length" class="sce__quicknone">{{ quickParsed.line && !quickParsed.query ? `:${quickParsed.line}` : $t('splCodeEditor.quick_none') }}</li>
        </ul>
        <p class="sce__quickhint">{{ $t('splCodeEditor.quick_hint') }}</p>
      </div>
    </div>

    <Dialog v-model:visible="review.open" modal :header="$t('splCodeEditor.review_title')" :style="{ width: '68rem', maxWidth: '96vw' }" data-test="review-dialog">
      <p class="sce__reviewsum" data-test="review-summary">
        <strong>{{ $t('splCodeEditor.changes', { n: changeList.length }, changeList.length) }}</strong>
        <span class="sce__add">+{{ reviewTotals.added }}</span> <span class="sce__del">−{{ reviewTotals.removed }}</span>
        <span class="sce__muted sce__muted--inline">· {{ [reviewTotals.create && `${reviewTotals.create} ${$t('splCodeEditor.review_create')}`, reviewTotals.update && `${reviewTotals.update} ${$t('splCodeEditor.review_update')}`, reviewTotals.delete && `${reviewTotals.delete} ${$t('splCodeEditor.review_delete')}`].filter(Boolean).join(' · ') }}</span>
      </p>
      <div class="sce__review">
        <ul class="sce__reviewlist" data-test="review-list" tabindex="0" role="listbox" :aria-label="$t('splCodeEditor.review_title')" @keydown.down.prevent="moveReview(1)" @keydown.up.prevent="moveReview(-1)">
          <li v-for="c in changeList" :key="c.path" :class="{ 'sce__reviewitem--on': c.path === review.selected }" class="sce__reviewitem" role="option" :aria-selected="c.path === review.selected" data-test="review-item">
            <button type="button" class="sce__reviewpick" :title="c.path" tabindex="-1" @click="review.selected = c.path">
              <span class="sce__reviewline">
                <span class="sce__reviewkind" :class="`sce__reviewkind--${c.action}`">{{ $t(`splCodeEditor.review_${c.action}`) }}</span>
                <span v-if="review.stats[c.path]" class="sce__reviewstat"><span class="sce__add">+{{ review.stats[c.path].added }}</span> <span class="sce__del">−{{ review.stats[c.path].removed }}</span></span>
              </span>
              <span class="sce__reviewname">{{ splitPath(c.path).name }}</span>
              <span v-if="splitPath(c.path).folder" class="sce__reviewfolder">{{ splitPath(c.path).folder }}</span>
            </button>
            <Button icon="pi pi-undo" text size="small" :aria-label="$t('splCodeEditor.review_discard_one')" :title="$t('splCodeEditor.review_discard_one')" data-test="review-discard-one" @click="discardOne(c.path)" />
          </li>
        </ul>
        <div class="sce__reviewdiff">
          <div v-if="review.selected" class="sce__difftools">
            <span class="sce__diffpath" :title="review.selected">{{ review.selected }}</span>
            <span class="sce__spacer" />
            <Button :label="$t('splCodeEditor.review_open_file')" icon="pi pi-external-link" text size="small" :disabled="changes[review.selected]?.action === 'delete'" data-test="review-open-file" @click="openFromReview" />
            <span class="sce__seg" role="group">
              <button type="button" :class="{ 'sce__seg--on': !review.sideBySide }" :aria-pressed="!review.sideBySide" data-test="diff-inline" @click="review.sideBySide = false">{{ $t('splCodeEditor.review_inline') }}</button>
              <button type="button" :class="{ 'sce__seg--on': review.sideBySide }" :aria-pressed="review.sideBySide" data-test="diff-side" @click="review.sideBySide = true">{{ $t('splCodeEditor.review_side') }}</button>
            </span>
          </div>
          <p v-else class="sce__muted">{{ $t('splCodeEditor.review_pick') }}</p>
          <div v-show="review.selected" ref="diffBox" class="sce__diffbox" data-test="review-diff" />
        </div>
      </div>
      <p class="sce__muted sce__reviewhint">{{ $t('splCodeEditor.review_hint') }}</p>
      <template #footer>
        <Button :label="review.confirmAll ? $t('splCodeEditor.review_confirm_all', { n: changeList.length }) : $t('splCodeEditor.review_discard_all')" :icon="review.confirmAll ? 'pi pi-exclamation-triangle' : undefined" text severity="danger" data-test="review-discard-all" @click="discardAllFromReview" />
        <Button :label="$t('splCodeEditor.close')" text @click="review.open = false" />
        <Button :label="$t('splCodeEditor.save')" icon="pi pi-check" data-test="review-save" @click="saveFromReview" />
      </template>
    </Dialog>

    <Dialog v-model:visible="switchAsk.open" modal :header="$t('splCodeEditor.switch_title')" :style="{ width: '28rem', maxWidth: '96vw' }">
      <p class="sce__ask" data-test="switch-ask">{{ $t('splCodeEditor.switch_confirm', { n: changeCount, branch: switchAsk.target }) }}</p>
      <div class="sce__actions">
        <Button type="button" :label="$t('splCodeEditor.cancel')" text data-test="switch-cancel" @click="switchAsk.open = false" />
        <Button type="button" :label="$t('splCodeEditor.switch_discard')" severity="danger" data-test="switch-confirm" @click="confirmSwitch" />
      </div>
    </Dialog>

    <Dialog v-model:visible="commit.open" modal :header="$t('splCodeEditor.commit_title')" :style="{ width: '28rem' }">
      <form class="sce__form" @submit.prevent="doCommit">
        <label>{{ $t('splCodeEditor.commit_branch', { base: branch }) }}
          <InputText v-model="commit.branch" list="sce-branches" data-test="commit-branch" :invalid="!!branchProblem" />
        </label>
        <small v-if="branchProblem" class="sce__muted sce__muted--bad" data-test="branch-problem">{{ branchProblem }}</small>
        <datalist id="sce-branches"><option v-for="b in branches" :key="b" :value="b" /></datalist>
        <label>{{ $t('splCodeEditor.commit_message') }}<InputText v-model="commit.message" data-test="commit-message" /></label>
        <p v-if="commit.error" class="sce__muted sce__muted--bad" role="alert" data-test="commit-error">{{ commit.error }}</p>
        <div class="sce__actions">
          <Button type="button" :label="$t('splCodeEditor.cancel')" text @click="commit.open = false" />
          <Button type="submit" :label="$t('splCodeEditor.save')" :loading="commit.busy" :disabled="!commit.branch.trim() || !!branchProblem || !commit.message.trim()" data-test="commit-submit" />
        </div>
      </form>
    </Dialog>
  </section>
  </Teleport>
</template>

<style scoped>
.sce { display: flex; flex-direction: column; gap: 8px; flex: 1; height: 100%; min-height: 320px; padding: 10px 14px 12px; box-sizing: border-box; }
.sce--max { padding: 10px 14px 12px; }
.sce__bar { display: flex; align-items: center; gap: 10px; }
.sce__branch { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--p-text-muted-color); }
.sce__branch select { padding: 4px 8px; border: 1px solid var(--p-content-border-color); border-radius: 6px; background: var(--p-content-background); color: var(--p-text-color); }
.sce__spacer { flex: 1; }
.sce__count { font-size: 12px; color: var(--p-text-muted-color); background: none; border: 0; cursor: pointer; text-decoration: underline dotted; padding: 2px 4px; font-family: inherit; }
.sce__count:hover { color: var(--p-primary-color); }
.sce__reviewsum { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; font-size: 14px; }
.sce__add { color: #22c55e; font-variant-numeric: tabular-nums; font-weight: 600; }
.sce__del { color: #ef4444; font-variant-numeric: tabular-nums; font-weight: 600; }
.sce__review { display: flex; gap: 16px; min-height: 380px; }
.sce__reviewlist { list-style: none; margin: 0; padding: 0; width: 19rem; flex: none; max-height: 440px; overflow: auto; border: 1px solid var(--p-content-border-color); border-radius: 8px; outline: none; }
.sce__reviewlist:focus-visible { border-color: var(--p-primary-color); }
.sce__reviewitem { display: flex; align-items: center; border-bottom: 1px solid var(--p-content-border-color); padding-right: 4px; }
.sce__reviewitem:last-child { border-bottom: 0; }
.sce__reviewitem--on { background: var(--p-highlight-background, var(--p-content-hover-background)); box-shadow: inset 3px 0 0 var(--p-primary-color); }
.sce__reviewpick { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 2px; text-align: left; background: none; border: 0; padding: 8px 10px; cursor: pointer; color: var(--p-text-color); font-family: inherit; }
.sce__reviewline { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sce__reviewstat { font-size: 11px; }
.sce__reviewname { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sce__reviewfolder { font-size: 11px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.sce__reviewkind { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
.sce__reviewkind--create { color: #22c55e; }
.sce__reviewkind--update { color: #f59e0b; }
.sce__reviewkind--delete { color: #ef4444; }
.sce__reviewdiff { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.sce__difftools { display: flex; align-items: center; gap: 8px; }
.sce__diffpath { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sce__seg { display: inline-flex; border: 1px solid var(--p-content-border-color); border-radius: 6px; overflow: hidden; }
.sce__seg button { border: 0; background: transparent; color: var(--p-text-muted-color); padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
.sce__seg .sce__seg--on { background: var(--p-highlight-background, var(--p-content-hover-background)); color: var(--p-text-color); font-weight: 600; }
.sce__diffbox { height: 420px; border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow: hidden; }
.sce__reviewhint { margin: 10px 0 0; }
.sce__fold { flex: none; width: 34px; border-left: 1px solid var(--p-content-border-color); }
.sce__tabs .sce__fold { flex: none; }
.sce__side.sce__side--closed { width: 44px; }
.sce__rail { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; }
.sce__railbtn { width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--p-text-muted-color); cursor: pointer; }
.sce__railbtn:hover { background: var(--p-content-hover-background); color: var(--p-text-color); }
.sce__railbtn--on { color: var(--p-primary-color); background: var(--p-highlight-background, var(--p-content-hover-background)); }
.sce__cfgcount { margin: 0 12px 8px; font-size: 13px; font-weight: 600; }
.sce__only { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--p-text-muted-color); cursor: pointer; }
.sce__check { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
.sce__check:hover { background: var(--p-content-hover-background); }
.sce__check--on { font-weight: 600; }
.sce__checkname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sce__trialbox { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px 12px 0; margin-top: 8px; border-top: 1px solid var(--p-content-border-color); }
.sce__trialbox .sce__muted { margin: 0; }
/* a notice floats over the bottom of the editor: it must not push the code down and back */
.sce__status { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 60; max-width: min(90%, 720px); margin: 0; padding: 8px 14px; border-radius: 8px; font-size: 13px; background: var(--p-content-background); border: 1px solid var(--p-content-border-color); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
.sce__status--error { color: var(--status-bad, #c62828); }
.sce__status--ok { color: var(--status-good, #2e7d32); }
.sce__body { display: flex; flex: 1; min-height: 0; border: 1px solid var(--p-content-border-color); border-radius: 8px; overflow: hidden; background: var(--p-content-background); }
.sce__side { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--p-content-border-color); }
.sce__tabs { display: flex; border-bottom: 1px solid var(--p-content-border-color); }
.sce__tabs { flex-wrap: wrap; }
.sce__tabs button { flex: 1 1 auto; padding: 10px 6px; border: 0; background: transparent; color: var(--p-text-muted-color); cursor: pointer; font-size: 13px; border-bottom: 2px solid transparent; }
.sce__tabs .sce__tab--on { color: var(--p-text-color); border-bottom-color: var(--p-primary-color); font-weight: 500; }
.sce__panel { flex: 1; overflow: auto; padding: 10px 0 14px; }
.sce__tools { display: flex; align-items: center; gap: 6px; padding: 0 12px 8px; }
.sce__filter { flex: 1; }
.sce__pathinput { display: flex; gap: 2px; padding: 0 8px 6px; }
.sce__pathinput :deep(input) { flex: 1; }
.sce__muted { color: var(--p-text-muted-color); font-size: 12px; margin: 4px 12px; line-height: 1.4; }
.sce__feature { padding: 3px 12px; font-size: 13px; }
.sce__feature summary { cursor: pointer; padding: 3px 0; }
.sce__badge { font-size: 11px; padding: 0 6px; border-radius: 10px; background: var(--p-content-hover-background); color: var(--p-text-secondary-color, var(--p-text-muted-color)); }
.sce__spot { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: var(--p-text-color); padding: 2px 0 2px 12px; cursor: pointer; font-size: 12px; font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sce__spot:hover { background: var(--p-content-hover-background); }
.sce__checks { display: flex; flex-direction: column; gap: 1px; padding: 2px 6px 6px; font-size: 13px; }
.sce__trial { margin: 8px 12px; padding: 10px; border-radius: 6px; font-size: 12px; border: 1px solid var(--p-content-border-color); }
.sce__trial--ok strong { color: var(--status-good, #2e7d32); }
.sce__trial--bad strong { color: var(--status-bad, #c62828); }
.sce__trial pre { white-space: pre-wrap; margin: 6px 0 0; }
.sce__trial ul { margin: 6px 0 0; padding-left: 16px; }
.sce__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sce__annot { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--p-content-border-color); }
.sce__annot--off { opacity: 0.5; pointer-events: none; }
.sce__editor { position: relative; flex: 1; min-height: 0; }
.sce__monaco { position: absolute; inset: 0; }
.sce__empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; margin: 0; background: var(--p-content-background); color: var(--p-text-muted-color); font-size: 14px; }
.sce__form { display: flex; flex-direction: column; gap: 12px; }
.sce__form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.sce__actions { display: flex; justify-content: flex-end; gap: 8px; }
.sce__palette { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--p-text-muted-color); }
.sce__palette select { padding: 2px 4px; border: 1px solid var(--p-content-border-color); border-radius: 6px; background: var(--p-content-background); color: var(--p-text-color); font-size: 12px; }
.sce__dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; flex-shrink: 0; }
.sce__chip { display: inline-flex; align-items: center; font-size: 12px; padding: 1px 8px; border-radius: 10px; background: var(--p-content-hover-background); white-space: nowrap; }
.sce__checks label { display: flex; align-items: center; }
.sce__feature summary .sce__badge { margin-left: 6px; }
/* the text of a marker keeps its contrast on any tint, whatever the editor theme makes of a comment */
:global(.monaco-editor .sce-marker-text) { font-weight: 600; font-style: normal; }
:global(.monaco-editor .sce-marker-text--dark) { color: #f8fafc !important; }
:global(.monaco-editor .sce-marker-text--light) { color: #111827 !important; }
/* the derived output and the help */
.sce__split { display: flex; flex: 1; min-height: 0; }
.sce__editor { min-width: 0; }
.sce__ask { margin: 0 0 16px; line-height: 1.5; }
/* a small window: the bars keep one row each and the code gets the height (every button keeps its tooltip) */
.sce--narrow .sce__grouplabel, .sce--narrow .sce__muted--inline, .sce--narrow [data-test="unannotate"] :deep(.p-button-label), .sce--narrow [data-test="legend-toggle"] :deep(.p-button-label) { display: none; }
.sce--narrow .sce__group + .sce__group { padding-left: 8px; }
.sce--narrow .sce__featureinput { width: 140px; }
.sce--short .sce__crumbs { display: none; }
.sce--short { gap: 4px; padding-top: 6px; padding-bottom: 8px; }
.sce__statusbar { display: flex; align-items: center; gap: 2px; flex: none; min-height: 24px; padding: 0 8px; border-top: 1px solid var(--p-content-border-color); background: var(--p-content-hover-background); font-size: 12px; color: var(--p-text-muted-color); overflow: hidden; white-space: nowrap; }
.sce__stat { padding: 2px 8px; font-variant-numeric: tabular-nums; border: 0; background: none; color: inherit; font: inherit; }
.sce__stat--btn { cursor: pointer; border-radius: 4px; }
.sce__stat--btn:hover { background: var(--p-content-border-color); color: var(--p-text-color); }
.sce__stat--on { color: var(--p-primary-color); font-weight: 600; }
.sce__derived { flex: 0 0 46%; min-width: 0; display: flex; flex-direction: column; border-left: 1px solid var(--p-content-border-color); }
.sce__derivedhead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 10px; font-size: 12.5px; border-bottom: 1px solid var(--p-content-border-color); }
.sce__config { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--p-content-border-color); max-height: 96px; overflow: auto; }
.sce__chip--toggle { border: 1px solid var(--p-content-border-color); background: transparent; opacity: 0.75; }
.sce__chip--here { border-style: dashed; opacity: 1; }
.sce__cfg { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--p-content-border-color); }
.sce__cfg--more { background: var(--p-content-hover-background); }
.sce__cfgtitle { font-size: 12px; }
.sce__chip .pi { font-size: 10px; margin-right: 4px; }
:global(.monaco-editor .sce-off) { opacity: 0.4; }
.sce__chip--on { background: var(--p-highlight-background, var(--p-content-hover-background)); border-color: var(--p-primary-color); border-style: solid; opacity: 1; font-weight: 600; }
.sce__derivedbox { position: relative; flex: 1; min-height: 0; }
.sce__derivedmsg { padding: 10px; overflow: auto; }
.sce__banner { display: flex; align-items: center; gap: 8px; padding: 5px 10px; font-size: 12.5px; background: rgba(234, 179, 8, 0.16); border-bottom: 1px solid rgba(234, 179, 8, 0.45); color: var(--p-text-color); }
.sce__banner i { color: #eab308; }
.sce__banner--panel { margin: 8px 12px; border: 1px solid rgba(234, 179, 8, 0.45); border-radius: 6px; flex-wrap: wrap; }
.sce__btn--on { background: var(--p-highlight-background, var(--p-content-hover-background)) !important; color: var(--p-primary-color) !important; border-color: var(--p-primary-color) !important; }
/* going around */
.sce.sce--max { position: fixed; inset: 0; z-index: 1000; height: 100vh; min-height: 0; padding: 8px 12px; background: var(--p-content-background, var(--p-surface-0, #fff)); box-sizing: border-box; }
.sce__files { display: flex; overflow-x: auto; border-bottom: 1px solid var(--p-content-border-color); scrollbar-width: thin; }
.sce__file { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 12px; font-size: 12.5px; cursor: pointer; white-space: nowrap; color: var(--p-text-muted-color); border-right: 1px solid var(--p-content-border-color); border-bottom: 2px solid transparent; }
.sce__file:hover { background: var(--p-content-hover-background); }
.sce__file--on { color: var(--p-text-color); border-bottom-color: var(--p-primary-color); background: var(--p-content-hover-background); }
.sce__x { border: 0; background: transparent; color: var(--p-text-muted-color); cursor: pointer; padding: 2px 4px; border-radius: 4px; font-size: 10px; opacity: 0.6; }
.sce__file:hover .sce__x, .sce__file--on .sce__x { opacity: 1; }
.sce__x:hover { background: var(--p-content-border-color); color: var(--p-text-color); }
.sce__dirty { font-size: 9px; }
.sce__dirty--create { color: var(--status-good, #2e7d32); }
.sce__dirty--update { color: var(--status-warn, #b26a00); }
.sce__crumbs { display: flex; align-items: center; gap: 2px; padding: 2px 10px; font-size: 12px; color: var(--p-text-muted-color); border-bottom: 1px solid var(--p-content-border-color); overflow: hidden; white-space: nowrap; }
.sce__crumb { border: 0; background: transparent; color: inherit; padding: 1px 3px; border-radius: 4px; font: inherit; cursor: pointer; }
.sce__crumb:hover { background: var(--p-content-hover-background); color: var(--p-text-color); }
.sce__crumb--file { color: var(--p-text-color); cursor: default; }
.sce__sep { opacity: 0.5; }
.sce__chip { border: 0; color: var(--p-text-color); cursor: pointer; font-family: inherit; }
.sce__chip:hover { background: var(--p-content-border-color); }
.sce__searchform { display: flex; flex-direction: column; gap: 4px; padding: 0 8px 4px; }
.sce__searchrow { display: flex; align-items: center; gap: 3px; }
.sce__toggle { border: 1px solid transparent; background: transparent; color: var(--p-text-muted-color); border-radius: 4px; padding: 2px 5px; font-size: 12px; cursor: pointer; font-family: var(--font-mono, monospace); }
.sce__toggle:hover { background: var(--p-content-hover-background); }
.sce__toggle--on { border-color: var(--p-primary-color); color: var(--p-text-color); background: var(--p-content-hover-background); }
.sce__muted--bad { color: var(--status-bad, #c62828); }
.sce__muted--inline { margin: 0 4px 0 0; }
.sce__spot mark { background: rgba(255, 200, 0, 0.35); color: inherit; border-radius: 2px; }
.sce { position: relative; }
.sce__quick { position: absolute; inset: 0; z-index: 20; display: flex; justify-content: center; align-items: flex-start; padding-top: 70px; background: rgba(0, 0, 0, 0.25); }
.sce__quickbox { width: min(560px, 92%); max-height: 70%; display: flex; flex-direction: column; background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 10px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35); overflow: hidden; }
.sce__quickinput { border: 0; border-bottom: 1px solid var(--p-content-border-color); background: transparent; color: var(--p-text-color); padding: 12px 14px; font-size: 14px; outline: none; }
.sce__quicklist { list-style: none; margin: 0; padding: 4px 0; overflow: auto; }
.sce__quickitem { padding: 5px 14px; font-size: 13px; font-family: var(--font-mono, monospace); cursor: pointer; color: var(--p-text-color); display: flex; gap: 8px; align-items: center; }
.sce__quickitem b { color: var(--p-primary-color); font-weight: 700; }
.sce__quickitem--on { background: var(--p-highlight-background, var(--p-content-hover-background)); }
.sce__quicknone { padding: 10px 14px; font-size: 13px; color: var(--p-text-muted-color); }
.sce__quickhint { margin: 0; padding: 6px 14px; font-size: 11px; color: var(--p-text-muted-color); border-top: 1px solid var(--p-content-border-color); }
.sce__h { margin: 10px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--p-text-muted-color); }
.sce__ops { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 6px; }
.sce__op, .sce__opk { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 11.5px; font-weight: 600; border: 1px solid transparent; }
.sce__opk { margin-right: 4px; }
.sce__op--header { color: #7e3fc0; background: rgba(168, 99, 235, 0.14); border-color: rgba(168, 99, 235, 0.4); }
.sce__op--echo { color: #b45309; background: rgba(245, 158, 11, 0.16); border-color: rgba(245, 158, 11, 0.45); }
.sce__op--code { color: #0f766e; background: rgba(20, 184, 166, 0.14); border-color: rgba(20, 184, 166, 0.4); }
.sce__op--cond { color: var(--p-text-muted-color); background: var(--p-content-hover-background); border-color: var(--p-content-border-color); }
.sce__oplist { display: block; max-height: 180px; overflow: auto; }
.sce__oplist .sce__spot, .sce__feature .sce__spot { line-height: 1.7; }
.sce__data { width: 100%; box-sizing: border-box; font-family: var(--font-mono, monospace); font-size: 12px; padding: 6px 8px; border: 1px solid var(--p-content-border-color); border-radius: 6px; background: var(--p-content-background); color: var(--p-text-color); resize: vertical; }
.sce__data[aria-invalid='true'] { border-color: var(--p-red-500, #dc2626); }
.sce__outsel { max-width: 160px; font-size: 12px; }
.sce__spot--on { background: var(--p-highlight-background, var(--p-content-hover-background)); }
:global(.monaco-editor .sce-op) { border-radius: 3px; font-weight: 600; }
:global(.monaco-editor .sce-op-echo.sce-op--light) { color: #92400e !important; background: rgba(245, 158, 11, 0.22); }
:global(.monaco-editor .sce-op-echo.sce-op--dark) { color: #fcd34d !important; background: rgba(245, 158, 11, 0.2); }
:global(.monaco-editor .sce-op-header.sce-op--light) { color: #6b21a8 !important; background: rgba(168, 99, 235, 0.22); }
:global(.monaco-editor .sce-op-header.sce-op--dark) { color: #d8b4fe !important; background: rgba(168, 99, 235, 0.22); }
:global(.monaco-editor .sce-op-code.sce-op--light) { color: #115e59 !important; background: rgba(20, 184, 166, 0.2); }
:global(.monaco-editor .sce-op-code.sce-op--dark) { color: #5eead4 !important; background: rgba(20, 184, 166, 0.2); }
:global(.monaco-editor .sce-dbg) { font-style: italic; font-weight: 400; opacity: 0.85; color: #0e7490 !important; }
:global(.monaco-editor .sce-dbg--off) { color: #94a3b8 !important; opacity: 0.8; }
/* ---- the dock: Result / Scenario / Debugger ---- */
.sce__split--col { flex-direction: column; }
.sce__dock { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--p-content-background); container-type: inline-size; }
/* a narrow dock: only the open view keeps its words, the others and the history button keep their icons (and tooltips) */
@container (max-width: 600px) {
  .sce__docktabs button:not([aria-selected='true']) span, .sce__histbtn span { display: none; }
  .sce__docktabs button { padding: 9px 10px; }
}
.sce__dockhead { display: flex; align-items: center; gap: 2px; padding: 0 6px 0 2px; border-bottom: 1px solid var(--p-content-border-color); background: var(--p-content-hover-background); }
.sce__docktabs { display: flex; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.sce__docktabs button { display: inline-flex; align-items: center; gap: 6px; padding: 9px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--p-text-muted-color); font-size: 13px; cursor: pointer; white-space: nowrap; }
.sce__docktabs button:hover { color: var(--p-text-color); }
.sce__docktab--on { color: var(--p-text-color) !important; border-bottom-color: var(--p-primary-color) !important; font-weight: 600; }
.sce__iconbtn { width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--p-text-muted-color); cursor: pointer; }
.sce__iconbtn:hover { background: var(--p-content-border-color); color: var(--p-text-color); }
.sce__dockbody { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.sce__dockbody--scroll { overflow: auto; padding: 12px 14px 18px; gap: 4px; }
.sce__lead { margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: var(--p-text-color); }
.sce__sec { border-top: 1px solid var(--p-content-border-color); padding: 8px 0 10px; }
.sce__sec > summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; }
.sce__sec > summary::-webkit-details-marker { display: none; }
.sce__sec > summary::before { content: '▸'; font-size: 10px; color: var(--p-text-muted-color); transition: transform 0.12s; }
.sce__sec[open] > summary::before { transform: rotate(90deg); }
.sce__sec .sce__h { margin: 0; }
.sce__resulthead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px 4px; }
.sce__resultname { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sce__status2 { margin: 0; padding: 0 12px 6px; font-size: 12px; display: flex; align-items: center; gap: 6px; min-height: 22px; color: var(--p-text-muted-color); }
.sce__ok { color: var(--p-green-600, #16a34a); }
.sce__bad { color: var(--p-red-500, #dc2626); }
.sce__link { border: 0; background: transparent; color: var(--p-primary-color); cursor: pointer; font-size: 12px; padding: 2px 4px; text-decoration: underline; }
.sce__actions--start { justify-content: flex-start; }
.sce__dockbody--result .sce__config { border-top: 1px solid var(--p-content-border-color); }
/* the scenario strip over the code */
.sce__cfg { gap: 6px 10px; }
.sce__scenario { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--p-content-border-color); border-radius: 999px; background: var(--p-content-hover-background); color: var(--p-text-color); padding: 3px 12px; font-size: 12.5px; cursor: pointer; }
.sce__scenario:hover { border-color: var(--p-primary-color); }
.sce__chips { display: inline-flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.sce__annot { flex-wrap: wrap; }
.sce__main { min-width: 0; }
.sce__side { min-width: 0; }
body.sce-dragging { user-select: none; cursor: grabbing; }
body.sce-dragging .monaco-editor, body.sce-dragging iframe { pointer-events: none; }
/* narrow windows: the dock is a drawer under the code and the bars wrap */
@media (max-width: 720px) {
  .sce__bar { flex-wrap: wrap; }
  .sce__docktabs span { display: none; }
  .sce__docktabs button { padding: 9px 14px; }
}
/* ---- the two bars over the code ---- */
.sce__annot { gap: 6px 14px; padding: 6px 12px; }
.sce__group { display: inline-flex; align-items: center; gap: 6px; }
.sce__group + .sce__group { padding-left: 14px; border-left: 1px solid var(--p-content-border-color); }
.sce__grouplabel { font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--p-text-muted-color); }
.sce__featureinput { width: 180px; }
.sce__cfg { background: var(--p-content-hover-background); padding: 5px 12px; }
.sce__scenario { background: transparent; border-color: transparent; padding: 3px 8px; border-radius: 6px; }
.sce__scenario:hover { background: var(--p-content-border-color); border-color: transparent; }
.sce__scenarioedit { font-size: 11px; color: var(--p-text-muted-color); }
.sce__seg--view button { display: inline-flex; align-items: center; gap: 6px; }
.sce__legendwrap { position: relative; }
.sce__legend { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; width: 300px; max-height: 340px; overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25); }
.sce__legendhead { margin: 0 4px 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--p-text-muted-color); }
.sce__legenditem { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; border-radius: 6px; background: transparent; padding: 5px 8px; cursor: pointer; font-size: 12.5px; color: var(--p-text-color); }
.sce__legenditem span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sce__legenditem i.pi { font-size: 10px; color: var(--p-text-muted-color); }
.sce__legenditem:hover { background: var(--p-content-hover-background); }
.sce__legend .sce__palette { margin-top: 6px; padding: 8px 4px 2px; border-top: 1px solid var(--p-content-border-color); display: flex; justify-content: space-between; align-items: center; }
@media (max-width: 720px) { .sce__group + .sce__group { border-left: 0; padding-left: 0; } .sce__featureinput { width: 130px; } }
.sce__bannertext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sce__bannertext code { font-size: 12px; }
.sce__tools--here { align-items: center; flex-wrap: wrap; gap: 2px 4px; padding: 4px 0; border-top: 1px dashed var(--p-content-border-color); }
.sce__history { display: inline-flex; align-items: center; position: relative; gap: 2px; }
.sce__iconbtn:disabled { opacity: 0.35; cursor: default; }
.sce__histbtn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--p-content-border-color); border-radius: 6px; background: var(--p-content-background); color: var(--p-text-color); padding: 3px 9px; font-size: 12px; cursor: pointer; }
.sce__histbtn:hover { border-color: var(--p-primary-color); }
.sce__scenpop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; width: 330px; max-height: 420px; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 4px; background: var(--p-content-background); border: 1px solid var(--p-content-border-color); border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28); }
.sce__scenwords { margin: 0 4px 4px; font-size: 13px; font-weight: 600; }
.sce__scensave { display: flex; gap: 6px; padding-bottom: 6px; }
.sce__scensave input { flex: 1; min-width: 0; }
.sce__scenrow { display: flex; align-items: center; gap: 2px; }
.sce__scenpick { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; border: 0; border-radius: 6px; background: transparent; padding: 5px 8px; cursor: pointer; font-size: 12.5px; color: var(--p-text-color); }
.sce__scenpick:hover { background: var(--p-content-hover-background); }
.sce__scenpick--on { background: var(--p-highlight-background, var(--p-content-hover-background)); font-weight: 600; }
.sce__scenpick .sce__muted { font-size: 11.5px; }
.sce__togglechips { display: flex; flex-wrap: wrap; gap: 6px; }
.sce__togchip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--p-content-border-color); border-radius: 999px; background: transparent; color: var(--p-text-muted-color); padding: 3px 11px; font-size: 12px; cursor: pointer; }
.sce__togchip:hover { border-color: var(--p-primary-color); color: var(--p-text-color); }
.sce__togchip--on { background: var(--p-highlight-background, var(--p-content-hover-background)); color: var(--p-text-color); border-color: var(--p-primary-color); font-weight: 600; }
.sce__togchip--missing { cursor: default; border-style: dashed; opacity: 0.8; }
.sce__togchip--missing i { color: #eab308; font-size: 11px; }
.sce__valrow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; align-items: center; gap: 6px; padding: 2px 0; }
.sce__valrow code { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--p-text-muted-color); }
.sce__valrow--changed code { color: var(--p-primary-color); font-weight: 700; }
.sce__valinput { width: 100%; min-width: 0; box-sizing: border-box; font-family: var(--font-mono, monospace); font-size: 12px; padding: 4px 7px; border: 1px solid var(--p-content-border-color); border-radius: 6px; background: var(--p-content-background); color: var(--p-text-color); }
.sce__valrow--changed .sce__valinput { border-color: var(--p-primary-color); }
.sce__switch { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono, monospace); font-size: 12px; }
.sce__diag { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--p-content-border-color); border-left: 3px solid var(--p-red-500, #dc2626); border-radius: 8px; background: var(--p-content-background); }
.sce__diaghead { display: flex; gap: 10px; align-items: flex-start; }
.sce__diaghead > i { color: var(--p-red-500, #dc2626); font-size: 18px; margin-top: 2px; }
.sce__diaghead strong { font-size: 14px; }
.sce__diagcause { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--p-text-muted-color); }
.sce__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
.sce__steps li { display: flex; align-items: center; gap: 8px; }
.sce__step--ok i { color: var(--p-green-600, #16a34a); }
.sce__step--bad i { color: var(--p-red-500, #dc2626); }
.sce__step--unknown i { color: var(--p-text-muted-color); }
.sce__restlist { margin: 0; padding-left: 18px; font-size: 12.5px; }
.sce__tech { font-size: 12px; }
.sce__tech summary { cursor: pointer; color: var(--p-text-muted-color); }
.sce__tech pre { white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; margin: 6px 0 0; font-size: 11.5px; }
.sce__validity { margin: 0 0 8px; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; display: flex; flex-direction: column; gap: 8px; }
.sce__validity--bad { border: 1px solid var(--p-red-500, #dc2626); background: rgba(220, 38, 38, 0.06); }
.sce__validity--ok { flex-direction: row; align-items: center; gap: 8px; color: var(--p-green-600, #16a34a); background: rgba(22, 163, 74, 0.08); }
.sce__validityhead { margin: 0; display: flex; align-items: center; gap: 6px; }
.sce__validityhead i { color: var(--p-red-500, #dc2626); }
.sce__badgebtn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--p-red-500, #dc2626); border-radius: 999px; background: rgba(220, 38, 38, 0.08); color: var(--p-red-500, #dc2626); padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
.sce__dockbody--result details.sce__config > summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; cursor: pointer; list-style: none; }
.sce__dockbody--result details.sce__config > p { margin: 4px 0 0; font-size: 12px; word-break: break-word; }
.sce__dbgviews { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; border-bottom: 1px solid var(--p-content-border-color); margin: 6px 0 8px; }
.sce__dbgviews button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 6px 10px; font-size: 12.5px; color: var(--p-text-muted-color); cursor: pointer; }
.sce__dbgviews button:hover { color: var(--p-text-color); }
.sce__dbgview--on { color: var(--p-text-color) !important; border-bottom-color: var(--p-primary-color) !important; font-weight: 600; }
.sce__dbgviews .sce__outsel { margin-left: auto; }
:global(.monaco-editor .sce-origin-line) { background: rgba(245, 158, 11, 0.28) !important; }
:global(.monaco-editor .sce-origin-margin) { background: #f59e0b; width: 4px !important; margin-left: 2px; }
.sce__dockbody--fill { overflow: hidden; padding: 6px 8px 8px; gap: 4px; }
.sce__dockbody--fill .sce__dbgviews { margin: 2px 0 4px; flex: none; }
.sce__tools--status { flex: none; align-items: center; }
.sce__iconbtn--on { color: var(--p-primary-color); background: var(--p-highlight-background, var(--p-content-hover-background)); }
/* ---- the debugger on the whole screen ---- */
.sce__dbgstatus { margin-left: auto; font-size: 12px; }
.sce__dbgviews .sce__outsel { margin-left: 8px; }
.sce__pvwrap { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
.sce__fullgrid { display: contents; }
.sce__fullgrid--on { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr); gap: 10px; flex: 1; min-height: 0; }
.sce__fullgrid--on > .sce__pvwrap { overflow: hidden; }
.sce__fullgrid--on > .sce__rest { overflow: auto; border-left: 1px solid var(--p-content-border-color); padding-left: 10px; }
.sce__fullhead { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--p-text-muted-color); flex: none; }
.sce__fullhead--inner { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--p-content-border-color); }
.sce__fulltitle { font-size: 13px; display: inline-flex; align-items: center; gap: 8px; padding: 6px 4px; }
.sce__dockbody--full { padding: 4px 10px 8px; }
.sce__dockbody--fill .sce__rest { display: flex; flex-direction: column; min-height: 0; }
.sce__dockbody--fill:not(.sce__dockbody--full) .sce__rest { overflow: auto; flex: 1; }
.sce__viewsmenu { position: relative; margin-left: 12px; }
.sce__viewspop { right: auto; left: 0; width: 300px; }
.sce__viewitem { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: center; padding: 5px 6px; border-radius: 6px; font-size: 12.5px; cursor: pointer; }
.sce__viewitem small { grid-column: 2; font-size: 11px; }
.sce__viewitem:hover { background: var(--p-content-hover-background); }
.sce__viewitem--fixed { opacity: 0.7; cursor: default; }
.sce__dock--full { position: relative; }
.sce__dock--full .sce__dockhead { position: absolute; top: 0; right: 0; z-index: 6; width: auto; background: transparent; border: 0; padding: 4px 8px 0 0; }
.sce__dock--full .sce__dbgviews { min-height: 38px; margin: 0 0 4px; padding-right: 250px; border-bottom: 1px solid var(--p-content-border-color); }
.sce__dock--full .sce__dbgbar { min-height: 38px; padding-right: 265px; border-bottom: 1px solid var(--p-content-border-color); padding-bottom: 4px; }
.sce__dock--full .sce__dockbody--full { padding-top: 2px; }
.sce__dock--full .sce__dbgstatus { margin-left: auto; }
.sce__legendhead--gap { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--p-content-border-color); }
.sce__fullrun { margin-left: 12px; }
.sce__iconbar { display: inline-flex; align-items: center; gap: 2px; margin-left: 12px; padding: 2px; border: 1px solid var(--p-content-border-color); border-radius: 8px; }
.sce__iconbtn--toggle { width: 30px; height: 28px; }
.sce__iconbtn--toggle.sce__iconbtn--on { color: var(--p-primary-color); background: var(--p-highlight-background, var(--p-content-hover-background)); box-shadow: inset 0 -2px 0 var(--p-primary-color); }
.sce__iconsep { width: 1px; align-self: stretch; margin: 3px 3px; background: var(--p-content-border-color); }
.sce__colsplit { justify-self: center; align-self: stretch; }
.sce__fullgrid--on > .sce__colsplit::after { inset: 0 -3px; }
/* an instant label on icon buttons (the browser's own title takes a second to show) */
.sce__iconbtn[data-tip], .pv__tweakbtn[data-tip] { position: relative; }
.sce__iconbtn[data-tip]:hover::after, .sce__iconbtn[data-tip]:focus-visible::after, .pv__tweakbtn[data-tip]:hover::after, .pv__tweakbtn[data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; z-index: 60; top: calc(100% + 6px); right: -4px; width: max-content; max-width: 240px; padding: 5px 9px; border-radius: 6px; background: var(--p-text-color); color: var(--p-content-background); font-size: 11.5px; font-weight: 500; line-height: 1.35; text-align: left; white-space: normal; pointer-events: none; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3); }
.sce__dbgbar { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 32px; }
.sce__dbgbar .sce__dbgstatus { margin-left: auto; }
.sce__dbgbar .sce__fullrun { margin-left: 0; }
.sce__dbgbar .sce__iconbar { margin-left: 4px; }
.pv__tweaks .sce__sec:first-of-type { border-top: 0; padding-top: 0; }
.pv__trow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.pv__tlabel { flex: none; min-width: 58px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--p-text-muted-color); }
.pv__trow .sce__togglechips { flex: 1; min-width: 0; }
.pv__vals { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 2px 14px; }
/* the configuration: one list, not a row of pills */
.cfg__section { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
.cfg__section + .cfg__section { border-top: 1px solid var(--p-content-border-color); }
.cfg__head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.cfg__title { font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--p-text-muted-color); }
.cfg__count { font-size: 11px; color: var(--p-text-muted-color); }
.cfg__links { margin-left: auto; display: inline-flex; gap: 8px; }
.cfg__link { border: 0; background: transparent; color: var(--p-primary-color); font-size: 11.5px; cursor: pointer; padding: 0; }
.cfg__search { width: 100%; box-sizing: border-box; padding: 5px 8px; border: 1px solid var(--p-content-border-color); border-radius: 6px; background: var(--p-content-background); color: var(--p-text-color); font-size: 12.5px; margin-bottom: 4px; }
.cfg__list { display: flex; flex-direction: column; max-height: 150px; overflow: auto; }
.cfg__row { display: flex; align-items: center; gap: 9px; padding: 4px 6px; border-radius: 6px; font-size: 12.5px; cursor: pointer; }
.cfg__row:hover { background: var(--p-content-hover-background); }
.cfg__row input { accent-color: var(--p-primary-color); flex: none; }
.cfg__row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfg__row--off span { color: var(--p-text-muted-color); }
.cfg__row--missing { cursor: default; opacity: 0.65; }
.cfg__row--missing i.pi { color: #eab308; font-size: 11px; flex: none; }

</style>
