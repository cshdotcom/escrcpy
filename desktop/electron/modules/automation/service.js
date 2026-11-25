/**
 * Automation script workbench (自动化脚本编辑器) — main-process service.
 *
 * Per-device script CRUD persisted in the shared electron-store, plus an
 * execution engine with run / pause / resume / stop and a step-level log
 * streamed to subscribed renderer windows over `automation:event`.
 *
 * Every device action rides the tasks runAction engine, so the whole action
 * set (tap/swipe/input_text/key/shell/open_app/screenshot/http/notify/
 * match_image/wait_image + imageMatch preconditions) works here as well.
 * Steps of type `wait` are engine-native (plain sleep). Common per-step
 * fields — delayBefore / loopCount / randomRange — are honoured here so the
 * official "step common fields" behaviour is observable in the log.
 */
import fs from 'node:fs'
import { dialog } from 'electron'
import { ipcxMain } from '@escrcpy/electron-ipcx/main'
import electronStore from '$electron/helpers/store/index.js'
import { runAction, getAdbx, listOnlineDevices } from '../tasks/helpers/executor.js'
import { uid } from '../tasks/helpers/store.js'
import { matchOnDevice } from '../tasks/helpers/image-match.js'

const KEY_SCRIPTS = 'automation.scripts'
const MAX_LOGS = 500
const EXPORT_FORMAT = 'escrcpy-automation-script'
const EXPORT_VERSION = 1

/** Step types the engine can execute (engine-native + runAction actions). */
export const STEP_TYPES = [
  'wait', // engine-native sleep
  'tap', 'swipe', 'input_text', 'key', 'shell', 'open_app', 'screenshot',
  'match_image', 'wait_image', 'http', 'notify',
]

const CHANNELS = [
  'automation:subscribe',
  'automation:devices',
  'automation:scripts:list',
  'automation:script:save',
  'automation:script:delete',
  'automation:script:run',
  'automation:script:pause',
  'automation:script:resume',
  'automation:script:stop',
  'automation:script:status',
  'automation:script:logs',
  'automation:export',
  'automation:import',
  'automation:pick-template',
]

function ok(data = {}) {
  return { success: true, ...data }
}

function fail(error, code = 'AUTOMATION_ERROR') {
  const message = error?.message ?? String(error ?? 'Unknown error')
  console.warn(`[Automation] ${code}: ${message}`)
  return { success: false, error: { code, message } }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Store ────────────────────────────────────────────────

function getScripts() {
  const value = electronStore.get(KEY_SCRIPTS)
  return Array.isArray(value) ? value : []
}

function saveScripts(scripts) {
  electronStore.set(KEY_SCRIPTS, scripts)
}

function toPositiveInt(value, fallback = 1) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Normalize one step: keeps unknown extras, enforces common field shapes. */
function normalizeStep(step) {
  const type = String(step?.type || 'tap')
  if (!STEP_TYPES.includes(type))
    throw new Error(`Unknown step type: ${type}`)

  return {
    ...step,
    id: String(step?.id || uid('step')),
    name: String(step?.name || '').trim(),
    type,
    delayBefore: toNonNegativeNumber(step?.delayBefore, 0),
    loopCount: toPositiveInt(step?.loopCount, 1),
    randomRange: toNonNegativeNumber(step?.randomRange, 0),
    target: step?.target && typeof step.target === 'object'
      ? { by: String(step.target.by || ''), value: String(step.target.value || '') }
      : undefined,
    imageMatch: step?.imageMatch?.enabled && step?.imageMatch?.templatePath
      ? {
          enabled: true,
          templatePath: String(step.imageMatch.templatePath),
          threshold: toNonNegativeNumber(step.imageMatch.threshold, 0.8),
          followMatchPoint: step.imageMatch.followMatchPoint === true,
          optional: step.imageMatch.optional === true,
        }
      : undefined,
  }
}

function normalizeScript(script) {
  if (!String(script?.deviceId || '').trim())
    throw new Error('Script requires a deviceId')
  const steps = Array.isArray(script?.steps) ? script.steps.map(normalizeStep) : []
  const variables = Array.isArray(script?.variables)
    ? script.variables.filter(v => v && String(v.name || '').trim())
    : []
  const now = new Date().toISOString()
  const existing = getScripts().find(item => item.id === script.id)
  const id = existing ? script.id : uid('script')

  return {
    ...script,
    id,
    name: String(script?.name || '').trim() || 'Untitled script',
    deviceId: String(script.deviceId),
    steps,
    variables,
    createdAt: script?.createdAt || existing?.createdAt || now,
    updatedAt: now,
  }
}

function upsertScript(script) {
  const normalized = normalizeScript(script)
  const scripts = getScripts()
  const index = scripts.findIndex(item => item.id === normalized.id)
  if (index === -1)
    scripts.unshift(normalized)
  else
    scripts[index] = normalized
  saveScripts(scripts)
  return normalized
}

function deleteScript(id) {
  stopRun(id)
  saveScripts(getScripts().filter(item => item.id !== id))
  return true
}

// ── Execution engine ─────────────────────────────────────

/** scriptId -> live run state (kept after completion for log inspection). */
const runs = new Map()

/** Renderer windows subscribed to `automation:event`. */
const subscribers = new Set()

function broadcast(event) {
  for (const webContents of subscribers) {
    try {
      if (!webContents.isDestroyed?.())
        webContents.send('automation:event', event)
    }
    catch { /* subscriber window went away */ }
  }
}

function getRun(scriptId) {
  return runs.get(String(scriptId))
}

function pushLog(run, level, text) {
  const entry = { at: Date.now(), level, stepIndex: run.currentStepIndex, text: String(text) }
  run.logs.push(entry)
  if (run.logs.length > MAX_LOGS)
    run.logs.splice(0, run.logs.length - MAX_LOGS)
  broadcast({ type: 'log', scriptId: run.scriptId, entry })
  return entry
}

function publishState(run) {
  broadcast({ type: 'state', scriptId: run.scriptId, state: run.state, mode: run.mode, currentStepIndex: run.currentStepIndex, currentIteration: run.currentIteration, stepCount: run.stepCount })
}

/** Blocks while the run is paused; resolves on resume/stop. */
function waitGate(control) {
  if (!control.paused)
    return Promise.resolve()
  if (!control.gate)
    control.gate = new Promise(resolve => (control.resolveGate = resolve))
  return control.gate
}

/** Sleep that honours pause (holds) and stop (returns early). */
async function interruptibleSleep(ms, control) {
  let remaining = Math.max(0, ms)
  while (remaining > 0) {
    await waitGate(control)
    if (control.aborted)
      return
    const chunk = Math.min(100, remaining)
    await sleep(chunk)
    remaining -= chunk
  }
}

/** randomRange semantics (official): per-iteration random offset,
 * coordinates ±n×5px and time ±n×500ms; 0 disables. */
function jitter(range, scale) {
  const n = Number(range) || 0
  if (n <= 0)
    return 0
  return (Math.random() * 2 - 1) * n * scale
}

function stepsForMode(script, mode, stepIds) {
  const steps = Array.isArray(script.steps) ? script.steps : []
  if (mode === 'step') {
    const hit = steps.find(step => step.id === stepIds?.[0])
    return hit ? [hit] : []
  }
  if (mode === 'selected')
    return steps.filter(step => stepIds?.includes(step.id))
  return steps
}

function buildActionPayload(step) {
  const payload = { action: step.type, ...step }
  delete payload.id
  delete payload.name
  delete payload.delayBefore
  delete payload.loopCount
  delete payload.randomRange
  delete payload.target
  delete payload.imageMatch
  delete payload.steps
  delete payload.variables

  const range = Number(step.randomRange) || 0
  if (range > 0) {
    if (step.type === 'tap') {
      payload.x = Math.round((Number(step.x) || 0) + jitter(range, 5))
      payload.y = Math.round((Number(step.y) || 0) + jitter(range, 5))
    }
    else if (step.type === 'swipe') {
      for (const field of ['x1', 'y1', 'x2', 'y2']) {
        if (payload[field] !== undefined)
          payload[field] = Math.round((Number(step[field]) || 0) + jitter(range, 5))
      }
    }
  }
  return payload
}

async function executeStep(script, step, run) {
  const control = run.control
  const label = step.name || step.type
  const iterations = Math.max(1, Math.min(999, Number(step.loopCount) || 1))

  const delayMs = Math.max(0, (Number(step.delayBefore) || 0) + jitter(step.randomRange, 500))
  if (delayMs > 0) {
    pushLog(run, 'info', `[${label}] delay ${Math.round(delayMs)}ms`)
    await interruptibleSleep(delayMs, control)
    if (control.aborted)
      return
  }

  for (let iteration = 1; iteration <= iterations; iteration++) {
    await waitGate(control)
    if (control.aborted)
      return

    run.currentIteration = iteration
    try {
      if (step.type === 'wait') {
        const waitMs = Math.max(0, (Number(step.waitMs) || Number(step.duration) || 0) + jitter(step.randomRange, 500))
        pushLog(run, 'info', `[${label}] wait ${Math.round(waitMs)}ms`)
        await interruptibleSleep(waitMs, control)
        continue
      }

      const payload = buildActionPayload(step)

      // Official "匹配点跟随": resolve the match once here and override the
      // tap coordinates, then drop imageMatch so runAction does not re-match.
      if (step.imageMatch?.enabled && step.imageMatch?.followMatchPoint && step.type === 'tap') {
        const match = await matchOnDevice(getAdbx(), script.deviceId, step.imageMatch.templatePath, {
          threshold: Number(step.imageMatch.threshold) || 0.8,
        })
        if (!match.matched) {
          if (step.imageMatch.optional === true) {
            pushLog(run, 'info', `[${label}] image not matched — step skipped`)
            return
          }
          throw new Error(`image match failed (score ${match.score})`)
        }
        const cx = Math.round(match.x + (match.width || 0) / 2)
        const cy = Math.round(match.y + (match.height || 0) / 2)
        payload.x = cx
        payload.y = cy
        pushLog(run, 'info', `[${label}] match point follows (${cx}, ${cy})`)
      }

      const result = await runAction({ ...payload, deviceId: script.deviceId })
      const suffix = iterations > 1 ? ` [${iteration}/${iterations}]` : ''
      pushLog(run, 'ok', `[${label}]${suffix} ${String(result.output ?? '').slice(0, 300)}`)
    }
    catch (error) {
      throw new Error(`step "${label}" failed: ${error?.message ?? error}`)
    }
  }
}

async function executeScript(script, run) {
  const control = run.control
  try {
    for (let index = 0; index < run.steps.length; index++) {
      await waitGate(control)
      if (control.aborted)
        break

      run.currentStepIndex = index
      publishState(run)
      await executeStep(script, run.steps[index], run)
    }

    if (control.aborted) {
      run.state = 'stopped'
      pushLog(run, 'info', 'run stopped')
    }
    else {
      run.state = 'idle'
      pushLog(run, 'ok', 'run done')
    }
  }
  catch (error) {
    run.state = 'stopped'
    run.lastError = error?.message ?? String(error)
    pushLog(run, 'error', `run failed: ${run.lastError}`)
  }
  finally {
    run.finishedAt = Date.now()
    run.currentStepIndex = -1
    run.currentIteration = 0
    publishState(run)
  }
}

function startRun(script, { mode = 'all', stepIds = [] } = {}) {
  const previous = getRun(script.id)
  if (previous && (previous.state === 'running' || previous.state === 'paused'))
    throw new Error('Script is already running')

  const steps = stepsForMode(script, mode, stepIds)
  if (!steps.length)
    throw new Error('Script has no matching steps')

  const run = {
    scriptId: script.id,
    state: 'running',
    mode,
    stepIds: steps.map(step => step.id),
    steps,
    stepCount: steps.length,
    currentStepIndex: -1,
    currentIteration: 0,
    startedAt: Date.now(),
    finishedAt: 0,
    lastError: '',
    logs: [],
    control: { aborted: false, paused: false, gate: null, resolveGate: null },
  }
  runs.set(script.id, run)
  pushLog(run, 'info', `run started (${mode}, ${steps.length} step${steps.length > 1 ? 's' : ''})`)
  publishState(run)

  executeScript(script, run)
  return run
}

function stopRun(scriptId) {
  const run = getRun(scriptId)
  if (!run || (run.state !== 'running' && run.state !== 'paused'))
    return false
  run.control.aborted = true
  run.control.paused = false
  run.control.resolveGate?.()
  return true
}

function snapshot(run) {
  if (!run)
    return { state: 'idle', logCount: 0 }
  const { scriptId, state, mode, stepCount, currentStepIndex, currentIteration, startedAt, finishedAt, lastError } = run
  return { scriptId, state, mode, stepCount, currentStepIndex, currentIteration, startedAt, finishedAt, lastError, logCount: run.logs.length }
}

// ── IPC wiring ───────────────────────────────────────────

export default {
  name: 'module:automation:service',
  apply() {
    // Renderer windows subscribe to live log/state events.
    ipcxMain.handle('automation:subscribe', (event) => {
      const webContents = event?.sender
      if (!webContents)
        return ok()
      subscribers.add(webContents)
      webContents.once?.('destroyed', () => subscribers.delete(webContents))
      return ok()
    })

    ipcxMain.handle('automation:devices', async () => {
      try {
        const devices = await listOnlineDevices()
        return ok({ devices: devices.map(device => ({ id: device.id, status: device.type })) })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_DEVICES')
      }
    })

    ipcxMain.handle('automation:scripts:list', async (_event, payload) => {
      try {
        const deviceId = String(payload?.deviceId || '').trim()
        const scripts = deviceId
          ? getScripts().filter(script => script.deviceId === deviceId)
          : getScripts()
        return ok({ scripts })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_LIST')
      }
    })

    ipcxMain.handle('automation:script:save', async (_event, payload) => {
      try {
        const script = upsertScript(payload?.script || {})
        return ok({ script })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_SAVE')
      }
    })

    ipcxMain.handle('automation:script:delete', async (_event, payload) => {
      try {
        deleteScript(String(payload?.id || ''))
        return ok({})
      }
      catch (error) {
        return fail(error, 'AUTOMATION_DELETE')
      }
    })

    ipcxMain.handle('automation:script:run', async (_event, payload) => {
      try {
        const script = getScripts().find(item => item.id === String(payload?.scriptId || ''))
        if (!script)
          throw new Error('Script not found')
        if (!script.deviceId)
          throw new Error('No device selected for this script')
        const run = startRun(script, {
          mode: ['all', 'selected', 'step'].includes(payload?.mode) ? payload.mode : 'all',
          stepIds: Array.isArray(payload?.stepIds) ? payload.stepIds.map(String) : [],
        })
        return ok({ run: snapshot(run) })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_RUN')
      }
    })

    ipcxMain.handle('automation:script:pause', async (_event, payload) => {
      try {
        const run = getRun(String(payload?.scriptId || ''))
        if (!run || run.state !== 'running')
          throw new Error('Script is not running')
        run.control.paused = true
        run.state = 'paused'
        pushLog(run, 'info', 'run paused')
        publishState(run)
        return ok({ run: snapshot(run) })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_PAUSE')
      }
    })

    ipcxMain.handle('automation:script:resume', async (_event, payload) => {
      try {
        const run = getRun(String(payload?.scriptId || ''))
        if (!run || run.state !== 'paused')
          throw new Error('Script is not paused')
        run.control.paused = false
        run.control.resolveGate?.()
        run.control.gate = null
        run.control.resolveGate = null
        run.state = 'running'
        pushLog(run, 'info', 'run resumed')
        publishState(run)
        return ok({ run: snapshot(run) })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_RESUME')
      }
    })

    ipcxMain.handle('automation:script:stop', async (_event, payload) => {
      try {
        stopRun(String(payload?.scriptId || ''))
        return ok({})
      }
      catch (error) {
        return fail(error, 'AUTOMATION_STOP')
      }
    })

    ipcxMain.handle('automation:script:status', async (_event, payload) => {
      try {
        const run = getRun(String(payload?.scriptId || ''))
        return ok({ run: snapshot(run) })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_STATUS')
      }
    })

    ipcxMain.handle('automation:script:logs', async (_event, payload) => {
      try {
        const run = getRun(String(payload?.scriptId || ''))
        const since = Math.max(0, Math.floor(Number(payload?.since) || 0))
        const logs = run ? run.logs.slice(since) : []
        return ok({ logs, total: run ? run.logs.length : 0 })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_LOGS')
      }
    })

    ipcxMain.handle('automation:export', async (_event, payload) => {
      try {
        const script = getScripts().find(item => item.id === String(payload?.scriptId || ''))
        if (!script)
          throw new Error('Script not found')
        // An explicit filePath skips the dialog (programmatic export, e2e).
        let filePath = String(payload?.filePath || '')
        if (!filePath) {
          const result = await dialog.showSaveDialog({
            title: 'Export automation script',
            defaultPath: `${script.name.replace(/[\\/:*?"<>|]/g, '_')}.json`,
            filters: [{ name: 'Automation Script', extensions: ['json'] }],
          })
          if (result.canceled || !result.filePath)
            return ok({ filePath: '' })
          filePath = result.filePath
        }
        const content = JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, script }, null, 2)
        fs.writeFileSync(filePath, content, 'utf8')
        return ok({ filePath })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_EXPORT')
      }
    })

    ipcxMain.handle('automation:import', async (_event, payload) => {
      try {
        // An explicit filePath skips the dialog (programmatic import, e2e).
        let filePath = String(payload?.filePath || '')
        if (!filePath) {
          const result = await dialog.showOpenDialog({
            title: 'Import automation script',
            properties: ['openFile'],
            filters: [{ name: 'Automation Script', extensions: ['json'] }],
          })
          if (result.canceled || !result.filePaths?.length)
            return ok({ script: null })
          filePath = result.filePaths[0]
        }
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        const script = raw?.format === EXPORT_FORMAT ? raw.script : raw
        if (!script || !Array.isArray(script.steps))
          throw new Error('Not an automation script file')
        // Imported scripts get a fresh id on save; steps stay untouched so the
        // renderer can replace the current script's steps or create a new one.
        return ok({ script: { ...script, id: '' } })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_IMPORT')
      }
    })

    ipcxMain.handle('automation:pick-template', async () => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Select match template',
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }],
        })
        return ok({ filePath: result.canceled ? '' : result.filePaths[0] })
      }
      catch (error) {
        return fail(error, 'AUTOMATION_PICK_TEMPLATE')
      }
    })

    return () => {
      for (const channel of CHANNELS)
        ipcxMain.removeHandler(channel)
      subscribers.clear()
    }
  },
}
