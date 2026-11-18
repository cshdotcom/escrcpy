/**
 * Schedule helpers shared by the scheduler loop and the IPC service.
 */
import { nextRun, nextRuns } from './cron.js'

/** ISO timestamp of the next run for a task, or null when it cannot be computed. */
export function computeNextRunAt(task) {
  if (!task?.cronExpr)
    return null

  const value = nextRun(new Date(), task.cronExpr)
  return value ? value.toISOString() : null
}

/** Upcoming runs (ISO strings) for the cron preview in the editor. */
export function previewCron(expr, count = 5) {
  return nextRuns(new Date(), expr, count).map(date => date.toISOString())
}
