/**
 * Background scheduler: scans enabled tasks every 20 seconds and executes
 * the ones whose nextRunAt has arrived.
 *
 * Missed-run policy: if a task is overdue by more than 30 minutes (the app
 * was closed at the scheduled time), the occurrence is skipped and the next
 * run is recomputed instead of firing a burst of stale executions.
 */
import { executeTask } from './helpers/executor.js'
import { getTasks, patchTask } from './helpers/store.js'
import { computeNextRunAt } from './helpers/schedule-helper.js'

const TICK_INTERVAL_MS = 20_000
const STARTUP_DELAY_MS = 8_000
const MISSED_WINDOW_MS = 30 * 60 * 1000

let timer = null
let ticking = false

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
