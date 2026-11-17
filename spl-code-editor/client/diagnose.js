// Why LINEA does not derive: its error text read into things a person can act on. The most common one is a scenario that is not a valid
// product of the feature model ("choose exactly one of A, B (0 selected) for 'G'"): that is a choice to make, not a failure of the file.

const GROUP = /choose (exactly one|at least one|at most (\d+)|between (\d+) and (\d+|\*)) of (.+?)(?: \((\d+) selected\))? for '([^']+)'/
const HEADER = /^the product does not fit its spl:?$/i

/**
 * `{ problems, rest }` from LINEA's error text (and its diagnostics). A problem is `{ group, rule, options, selected, text }`; `rest` are
 * the lines that say something else, as they are.
 */
export const parseProblems = (error, diagnostics = []) => {
  const lines = [...String(error ?? '').split('\n'), ...diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)]
  const problems = []
  const rest = []
  const seen = new Set()
  for (const raw of lines) {
    const line = raw.trim().replace(/^-\s*/, '')
    if (!line || HEADER.test(line) || seen.has(line)) continue
    seen.add(line)
    const m = GROUP.exec(line)
    if (m) {
      if (seen.has(`group:${m[7]}:${m[1]}`)) continue
      seen.add(`group:${m[7]}:${m[1]}`)
      const rule = m[1].startsWith('exactly') ? 'one' : m[1].startsWith('at least') ? 'some' : m[1].startsWith('at most') ? 'few' : 'range'
      problems.push({ group: m[7], rule, options: m[5].split(',').map((s) => s.trim()).filter(Boolean), selected: m[6] === undefined ? null : Number(m[6]), text: line })
    } else rest.push(line)
  }
  return { problems, rest }
}

/** The change that fixes a problem when `option` is the choice: `{ add, remove }`. Without a choice, the first option. */
export const fixFor = (problem, current, option) => {
  const chosen = option ?? problem.options.find((o) => current.has(o)) ?? problem.options[0]
  const others = problem.options.filter((o) => o !== chosen)
  if (problem.rule === 'one') return { add: [chosen], remove: others }
  if (problem.rule === 'some') return { add: current.has(chosen) || problem.options.some((o) => current.has(o)) ? [] : [chosen], remove: [] }
  return { add: [], remove: [] }
}

/** The scenario's features after fixing every problem the first way (what "complete it for me" does). */
export const fixAll = (problems, current) => {
  const next = new Set(current)
  for (const p of problems) { const { add, remove } = fixFor(p, next); remove.forEach((n) => next.delete(n)); add.forEach((n) => next.add(n)) }
  return next
}

/** Which of a problem's options the scenario has now. */
export const chosenOf = (problem, current) => problem.options.filter((o) => current.has(o))
