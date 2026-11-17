import AnalysisStrip from './AnalysisStrip.vue'
import AnalysisPanel from './AnalysisPanel.vue'
import { setApi } from './analysisStore'
import messages from './messages.js'

export default {
  register(ui) {
    setApi(ui.api)
    ui.addI18n(messages)
    // the figures of the model on the toolbar of the editor, and the panel beside it
    ui.addSlot('featureModel.strip', AnalysisStrip, { id: 'analytics:strip' })
    ui.addSlot('featureModel.panels', AnalysisPanel, { id: 'analytics:panel' })
  },
}
