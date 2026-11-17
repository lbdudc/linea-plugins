import LineCodeEditor from './LineCodeEditor.vue'
import { setApi, setSettings } from './api'
import messages from './messages.js'

export default {
  register(ui) {
    setApi(ui.api)
    setSettings(ui.settings)
    ui.addI18n(messages)
    // a tab of the line, for simple SPLs only (`kind` is that of the line; one that has not loaded yet shows nothing)
    ui.addSlot('line.tabs', LineCodeEditor, {
      id: 'spl-code-editor',
      label: { en: 'Code', es: 'Código', gl: 'Código' },
      order: 40,
      when: ({ kind }) => kind === 'plain',
    })
  },
}
