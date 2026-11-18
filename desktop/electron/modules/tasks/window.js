import { createWindowManager } from '@escrcpy/electron-setup/main'

export default {
  name: 'module:tasks:window',
  apply() {
    createWindowManager('pages/tasks', {
      singleton: true,
      browserWindow: {
        width: 1080,
        height: 760,
        minWidth: 860,
        minHeight: 600,
      },
    })
  },
}
