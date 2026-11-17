// The file icons: Material Icon Theme (the one of VS Code's "Material Icon Theme"), 1,200 svgs. The rules (which name gets which) come as
// one json, loaded the first time a tree is drawn; each svg is its own small file, fetched when an icon is used.
import { ref } from 'vue'
import { fileIcon, folderIcon } from './fileIconNames.js'

const urls = import.meta.glob('material-file-icons/*.svg', { query: '?url', import: 'default', eager: false })
const manifest = ref(null)
let loading = null
const cache = new Map() // icon name -> url
const resolved = ref(0) // changes when an url arrives: what shows icons draws again

const load = () => {
  if (!loading) loading = import('material-icon-theme/dist/material-icons.json').then((m) => { manifest.value = m.default ?? m }).catch(() => { manifest.value = {} })
  return loading
}

const urlOf = (name) => {
  if (cache.has(name)) return cache.get(name)
  cache.set(name, null)
  const loader = Object.entries(urls).find(([path]) => path.endsWith(`/${name}.svg`))?.[1]
  if (loader) loader().then((found) => { const url = typeof found === 'string' ? found : found?.default; if (typeof url === 'string') { cache.set(name, url); resolved.value++ } }).catch(() => {})
  return null
}

/** The url of the svg for a file (`{ folder: false, name }`) or a folder (`{ folder: true, name, open }`); null until it is known. */
export const iconUrl = ({ folder, name, open = false }) => {
  load()
  // reading `resolved` makes the caller draw again when an icon arrives
  void resolved.value
  if (!manifest.value) return null
  return urlOf(folder ? folderIcon(manifest.value, name, open) : fileIcon(manifest.value, name))
}
