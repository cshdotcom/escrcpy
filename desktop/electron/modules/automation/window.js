import { createWindowManager } from '@escrcpy/electron-setup/main'

export default {
  name: 'module:automation:window',
  apply() {
    createWindowManager('pages/automation', {
      singleton: true,
      browserWindow: {
        width: 1180,
        height: 800,
        minWidth: 900,
        minHeight: 600,
      },
    })
  },
}
