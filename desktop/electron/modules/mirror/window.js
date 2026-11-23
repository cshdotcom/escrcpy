import { createWindowManager } from '@escrcpy/electron-setup/main'
import { stopSession } from './service.js'

/**
 * Embedded mirror window (内嵌镜像): one window per device, resizable, with
 * persisted bounds. The renderer decodes the stream with WebCodecs and draws
 * the keyboard-mapping overlay with Konva.
 */
export default {
  name: 'module:mirror:window',
  apply() {
    createWindowManager('pages/mirror', {
      browserWindow: {
        width: 480,
        height: 900,
        minWidth: 320,
        minHeight: 480,
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        persistenceBounds: true,
        webPreferences: {
          backgroundThrottling: false,
        },
      },
      hooks: {
        closed(_win, context) {
          const deviceId = context?.payload?.device?.id
          if (deviceId)
            stopSession(deviceId).catch(() => {})
        },
      },
    })
  },
}
