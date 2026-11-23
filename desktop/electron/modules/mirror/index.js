import service from './service.js'
import window from './window.js'

/**
 * Embedded mirror (内嵌镜像): WebCodecs video pipeline + Konva keyboard mapping.
 * The paid version's "内嵌镜像 / 键盘映射" is reproduced here for free.
 */
export default {
  name: 'module:mirror',
  order: 102,
  apply(mainApp) {
    mainApp.use(window)
    mainApp.use(service)
  },
}
