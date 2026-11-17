// Which icon a file or a folder gets in the tree: Material Icon Theme's own rules (its manifest says it by name and by extension).
// Pure functions: `manifest` is that theme's `material-icons.json`; the answer is the name of an svg of the theme (without `.svg`).

// what the theme does not know: the files of this editor's world
const OWN_FILES = { featuremodel: 'tree', featureselection: 'tree', uvl: 'tree', cip: 'puzzle', cipmain: 'puzzle' }

const base = (iconPath) => String(iconPath ?? '').split('/').pop().replace(/\.svg$/, '')
const nameOf = (manifest, key) => base(manifest.iconDefinitions?.[key]?.iconPath) || null

/** The icon of a file: its exact name (`package.json`), else its longest extension (`spec.js` before `js`), else the plain file. */
export const fileIcon = (manifest, fileName) => {
  const name = String(fileName).toLowerCase()
  // a template of the platform keeps the type of what it makes: `_package.json` is a package.json
  if (name.startsWith('_') && name.length > 1 && !manifest.fileNames?.[name]) return fileIcon(manifest, name.slice(1))
  const byName = manifest.fileNames?.[name]
  if (byName) return nameOf(manifest, byName)
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    const key = manifest.fileExtensions?.[ext]
    if (key) return nameOf(manifest, key)
    if (OWN_FILES[ext]) return OWN_FILES[ext]
  }
  return nameOf(manifest, manifest.file) ?? 'file'
}

/** The icon of a folder, open or closed (`src`, `server`, `test`... have their own). */
export const folderIcon = (manifest, folderName, open = false) => {
  const name = String(folderName).toLowerCase()
  const table = open ? manifest.folderNamesExpanded : manifest.folderNames
  const key = table?.[name]
  if (key) return nameOf(manifest, key)
  return nameOf(manifest, open ? manifest.folderExpanded : manifest.folder) ?? (open ? 'folder-open' : 'folder')
}
