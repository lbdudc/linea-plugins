import { describe, it, expect } from 'vitest'
import { parseProblems, fixFor, fixAll, chosenOf } from '../../client/diagnose.js'

const ERROR = `The product does not fit its SPL:
- product .linea/models/featureselection.featureselection: 1:14 choose exactly one of DM_GT_Identity, DM_GT_Sequence (0 selected) for 'DM_GenerationType'
- product .linea/models/featureselection.featureselection: 1:14 choose at least one of MWM_PM_Employees, MWM_PM_Clients for 'MWM_PersonnelManager'
- product .linea/models/featureselection.featureselection: 1:14 choose exactly one of A, B (2 selected) for 'G'
- something else entirely`

describe('reading why LINEA does not derive', () => {
  const { problems, rest } = parseProblems(ERROR, [{ severity: 'warning', message: 'ignored' }])
  it('finds the choices the model asks for', () => {
    expect(problems.map((p) => [p.group, p.rule, p.options, p.selected])).toEqual([
      ['DM_GenerationType', 'one', ['DM_GT_Identity', 'DM_GT_Sequence'], 0],
      ['MWM_PersonnelManager', 'some', ['MWM_PM_Employees', 'MWM_PM_Clients'], null],
      ['G', 'one', ['A', 'B'], 2],
    ])
    expect(rest).toEqual(['something else entirely'])
  })
  it('does not repeat a line the diagnostics say again', () => {
    expect(parseProblems(ERROR, [{ severity: 'error', message: problems[0].text }]).problems).toHaveLength(3)
  })
  it('says a group once, however many times LINEA repeats it', () => {
    const twice = `${ERROR}\n- product x: 1:14 choose exactly one of DM_GT_Identity, DM_GT_Sequence (0 selected) for 'DM_GenerationType'`
    expect(parseProblems(twice).problems).toHaveLength(3)
  })
  it('fixes a choice with the option picked, taking the others away', () => {
    expect(fixFor(problems[0], new Set(), 'DM_GT_Sequence')).toEqual({ add: ['DM_GT_Sequence'], remove: ['DM_GT_Identity'] })
    expect(fixFor(problems[2], new Set(['A', 'B']))).toEqual({ add: ['A'], remove: ['B'] })
    expect(fixFor(problems[1], new Set(['MWM_PM_Clients']), 'MWM_PM_Clients')).toEqual({ add: [], remove: [] })
  })
  it('completes everything the first way', () => {
    const next = fixAll(problems, new Set(['A', 'B']))
    expect([...next].sort()).toEqual(['A', 'DM_GT_Identity', 'MWM_PM_Employees'])
    expect(chosenOf(problems[0], next)).toEqual(['DM_GT_Identity'])
  })
  it('has nothing to say about a text it does not know', () => {
    expect(parseProblems('Cannot read properties of undefined').problems).toEqual([])
    expect(parseProblems('').rest).toEqual([])
  })
})
