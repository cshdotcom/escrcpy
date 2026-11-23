import server from './server.js'
import service from './service.js'

/**
 * Embedded Web UI ("网页版"): HTTP server + renderer IPC.
 * Rides the same AI provider stack, agent tool set, session store and
 * scheduled-task engine as the desktop app.
 */
export default {
  name: 'module:web',
  order: 102,
  apply(mainApp) {
    mainApp.use(server)
    mainApp.use(service)
  },
}
