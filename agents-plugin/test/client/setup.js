import { createRouter, createMemoryHistory } from 'vue-router'
import { i18n } from 'src/boot/i18n'
import messages from '../../client/agents/i18n/index.js'
import { setRouter } from '../../client/agents/router/index.js'

// What the plugin does when it loads (client/index.js), for the tests of its pages: their words join LINEA's, and they have a router.
for (const [locale, tree] of Object.entries(messages)) {
  i18n.global.mergeLocaleMessage(locale, { ...tree, labels: { ...tree.labels, ...i18n.global.getLocaleMessage(locale).labels }, error_messages: { ...tree.error_messages, ...i18n.global.getLocaleMessage(locale).error_messages } })
}
setRouter(createRouter({ history: createMemoryHistory(), routes: [{ path: '/:rest(.*)*', component: { template: '<i/>' } }] }))
