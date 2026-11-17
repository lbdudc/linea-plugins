// The sizes of the panes of the editor: the side bar, the dock (result / scenario / debugger) and where the dock sits. Pure functions;
// the editor holds the state and keeps it for the next visit.

export const LIMITS = { side: [200, 520], dock: [280, 900], dockBottom: [150, 700] }
export const COMPACT_WIDTH = 860 // narrower than this, the side bar folds and the dock goes under the code

export const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))

export const DEFAULT_LAYOUT = { side: 300, dock: 520, dockBottom: 300, pos: 'right', tab: 'result', compare: true, fullDock: 0.56 }

/** What was kept (a JSON text), made safe: unknown or out-of-range values fall back to the defaults. */
export const readLayout = (text) => {
  let saved = {}
  try { saved = JSON.parse(text ?? '{}') ?? {} } catch { saved = {} }
  const pick = (key) => clamp(Number(saved[key] ?? DEFAULT_LAYOUT[key]), ...LIMITS[key])
  return {
    side: pick('side'),
    dock: pick('dock'),
    dockBottom: pick('dockBottom'),
    pos: saved.pos === 'bottom' ? 'bottom' : 'right',
    tab: ['result', 'scenario', 'debug'].includes(saved.tab) ? saved.tab : 'result',
    compare: saved.compare !== false,
    fullDock: clamp(Number(saved.fullDock ?? DEFAULT_LAYOUT.fullDock), 0.25, 0.85),
  }
}

/** The size a pane gets for the room there is: never so big that the code has no room left. */
export const fit = (key, wanted, room) => clamp(wanted, LIMITS[key][0], Math.max(LIMITS[key][0], Math.min(LIMITS[key][1], room * (key === 'side' ? 0.45 : key === 'dockBottom' ? 0.55 : 0.7))))

/** Where the dock is: narrow windows put it under the code whatever was chosen. */
export const dockPosition = (pos, width) => (width < COMPACT_WIDTH ? 'bottom' : pos)

/** In the debugger the code and the product go side by side: half of the room each (never less than the dock's minimum). */
export const compareSize = (room) => clamp(Math.round(room / 2), LIMITS.dock[0], Math.max(LIMITS.dock[0], room - 280))
