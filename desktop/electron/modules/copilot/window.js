import { createWindowManager } from '@escrcpy/electron-setup/main'

export default {
  name: 'module:copilot:window',
  apply() {
    createWindowManager('pages/copilot', {
      singleton: false,
      browserWindow: {
        width: 980,
        height: 720,
        minWidth: 780,
        minHeight: 560,
      },
    })
  },
}
