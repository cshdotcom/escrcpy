import { createWindowManager } from '@escrcpy/electron-setup/main'

export default {
  name: 'module:group-control:window',
  apply() {
    createWindowManager('pages/group-control', {
      singleton: true,
      browserWindow: {
        width: 980,
        height: 680,
        minWidth: 760,
        minHeight: 520,
      },
    })
  },
}
