import { describe, it, expect } from 'vitest'
import { clamp, readLayout, fit, dockPosition, compareSize, DEFAULT_LAYOUT, LIMITS } from '../../client/panes.js'

describe('the sizes of the panes', () => {
  it('keeps a size inside its limits', () => {
    expect(clamp(5, 10, 20)).toBe(10)
    expect(clamp(50, 10, 20)).toBe(20)
    expect(clamp(NaN, 10, 20)).toBe(10)
  })
  it('reads what was kept and ignores what makes no sense', () => {
    expect(readLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(readLayout('not json')).toEqual(DEFAULT_LAYOUT)
    expect(readLayout(JSON.stringify({ side: 9999, dock: 1, pos: 'bottom', tab: 'debug' }))).toMatchObject({ side: LIMITS.side[1], dock: LIMITS.dock[0], pos: 'bottom', tab: 'debug' })
    expect(readLayout(JSON.stringify({ pos: 'left', tab: 'x' }))).toMatchObject({ pos: 'right', tab: 'result' })
  })
  it('never lets a pane take the room the code needs', () => {
    expect(fit('dock', 900, 1000)).toBe(700)
    expect(fit('side', 520, 600)).toBe(270)
    expect(fit('dock', 100, 1000)).toBe(LIMITS.dock[0])
  })
  it('puts the dock under the code when the window is narrow', () => {
    expect(dockPosition('right', 700)).toBe('bottom')
    expect(dockPosition('right', 1200)).toBe('right')
    expect(dockPosition('bottom', 1200)).toBe('bottom')
  })
  it('splits the room in half for side by side, leaving the code its minimum', () => {
    expect(compareSize(1000)).toBe(500)
    expect(compareSize(500)).toBe(280)
    expect(readLayout('{"compare":false}').compare).toBe(false)
    expect(readLayout(undefined).compare).toBe(true)
    expect(readLayout('{"fullDock":0.1}').fullDock).toBe(0.25)
    expect(readLayout('{"fullDock":0.7}').fullDock).toBe(0.7)
  })
})
