/**
 * Background scheduler: scans enabled tasks every 15 seconds and executes
 * the ones whose nextRunAt has arrived.
 *
 * Reliability rules ("定时任务经常触发失败还没有原因" — v3.8.0 rebuild):
 *
 *  1. Concurrency — each due task is launched independently. A long-running
 *     AI agent task can no longer block the tasks scheduled behind it past
 *     their deadline (which used to make them "missed" and silently skipped).
 *
 *  2. No silent skips — every skipped occurrence is written to the run
 *     history with a human-readable reason, so a task that did not fire can
 *     always be explained from the Runs page.
 *
 *  3. Catch-up — a task that became overdue because the computer slept, the
 *     app was closed or another task blocked the loop still fires once as
 *     long as it is less than CATCHUP_WINDOW (24h) late. Only truly stale
 *     occurrences (>24h) are skipped.
 *
 *  4. Atomic claim — nextRunAt is advanced BEFORE the task body runs
 *     (computed from the fired occurrence, so no slot is ever skipped or
 *     double-fired), and a per-task running guard prevents the same task
 *     from overlapping itself.
 *
 *  5. Wake responsiveness — system resume / screen unlock trigger an
 *     immediate tick instead of waiting for the next interval.
 */
import { BrowserWindow, powerMonitor } from 'electron'
import { executeTask } from './helpers/executor.js'
import { addRun, getTasks, patchTask, uid } from './helpers/store.js'
import { computeNextRunAt, nextRunAfter } from './helpers/schedule-helper.js'
import electronStore from '$electron/helpers/store/index.js'

const TICK_INTERVAL_MS = 15_000
const STARTUP_DELAY_MS = 8_000
/** Occurrences older than this are skipped (with a recorded reason). */
const CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000
/** Same-task overlap guard expiry — never expected to hit, safety net only. */
const RUN_GUARD_TTL_MS = 6 * 60 * 60 * 1000

let timer = null
let ticking = false
/** taskId → startedAt, tasks whose body is currently executing. */
const runningTasks = new Map()

/** Reveal the main window if no visible window currently exists. Called when
 * a task fires so the user can see the run history update even if the app
 * was hidden to the tray. */
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

/** Record a skipped occurrence in the run history so it is never a mystery. */
function recordSkippedRun(task, reason, firedAt) {
  addRun({
    id: uid('taskrun'),
    kind: 'task',
    refId: task.id,
    refName: task.name,
    type: task.type,
    status: 'SKIPPED',
    trigger: 'schedule',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    error: reason,
    output: reason,
    scheduledFor: firedAt,
  })
}

/**
 * Launch one due task occurrence. Claims the slot (advances nextRunAt from
 * the fired occurrence) before executing, so a crash mid-run never causes a
 * duplicate fire, and the loop below can immediately move on to other tasks.
 */
function launchDueTask(task, firedAtMs) {
  const firedAt = new Date(firedAtMs).toISOString()

  // 4. Atomic claim: advance nextRunAt from THIS occurrence before running.
  //    Computed from the fired time (not "now") so back-to-back slots are
  //    preserved when execution overruns into the next slot.
  const claimed = nextRunAfter(new Date(firedAtMs), task)
  patchTask(task.id, { nextRunAt: claimed })

  // Per-task overlap guard: if a previous execution of the same task is
  // still running (very long agent run), let the claim above reschedule and
  // record why this occurrence is deferred.
  const runningSince = runningTasks.get(task.id)
  if (runningSince) {
    // Safety: clear guards that are stuck beyond any sane task duration.
    if (Date.now() - runningSince > RUN_GUARD_TTL_MS)
      runningTasks.delete(task.id)
    else
      return 'deferred'
  }

  runningTasks.set(task.id, Date.now())

  // 1. Concurrency: fire-and-forget; failures are captured inside
  //    executeTask's own try/catch and land in the run history.
  void executeTask({ ...task }, 'schedule')
    .catch((error) => {
      // executeTask already records FAILED runs; this is a hard guard for
      // errors thrown before the run entry exists (e.g. addRun failing).
      console.error(`[Tasks] Scheduled execution of "${task.name}" failed:`, error?.message ?? error)
      try {
        recordSkippedRun(task, `Execution failed to start: ${error?.message ?? error}`, firedAt)
      }
      catch {}
    })
    .finally(() => {
      runningTasks.delete(task.id)
    })

  return 'launched'
}

export function tickTasks() {
  if (ticking)
    return Promise.resolve({ executed: 0, skipped: 0, deferred: 0 })

  ticking = true

  return (async () => {
    const now = Date.now()
    const due = getTasks().filter(task => task.enabled !== false && task.nextRunAt && Date.parse(task.nextRunAt) <= now)

    let executed = 0
    let skipped = 0
    let deferred = 0
    let revealed = false

    for (const task of due) {
      try {
        const overdueBy = now - Date.parse(task.nextRunAt)
        const firedAt = Date.parse(task.nextRunAt)

        if (overdueBy > CATCHUP_WINDOW_MS) {
          // 2/3. Truly stale (app closed for a day+): skip, but RECORD it.
          const reason = `Missed occurrence (due ${new Date(firedAt).toLocaleString()}) was skipped: more than 24h overdue.`
          recordSkippedRun(task, reason, new Date(firedAt).toISOString())
          patchTask(task.id, { nextRunAt: computeNextRunAt(task) })
          console.warn(`[Tasks] ${reason}`)
          skipped++
          continue
        }

        // 3. Catch-up: overdue but within the window → fire now with a note.
        if (overdueBy > 60_000)
          console.log(`[Tasks] Catching up "${task.name}" (${Math.round(overdueBy / 60000)}min late)`)

        if (!revealed) {
          revealMainWindowIfNeeded()
          revealed = true
        }

        const state = launchDueTask(task, firedAt)
        if (state === 'launched')
          executed++
        else
          deferred++
      }
      catch (error) {
        console.error(`[Tasks] Failed to dispatch "${task.name}":`, error?.message ?? error)
      }
    }

    return { executed, skipped, deferred }
  })().finally(() => {
    ticking = false
  })
}

let wakeTimer = null

/** Debounced immediate tick on wake/unlock — the interval timer is paused
 * while the OS sleeps, so without this the first tick after resume can come
 * up to TICK_INTERVAL_MS late. */
function tickSoon() {
  if (wakeTimer)
    return
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    tickTasks().catch(error => console.error('[Tasks] Wake tick failed:', error?.message ?? error))
  }, 1500)
  if (typeof wakeTimer.unref === 'function')
    wakeTimer.unref()
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

    // 5. Fire the moment the machine wakes or the user unlocks the screen.
    try {
      powerMonitor.on('resume', tickSoon)
      powerMonitor.on('unlock-screen', tickSoon)
      powerMonitor.on('user-did-become-active', tickSoon)
    }
    catch (error) {
      console.warn('[Tasks] powerMonitor listeners failed:', error?.message ?? error)
    }

    console.log(`[Tasks] Scheduler started (every ${TICK_INTERVAL_MS / 1000}s, catch-up window 24h)`)

    return () => {
      clearInterval(timer)
      timer = null
      if (wakeTimer) {
        clearTimeout(wakeTimer)
        wakeTimer = null
      }
      try {
        powerMonitor.removeListener('resume', tickSoon)
        powerMonitor.removeListener('unlock-screen', tickSoon)
        powerMonitor.removeListener('user-did-become-active', tickSoon)
      }
      catch {}
    }
  },
}
