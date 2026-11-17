// A feature model in LINEA's text (`feature A { mandatory { feature B } optional { feature C } }`, `constraints { A => B }`) read far enough to
// complete a selection the way the engine does before it derives: the parents of what is chosen, the mandatory children, what the
// constraints imply. It is an approximation (the engine is the judge): alternatives and "or" groups are not decided for anyone.

const strip = (text) => String(text ?? '').replace(/\/\/.*$/gm, '')

/** `{ root, parent: Map, mandatory: Map(name -> [names]), constraints: [{ left: [names], right: [names] }] }` or null when there is no model. */
export const readModel = (text) => {
  const source = strip(text)
  const tokens = source.match(/"[^"]*"|=>|<=>|\.\.|[{}()[\]|&!,*]|[^\s{}()[\]|&!,*"=<>]+/g) ?? []
  let i = 0
  const parent = new Map()
  const mandatory = new Map()
  let root = null
  const name = () => { const t = tokens[i++]; return t?.startsWith('"') ? t.slice(1, -1) : t }
  const feature = (up) => {
    if (tokens[i] === 'abstract') i++
    i++ // 'feature'
    const own = name()
    if (up) parent.set(own, up); else root = own
    if (tokens[i] === '{') {
      i++
      while (tokens[i] && tokens[i] !== '}') {
        const kind = tokens[i]
        if (kind === '[') { while (tokens[i] !== ']') i++; i++ } else i++
        if (tokens[i] !== '{') continue
        i++
        while (tokens[i] && tokens[i] !== '}') {
          const child = tokens[i] === 'abstract' ? tokens[i + 2] : tokens[i + 1]
          const label = child?.startsWith('"') ? child.slice(1, -1) : child
          if (kind === 'mandatory') mandatory.set(own, [...(mandatory.get(own) ?? []), label])
          feature(own)
        }
        i++
      }
      i++
    }
  }
  if (tokens[0] === 'featuremodel') i = 2
  while (tokens[i] && tokens[i] !== 'feature' && tokens[i] !== 'abstract') i++
  if (!tokens[i]) return null
  feature(null)
  const constraints = []
  if (tokens[i] === 'constraints') {
    i += 2
    const line = []
    const flush = () => {
      const at = line.indexOf('=>')
      if (at > 0) {
        const names = (list) => list.filter((t, k) => /^[A-Za-z_"]/.test(t) && list[k - 1] !== '!').map((t) => (t.startsWith('"') ? t.slice(1, -1) : t))
        constraints.push({ left: names(line.slice(0, at)), right: names(line.slice(at + 1)), orRight: line.slice(at + 1).includes('|') })
      }
      line.length = 0
    }
    while (tokens[i] && tokens[i] !== '}') {
      // one constraint per line of the source is not known here: a feature after a complete one starts the next
      const t = tokens[i++]
      if (line.length && /^[A-Za-z_"!(]/.test(t) && /^[A-Za-z_")]/.test(line[line.length - 1]) ) { flush() }
      line.push(t)
    }
    flush()
  }
  return { root, parent, mandatory, constraints }
}

/** The selection with what the model adds to it: parents, mandatory children, and what `A => B` makes necessary. */
export const completeSelection = (model, selected) => {
  const set = new Set(selected)
  if (!model) return [...set]
  if (model.root) set.add(model.root)
  let size = -1
  while (size !== set.size) {
    size = set.size
    for (const f of [...set]) {
      const up = model.parent.get(f)
      if (up) set.add(up)
      for (const child of model.mandatory.get(f) ?? []) set.add(child)
    }
    for (const c of model.constraints) if (c.left.length && c.left.every((n) => set.has(n)) && !c.orRight) for (const n of c.right) set.add(n)
  }
  return [...set]
}
