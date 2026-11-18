/**
 * Background scheduler: scans enabled tasks every 20 seconds and executes
 * the ones whose nextRunAt has arrived.
 *
 * Missed-run policy: if a task is overdue by more than 30 minutes (the app
 * was closed at the scheduled time), the occurrence is skipped and the next
 * run is recomputed instead of firing a burst of stale executions.
 *
 * Window reveal: when a task fires and no visible BrowserWindow exists, the
 * main window is restored so the user can see what happened. This, combined
 * with the launchOnBoot setting (registered via tasks:set-launch-on-boot),
 * lets scheduled tasks run even if the user has not opened the app this boot.
 */
import { BrowserWindow } from 'electron'
import { executeTask } from './helpers/executor.js'
import { getTasks, patchTask } from './helpers/store.js'
import { computeNextRunAt } from './helpers/schedule-helper.js'
import electronStore from '$electron/helpers/store/index.js'

const TICK_INTERVAL_MS = 20_000
const STARTUP_DELAY_MS = 8_000
const MISSED_WINDOW_MS = 30 * 60 * 1000

let timer = null
let ticking = false

/** Reveal the main window if no visible window currently exists. Called when
 * a scheduled task fires so the user can see the run history update even if
 * the app was hidden to the tray. */
function revealMainWindowIfNeeded() {
  if (electronStore.get('copilot.settings.revealWindowOnTaskFire') === false)
    return

  try {
    const visible = BrowserWindow.getAllWindows().some(win => win.isVisible() && !win.isDestroyed())
    if (visible)
      return

    const main = BrowserWindow.getAllWindows().find(win => !win.isDestroyed())
    if (main) {
      if (main.isMinimized())
        main.restore()
      if (!main.isVisible())
        main.show()
      main.focus()
    }
  }
  catch (error) {
    console.warn('[Tasks] reveal window failed:', error?.message ?? error)
  }
}

export function tickTasks() {
  if (ticking)
    return Promise.resolve({ executed: 0, skipped: 0 })

  ticking = true

  return (async () => {
    const now = Date.now()
    const due = getTasks().filter(task => task.enabled !== false && task.nextRunAt && Date.parse(task.nextRunAt) <= now)

    let executed = 0
    let skipped = 0

    for (const task of due) {
      try {
        const overdueBy = now - Date.parse(task.nextRunAt)

        if (overdueBy > MISSED_WINDOW_MS) {
          // The app was most likely closed when this occurrence was due:
          // skip it and reschedule.
          skipped++
          patchTask(task.id, { nextRunAt: computeNextRunAt(task) })
          console.log(`[Tasks] Skipped missed occurrence of "${task.name}"`)
          continue
        }

        if (executed === 0)
          revealMainWindowIfNeeded()

        await executeTask(task, 'schedule')
        executed++
      }
      catch (error) {
        console.error(`[Tasks] Scheduled execution of "${task.name}" failed:`, error?.message ?? error)
      }
    }

    return { executed, skipped }
  })().finally(() => {
    ticking = false
  })
}

export default {
  name: 'module:tasks:scheduler',
  apply() {
    if (timer)
      return () => {}

    setTimeout(() => {
      tickTasks().catch(error => console.error('[Tasks] Startup tick failed:', error?.message ?? error))
    }, STARTUP_DELAY_MS)

    timer = setInterval(() => {
      tickTasks().catch(error => console.error('[Tasks] Tick failed:', error?.message ?? error))
    }, TICK_INTERVAL_MS)

    console.log(`[Tasks] Scheduler started (every ${TICK_INTERVAL_MS / 1000}s)`)

    return () => {
      clearInterval(timer)
      timer = null
    }
  },
}
