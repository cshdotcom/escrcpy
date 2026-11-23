/**
 * Renderer-facing IPC for the embedded web server: the Copilot config
 * drawer shows the live status (running / port / reachable URLs) so the
 * user can see exactly where to point a phone browser.
 */
import { ipcxMain } from '@escrcpy/electron-ipcx/main'
import { getWebStatus } from './server.js'

export default {
  name: 'module:web:service',
  apply() {
    ipcxMain.handle('web:status', async () => {
      try {
        return { success: true, ...getWebStatus() }
      }
      catch (error) {
        console.warn('[Web] status failed:', error?.message ?? error)
        return { success: false, error: { code: 'WEB_STATUS', message: error?.message ?? String(error) } }
      }
    })

    return () => {
      ipcxMain.removeHandler('web:status')
    }
  },
}
