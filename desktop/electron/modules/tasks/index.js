import window from './window.js'
import service from './service.js'
import scheduler from './scheduler.js'

export default {
  name: 'module:tasks',
  order: 101,
  apply(mainApp) {
    mainApp.use(window)
    mainApp.use(service)
    mainApp.use(scheduler)
  },
}
