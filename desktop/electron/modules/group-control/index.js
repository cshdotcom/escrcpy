import window from './window.js'
import service from './service.js'

/**
 * Group control (群控): dedicated window to broadcast input to multiple
 * devices, batch screenshot / APK install, and open multi-device AI
 * conversations — the free, in-repo counterpart of the paid extension.
 */
export default {
  name: 'module:group-control',
  order: 103,
  apply(mainApp) {
    mainApp.use(window)
    mainApp.use(service)
  },
}
