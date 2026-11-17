/** `['a/b.js', 'a/c/d.js', 'e.md']` -> nested nodes `{ name, path, folder, children }`, folders first, each level in name order. */
export const buildTree = (paths) => {
  const root = { name: '', path: '', folder: true, children: [] }
  for (const path of paths) {
    let node = root
    const parts = path.split('/')
    parts.forEach((name, index) => {
      const full = parts.slice(0, index + 1).join('/')
      const last = index === parts.length - 1
      let child = node.children.find((c) => c.name === name && c.folder === !last)
      if (!child) {
        child = { name, path: full, folder: !last, children: [] }
        node.children.push(child)
      }
      node = child
    })
  }
  const sort = (node) => {
    node.children.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1))
    node.children.forEach(sort)
  }
  sort(root)
  return root.children
}

/** The innermost region (not a branch of an else) that holds `line`, to take its annotation off. */
export const regionAt = (regions, line) =>
  regions.filter((r) => !r.elseOf && r.startLine <= line && line <= r.endLine).sort((a, b) => b.startLine - a.startLine)[0] ?? null
