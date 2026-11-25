import window from './window.js'
import service from './service.js'

/**
 * Automation script workbench (自动化脚本编辑器): dedicated window with the
 * per-device script list, step editor, run controls and execution log — the
 * free, in-repo counterpart of the paid "automation" page.
 */
export default {
  name: 'module:automation',
  order: 104,
  apply(mainApp) {
    mainApp.use(window)
    mainApp.use(service)
  },
}
