import messages from './agents/i18n/index.js'
import { setClient } from './agents/api/http.js'
import { setRouter } from './agents/router/index.js'

// The agents' pages, as pages of LINEA: under the Agents tab, in LINEA's layout, with LINEA's session. Their names are the ones the pages
// navigate by.
const PAGES = [
  { path: '', name: 'flujo', component: () => import('./agents/pages/FlowPage.vue') },
  { path: 'divergencia', name: 'divergencia', component: () => import('./agents/pages/DivergenciaPage.vue') },
  { path: 'consolidacion', name: 'consolidacion', component: () => import('./agents/pages/ConsolidacionPage.vue') },
  { path: 'actividad', name: 'actividad', component: () => import('./agents/pages/ActivityPage.vue') },
  { path: 'operaciones', name: 'operaciones', component: () => import('./agents/pages/OpsPage.vue') },
  { path: 'propagacion', name: 'propagacion', component: () => import('./agents/pages/SyncPage.vue') },
  { path: 'salud', name: 'salud', component: () => import('./agents/pages/SaludPage.vue') },
  { path: 'memoria', name: 'memoria', component: () => import('./agents/pages/MemoriaPage.vue') },
  { path: 'pruebas', name: 'pruebas', component: () => import('./agents/pages/PruebasPage.vue') },
  { path: 'guia', name: 'guia', component: () => import('./agents/pages/GuiaPage.vue') },
  { path: 'catalogo', name: 'catalogo', component: () => import('./agents/pages/CatalogPage.vue') },
]

export default {
  register(ui) {
    setClient(ui.api)
    setRouter(ui.router)
    // their words join LINEA's; where both say something, LINEA's stays
    ui.addI18n(messages, { keepExisting: true })
    ui.addNav({ id: 'agents', icon: 'pi-sparkles', label: { en: 'Agents', es: 'Agentes', gl: 'Axentes' }, to: '/agents', activeFor: ['/agents'] })
    // the frame is loaded when a page opens (it needs the router, which is given just above)
    ui.addPages({ path: '/agents', shell: () => import('./agents/layouts/AgentsShell.vue'), children: PAGES })
  },
}
