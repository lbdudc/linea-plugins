import { describe, it, expect } from 'vitest'
import { readModel, completeSelection } from '../../client/selection.js'

const MODEL = `featuremodel Shop
feature Shop {
  mandatory { feature Core { mandatory { feature Db } } }
  optional {
    feature Pay { alternative { feature Card feature Cash } }
    feature Report
    feature Mail
  }
}
constraints {
  Report => Mail
  Card => Pay & Report
}`

describe('completing a selection', () => {
  const model = readModel(MODEL)
  it('adds the root, the parents and the mandatory children', () => {
    expect(new Set(completeSelection(model, ['Card']))).toEqual(new Set(['Card', 'Pay', 'Shop', 'Core', 'Db', 'Report', 'Mail']))
  })
  it('follows what a constraint implies, again and again', () => {
    expect(completeSelection(model, ['Report'])).toContain('Mail')
  })
  it('leaves a selection alone when there is no model', () => {
    expect(completeSelection(null, ['A'])).toEqual(['A'])
  })
  it('reads the structure of the model', () => {
    expect(model.root).toBe('Shop')
    expect(model.parent.get('Cash')).toBe('Pay')
    expect(model.mandatory.get('Shop')).toEqual(['Core'])
  })
})
