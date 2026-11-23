/**
 * Task and workflow execution engine (main process).
 *
 * Task types:
 *  - AI: scheduled prompts executed through the Copilot provider stack.
 *        Optional agent mode gives the model the full Copilot tool set so it
 *        can operate the device autonomously (tap/swipe/shell/…, unlimited
 *        steps by default). Optional session mode "continue" reuses one
 *        persistent conversation across runs so the AI keeps its memory.
 *  - AUTOMATION: device operations, HTTP requests and desktop notifications
 *  - WORKFLOW: multi-step chains mixing AI steps, actions and delays
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, Notification } from 'electron'
import dayjs from 'dayjs'
import { Adb } from '@devicefarmer/adbkit'
import { createAdbx } from '@escrcpy/adbx'
import {
  AI_KEY_EVENTS,
  buildAiToolSchemas,
  buildApiMessages,
  compactSessionContext,
  estimateTokens,
  isDangerousShell,
  sanitizeSessionMessages,
} from '@escrcpy/shared'
import { yadbPath } from '$electron/configs/index.js'
import { setupEnvPath } from '$electron/process/helper.js'
import electronStore from '$electron/helpers/store/index.js'
import { chatWithProvider } from '../../copilot/helpers/providers.js'

import { addRun, findTask, findWorkflow, patchTask, uid, updateRun } from './store.js'
import { computeNextRunAt } from './schedule-helper.js'
import { matchOnDevice } from './image-match.js'

export { isDangerousShell }

// ── ADB (main-process instance) ──────────────────────────
let adbxInstance = null
let adbxFailed = false

export function getAdbx() {
  if (adbxInstance)
    return adbxInstance

  if (adbxFailed)
    throw new Error('ADB is not available in this environment')

  try {
    setupEnvPath()
    const client = Adb.createClient()
    adbxInstance = createAdbx({ adb: client, yadbPath })
    return adbxInstance
  }
  catch (error) {
    adbxFailed = true
    throw new Error(`Failed to initialize ADB: ${error?.message ?? error}`)
  }
}

async function getOnlineDevices() {
  const devices = await getAdbx().getDevices()
  return devices.filter(device => device.type === 'device')
}

export async function listOnlineDevices() {
  return getOnlineDevices()
}

async function ensureDevice(deviceId) {
  if (!deviceId)
    throw new Error('No device selected for this task')

  const devices = await getOnlineDevices()
  const hit = devices.find(device => device.id === deviceId)

  if (!hit)
    throw new Error(`Device "${deviceId}" is not connected`)

  return hit
}

function truncate(text, max = 20_000) {
  const value = String(text ?? '')
  if (value.length <= max)
    return value
  return `${value.slice(0, max)}\n... (${value.length - max} more characters truncated)`
}

// ── Automation actions ───────────────────────────────────
/**
 * Smart-recognition precondition (官方“智能识别”的等价实现): when a step
 * carries `imageMatch`, the target screen is matched against a template
 * first. `followMatchPoint` re-targets tap coordinates to the matched
 * location; an unmatched screen fails (or skips) the step.
 */
async function applyImageMatch(config) {
  const match = config.imageMatch
  if (!match?.enabled || !match.templatePath)
    return

  const adbx = getAdbx()
  const result = await matchOnDevice(adbx, config.deviceId, match.templatePath, {
    threshold: Number(match.threshold) || 0.8,
  })

  if (!result.matched) {
    if (match.optional === true)
      return 'skip'
    throw new Error(`Image match failed: best score ${result.score} < threshold ${match.threshold ?? 0.8}`)
  }

  if (match.followMatchPoint) {
    config.x = result.x + Math.floor(result.width / 2)
    config.y = result.y + Math.floor(result.height / 2)
  }

  return { score: result.score, x: result.x, y: result.y }
}

/** Run one action across one or many devices (群控执行): when `deviceIds`
 * is set the action runs on every listed device and outputs are joined. */
export async function runAction(action, context = {}) {
  const config = { ...(action || {}) }
  const kind = config.action || config.kind

  // Multi-device broadcast: same action on every device.
  const targets = Array.isArray(config.deviceIds) && config.deviceIds.length
    ? config.deviceIds
    : null
  if (targets) {
    const outputs = []
    for (const deviceId of targets) {
      const single = await runAction({ ...config, deviceId, deviceIds: undefined })
      outputs.push(`[${deviceId}] ${single.output}`)
    }
    return { output: outputs.join('\n'), broadcast: true }
  }

  // Smart recognition precondition on any single-device action.
  const matchInfo = await applyImageMatch(config)
  if (matchInfo === 'skip')
    return { output: `image match not found (optional) — step skipped` }

  switch (kind) {
    case 'shell': {
      await ensureDevice(config.deviceId)
      const command = String(config.command || '').trim()
      if (!command)
        throw new Error('Shell command is empty')
      if (isDangerousShell(command))
        throw new Error('Blocked: this command is considered dangerous')
      const output = await getAdbx().shell(config.deviceId, command, { stderr: false })
      return { output: truncate(output, 8000) || '(no output)' }
    }

    case 'tap': {
      await ensureDevice(config.deviceId)
      await getAdbx().input.tap(config.deviceId, Math.round(config.x || 0), Math.round(config.y || 0))
      return { output: `tap (${Math.round(config.x || 0)}, ${Math.round(config.y || 0)})` }
    }

    case 'swipe': {
      await ensureDevice(config.deviceId)
      const duration = Math.max(0, Math.min(10_000, config.duration || 300))
      await getAdbx().input.swipe(config.deviceId, Math.round(config.x1 || 0), Math.round(config.y1 || 0), Math.round(config.x2 || 0), Math.round(config.y2 || 0), duration)
      return { output: `swipe (${config.x1}, ${config.y1}) -> (${config.x2}, ${config.y2}) ${duration}ms` }
    }

    case 'key': {
      await ensureDevice(config.deviceId)
      const keyCode = Number(config.keyCode) || Number(config.key) || 0
      if (!keyCode)
        throw new Error('Key code is empty')
      await getAdbx().input.key(config.deviceId, keyCode)
      return { output: `keyevent ${keyCode}` }
    }

    case 'input_text': {
      await ensureDevice(config.deviceId)
      const text = String(config.text ?? '')
      if (!text)
        throw new Error('Text is empty')
      await getAdbx().input.text(config.deviceId, text)
      return { output: `input text: ${truncate(text, 500)}` }
    }

    case 'open_app': {
      await ensureDevice(config.deviceId)
      const pkg = String(config.package || '').trim()
      if (!pkg)
        throw new Error('Package name is empty')
      await getAdbx().shell(config.deviceId, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`)
      return { output: `launch app: ${pkg}` }
    }

    case 'screenshot': {
      await ensureDevice(config.deviceId)
      const dir = config.saveDir || app.getPath('pictures') || app.getPath('userData')
      fs.mkdirSync(dir, { recursive: true })
      const fileName = `Escrcpy-Task-${dayjs().format('YYYY-MM-DD-HH-mm-ss')}.png`
      const savePath = path.join(dir, fileName)
      await getAdbx().screenshot.captureToFile(config.deviceId, savePath)
      return { output: `screenshot saved: ${savePath}` }
    }

    case 'http': {
      const url = String(config.url || '').trim()
      if (!/^https?:\/\//i.test(url))
        throw new Error(`Invalid URL: ${url}`)

      let headers = { 'Content-Type': 'application/json' }
      if (config.headers?.trim()) {
        try {
          headers = { ...headers, ...JSON.parse(config.headers) }
        }
        catch {
          throw new Error('Headers must be valid JSON')
        }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('timeout')), 30_000)

      try {
        const response = await fetch(url, {
          method: config.method || 'GET',
          headers,
          body: ['GET', 'DELETE'].includes(config.method) ? undefined : config.body || undefined,
          signal: controller.signal,
        })
        const text = await response.text().catch(() => '')
        return { output: `HTTP ${response.status} ${response.statusText}\n${truncate(text, 4000) || '(no body)'}` }
      }
      finally {
        clearTimeout(timer)
      }
    }

    case 'notify': {
      showNotification(String(config.title || 'Escrcpy'), String(config.content || ''))
      return { output: `notification: ${config.title || ''}` }
    }

    case 'wait_image': {
      await ensureDevice(config.deviceId)
      const templatePath = String(config.templatePath || '').trim()
      if (!templatePath)
        throw new Error('wait_image requires a template image')

      const threshold = Number(config.threshold) || 0.8
      const timeoutMs = Math.max(1000, Math.min(600_000, Number(config.timeoutMs) || 60_000))
      const intervalMs = Math.max(500, Math.min(10_000, Number(config.intervalMs) || 2000))
      const adbx = getAdbx()
      const startedAt = Date.now()

      let last = null
      while (Date.now() - startedAt < timeoutMs) {
        last = await matchOnDevice(adbx, config.deviceId, templatePath, { threshold })
        if (last.matched)
          return {
            output: `image appeared after ${Date.now() - startedAt}ms (score ${last.score} @ ${last.x},${last.y})`,
            match: last,
          }
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
      throw new Error(`wait_image timed out after ${timeoutMs}ms (best score ${last?.score ?? '?'})`)
    }

    case 'match_image': {
      await ensureDevice(config.deviceId)
      const templatePath = String(config.templatePath || '').trim()
      if (!templatePath)
        throw new Error('match_image requires a template image')

      const result = await matchOnDevice(getAdbx(), config.deviceId, templatePath, {
        threshold: Number(config.threshold) || 0.8,
      })
      if (!result.matched && config.required !== false)
        throw new Error(`Image not found: score ${result.score} < ${(config.threshold ?? 0.8)}`)
      return {
        output: `match ${result.matched ? 'FOUND' : 'NOT FOUND'} (score ${result.score} @ ${result.x},${result.y} ${result.width}x${result.height})`,
        match: result,
      }
    }

    default:
      throw new Error(`Unknown action: ${kind}`)
  }
}

// ── AI execution ─────────────────────────────────────────
/**
 * Resolve the AI provider config for a task: prefer the live Copilot vendor
 * (so API key/model updates propagate), fall back to the snapshot saved
 * with the task.
 */
export function resolveVendorConfig(config = {}) {
  const vendors = electronStore.get('copilot.settings.vendors') || {}
  const live = vendors[config.vendorId]

  if (live?.baseUrl && live?.model && live?.apiKey) {
    return {
      apiType: live.apiType,
      baseUrl: live.baseUrl,
      apiKey: live.apiKey,
      model: live.model,
      temperature: live.temperature,
      maxOutputTokens: live.maxOutputTokens,
      streaming: false,
      vision: live.vision === true,
    }
  }

  const snapshot = config.vendorSnapshot
  if (snapshot?.baseUrl && snapshot?.model && snapshot?.apiKey) {
    return { ...snapshot, streaming: false }
  }

  return null
}

/** Shared Copilot settings (auto context capture, steps, retries, compaction). */
function getCopilotSettings() {
  return electronStore.get('copilot.settings') || {}
}

// ── persistent task conversations (sessionMode) ──────────
const SESSIONS_KEY = 'copilot.sessions'

// Stable id of the one conversation shared by every task using sessionMode
// "shared" ("所有自动任务共用一个上下文").
const SHARED_SESSION_ID = 'session_shared_tasks'

function getSessions() {
  const value = electronStore.get(SESSIONS_KEY)
  return Array.isArray(value) ? value : []
}

/**
 * Session picker payload for the task editor and the web UI: every existing
 * conversation (any scope) with enough metadata to choose one, minus the
 * (potentially huge) message arrays.
 */
export function listSessionsForPicker() {
  return getSessions()
    .filter(session => session?.id)
    .map(session => ({
      id: session.id,
      name: session.name || '',
      scope: session.scope || '',
      taskId: session.taskId || '',
      deviceId: session.deviceId || '',
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      updatedAt: session.updatedAt || '',
      createdAt: session.createdAt || '',
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

/**
 * Create a blank conversation object. Scope keeps conversations grouped in
 * the Copilot sidebar; device-scoped ones show up in the window opened for
 * that device, task-scoped ones stay private to their task, shared/web ones
 * group under their own bucket.
 */
function createSession({ scope, name, deviceId, taskId }) {
  return {
    id: uid('session'),
    taskId: taskId || '',
    scope: scope || 'default',
    name: name || '',
    deviceId: deviceId || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  }
}

/**
 * Resolve which conversation a task run should use, by sessionMode:
 *  - 'new'      every run starts a fresh throwaway context (nothing persisted)
 *  - 'continue' the task's own persistent conversation (created on first run)
 *  - 'existing' a user-selected conversation (config.sessionId), so a task can
 *               continue a conversation started in the Copilot or web UI
 *  - 'shared'   ONE global conversation shared by every task in 'shared' mode,
 *               so all scheduled tasks reason inside the same context
 *
 * Returns { sessions, session, persisted } — `persisted` tells the caller
 * whether the conversation must be saved back to the store afterwards.
 */
export function resolveTaskSession(task, config = {}) {
  const mode = config.sessionMode || 'new'
  const sessions = getSessions()

  // Fresh context each run: an unsaved scratch conversation.
  if (mode === 'new')
    return { sessions, session: { messages: [] }, persisted: false }

  // One shared global conversation across all 'shared' tasks.
  if (mode === 'shared') {
    let session = sessions.find(item => item.id === SHARED_SESSION_ID)
    if (!session) {
      session = createSession({
        scope: 'shared:tasks',
        name: 'Shared task context',
        deviceId: config.deviceId || '',
      })
      session.id = SHARED_SESSION_ID
      sessions.unshift(session)
    }
    return { sessions, session, persisted: true }
  }

  // A user-picked existing conversation — falls back to the task's own when
  // the selected conversation was deleted.
  if (mode === 'existing') {
    const picked = sessions.find(item => item.id === config.sessionId)
    if (picked)
      return { sessions, session: picked, persisted: true }
  }

  // 'continue' (and the fallback for a deleted 'existing' pick): the task's
  // own persistent conversation, scoped to its device so a Copilot window
  // opened for that device displays it.
  let session = sessions.find(item => item?.taskId === task.id && item.id !== SHARED_SESSION_ID)
  if (!session) {
    session = createSession({
      taskId: task.id,
      scope: config.deviceId || `task:${task.id}`,
      name: task.name || 'Scheduled task',
      deviceId: config.deviceId || '',
    })
    sessions.unshift(session)
  }

  return { sessions, session, persisted: true }
}

function saveSessions(sessions, session) {
  session.updatedAt = new Date().toISOString()

  const list = sessions.map(item => (item.id === session.id ? session : item))
  electronStore.set(SESSIONS_KEY, list)
}

/** Save one conversation back to the store (upsert by id). */
export function persistSession(session) {
  if (!session?.id)
    return
  saveSessions(getSessions(), session)
}

async function collectAiText(config, messages, onEvent, signal) {
  let text = ''

  await chatWithProvider({
    config,
    messages,
    tools: [],
    signal,
    onEvent: (event) => {
      if (event.type === 'text-delta') {
        text += event.text
        onEvent?.({ type: 'text-delta', text: event.text })
      }
    },
  })

  // Don't throw on empty response — surface a visible placeholder instead so
  // the run history shows something useful and the task is not marked failed.
  if (!text.trim())
    text = '(The model returned an empty response. Check the vendor configuration and try again.)'

  return text
}

/**
 * Retry wrapper for AI calls. Transient failures (network, rate-limit, server
 * errors) are retried with exponential backoff so scheduled tasks run to
 * completion instead of stopping at the first hiccup.
 */
async function callAiWithRetry(config, messages, options = {}) {
  const maxRetries = Number(options.maxRetries) || 0
  const retryable = options.retryable !== false

  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await collectAiText(config, messages, options.onEvent, options.signal)
    }
    catch (error) {
      lastError = error
      if (!retryable || attempt === maxRetries)
        break

      // Don't retry on auth/config errors — they won't fix themselves —
      // and never retry a user abort.
      const code = error?.code || ''
      if (['INVALID_API_KEY', 'INVALID_MODEL', 'CONFIG_INCOMPLETE', 'ABORTED'].includes(code))
        break

      const backoff = Math.min(1000 * 2 ** attempt, 8000)
      console.warn(`[Tasks] AI call attempt ${attempt + 1} failed: ${error?.message ?? error}. Retrying in ${backoff}ms`)
      await new Promise(resolve => setTimeout(resolve, backoff))
    }
  }

  throw lastError
}

/** Extra device context blocks for the AI prompt. */
async function buildDeviceContext(config) {
  if (!config.deviceId || (!config.includeDeviceInfo && !config.includeScreenshot))
    return { note: null, image: null }

  const parts = []

  try {
    await ensureDevice(config.deviceId)
  }
  catch (error) {
    return { note: `(Device context unavailable: ${error?.message ?? error})`, image: null }
  }

  const adbx = getAdbx()

  try {
    if (config.includeDeviceInfo) {
      const [model, brand, version, battery, size] = await Promise.all([
        adbx.deviceInfo.getProperty(config.deviceId, 'ro.product.model').catch(() => null),
        adbx.deviceInfo.getProperty(config.deviceId, 'ro.product.brand').catch(() => null),
        adbx.deviceInfo.getProperty(config.deviceId, 'ro.build.version.release').catch(() => null),
        adbx.deviceInfo.getBatteryLevel(config.deviceId).catch(() => null),
        adbx.deviceInfo.getScreenSize(config.deviceId).catch(() => null),
      ])

      parts.push(
        `Current device: ${brand || ''} ${model || ''} (Android ${version || '?'}, battery ${battery ?? '?'}%, screen ${size?.width ?? '?'}x${size?.height ?? '?'})`,
      )
    }
  }
  catch (error) {
    parts.push(`(Device info unavailable: ${error?.message ?? error})`)
  }

  let image = null

  if (config.includeScreenshot) {
    try {
      const base64 = await adbx.screenshot.captureBase64(config.deviceId)
      image = `data:image/png;base64,${base64}`
    }
    catch (error) {
      parts.push(`(Screenshot unavailable: ${error?.message ?? error})`)
    }
  }

  return { note: parts.join('\n'), image }
}

// ── agent tool execution (mirrors the Copilot renderer loop) ──
/**
 * Execute one agent tool call against the device. Mirrors the renderer's
 * use-copilot executeTool, including the auto screenshot + UI dump capture
 * after mutating actions so the model can verify the result.
 */
async function executeAgentTool(name, args, context, settings) {
  const adbx = getAdbx()
  // Multi-device: the model may target a specific device per call; broadcast
  // tools fan out to every device in the conversation.
  const deviceId = args?.deviceId || context.deviceId
  const deviceIds = Array.isArray(context.deviceIds) && context.deviceIds.length
    ? context.deviceIds
    : (deviceId ? [deviceId] : [])

  if (!deviceId && name !== 'list_devices' && !name.startsWith('broadcast_'))
    throw new Error('No device selected for this task')

  const runOnAll = async (fn) => {
    const results = {}
    for (const id of deviceIds)
      results[id] = await fn(id).catch(error => ({ error: error?.message ?? String(error) }))
    return JSON.stringify(results)
  }

  const capturePostActionContext = async () => {
    const tasks = []

    if (settings.autoScreenshotAfterAction !== false) {
      tasks.push(
        adbx.screenshot.captureBase64(deviceId)
          .then(base64 => (context.lastScreenshot = `data:image/png;base64,${base64}`))
          .catch(error => console.warn('[Tasks] auto screenshot failed:', error?.message ?? error)),
      )
    }

    if (settings.autoUiDumpAfterAction !== false) {
      tasks.push(
        Promise.resolve(adbx.ui.dumpLayout(deviceId))
          .then(xml => (context.lastUiLayout = truncate(xml, 12000)))
          .catch(error => console.warn('[Tasks] auto ui-dump failed:', error?.message ?? error)),
      )
    }

    if (tasks.length)
      await Promise.all(tasks)
  }

  switch (name) {
    case 'list_devices': {
      const devices = await adbx.getDevices()
      return JSON.stringify(devices.map(device => ({ id: device.id, status: device.type })))
    }

    case 'get_device_info': {
      const [screen, battery, model, brand, version, focus] = await Promise.all([
        adbx.deviceInfo.getScreenSize(deviceId).catch(() => null),
        adbx.deviceInfo.getBatteryLevel(deviceId).catch(() => null),
        adbx.deviceInfo.getProperty(deviceId, 'ro.product.model').catch(() => null),
        adbx.deviceInfo.getProperty(deviceId, 'ro.product.brand').catch(() => null),
        adbx.deviceInfo.getProperty(deviceId, 'ro.build.version.release').catch(() => null),
        adbx.shell(deviceId, 'dumpsys window | grep mCurrentFocus').catch(() => null),
      ])
      return JSON.stringify({
        model,
        brand,
        androidVersion: version,
        screenSize: screen,
        batteryLevel: battery,
        currentFocus: String(focus || '').trim(),
      })
    }

    case 'screenshot': {
      const base64 = await adbx.screenshot.captureBase64(deviceId)
      context.lastScreenshot = `data:image/png;base64,${base64}`
      const { width, height } = await adbx.deviceInfo.getScreenSize(deviceId).catch(() => ({ width: 0, height: 0 }))
      return JSON.stringify({
        captured: true,
        width,
        height,
        attachedToConversation: Boolean(context.vision),
      })
    }

    case 'get_ui_layout': {
      const xml = await adbx.ui.dumpLayout(deviceId)
      context.lastUiLayout = truncate(xml, 12000)
      return context.lastUiLayout
    }

    case 'tap': {
      await adbx.input.tap(deviceId, Math.round(args.x), Math.round(args.y))
      await capturePostActionContext()
      return JSON.stringify({ success: true, action: 'tap', x: args.x, y: args.y })
    }

    case 'broadcast_tap': {
      const output = await runOnAll(async (id) => {
        await adbx.input.tap(id, Math.round(args.x), Math.round(args.y))
        return { success: true }
      })
      await capturePostActionContext()
      return output
    }

    case 'broadcast_input_text': {
      const output = await runOnAll(async (id) => {
        await adbx.input.text(id, String(args.text ?? ''))
        return { success: true }
      })
      await capturePostActionContext()
      return output
    }

    case 'broadcast_key': {
      const keyCode = AI_KEY_EVENTS[String(args.key).toLowerCase()]
      if (!keyCode)
        throw new Error(`Unknown key: ${args.key}`)
      const output = await runOnAll(async (id) => {
        await adbx.input.key(id, keyCode)
        return { success: true }
      })
      await capturePostActionContext()
      return output
    }

    case 'broadcast_screenshot': {
      const output = await runOnAll(async (id) => {
        const base64 = await adbx.screenshot.captureBase64(id)
        return { captured: true, bytes: base64.length }
      })
      return output
    }

    case 'swipe': {
      await adbx.input.swipe(deviceId, Math.round(args.x1), Math.round(args.y1), Math.round(args.x2), Math.round(args.y2), args.duration || 300)
      await capturePostActionContext()
      return JSON.stringify({ success: true, action: 'swipe', from: [args.x1, args.y1], to: [args.x2, args.y2] })
    }

    case 'input_text': {
      await adbx.input.text(deviceId, String(args.text ?? ''))
      await capturePostActionContext()
      return JSON.stringify({ success: true, action: 'input_text', text: args.text })
    }

    case 'key': {
      const keyCode = AI_KEY_EVENTS[String(args.key).toLowerCase()]
      if (!keyCode)
        throw new Error(`Unknown key: ${args.key}`)
      await adbx.input.key(deviceId, keyCode)
      await capturePostActionContext()
      return JSON.stringify({ success: true, action: 'key', key: args.key })
    }

    case 'open_app': {
      await adbx.shell(deviceId, `monkey -p ${String(args.package).trim()} -c android.intent.category.LAUNCHER 1`)
      await new Promise(resolve => setTimeout(resolve, 800))
      await capturePostActionContext()
      return JSON.stringify({ success: true, action: 'open_app', package: args.package })
    }

    case 'shell': {
      const command = String(args.command || '').trim()
      if (isDangerousShell(command))
        throw new Error('Blocked: this command is considered dangerous')
      const output = await adbx.shell(deviceId, command, { stderr: false })
      if (/\b(input|am|pm|svc|settings|cmd)\b/i.test(command))
        await capturePostActionContext()
      return truncate(output, 6000)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

/** One LLM round inside the agent loop: returns the assembled assistant message. */
async function agentRound(vendorConfig, messages, tools, onEvent, signal) {
  let text = ''
  const toolCalls = []

  await chatWithProvider({
    config: vendorConfig,
    messages,
    tools,
    signal,
    onEvent: (event) => {
      if (event.type === 'text-delta') {
        text += event.text
        onEvent?.({ type: 'text-delta', text: event.text })
      }
      if (event.type === 'tool-call') {
        toolCalls.push({
          id: event.toolCall.id,
          type: 'function',
          function: {
            name: event.toolCall.name,
            arguments: JSON.stringify(event.toolCall.arguments ?? {}),
          },
        })
        onEvent?.({ type: 'tool-call', toolCall: event.toolCall })
      }
    },
  })

  return {
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  }
}

/**
 * Full autonomous agent run for a scheduled AI task: the model gets the same
 * tool set as the interactive Copilot and operates the device until it stops
 * calling tools (or the configured step limit hits — 0 means unlimited).
 */
async function runAiAgentLoop({ vendorConfig, settings, session, config, promptText, onEvent, signal }) {
  const adbxSettings = settings
  const deviceIds = Array.isArray(config.deviceIds) && config.deviceIds.length
    ? config.deviceIds.filter(Boolean)
    : (config.deviceId ? [config.deviceId] : [])
  const multiDevice = deviceIds.length > 1
  const tools = buildAiToolSchemas({ allowShell: adbxSettings.allowShell !== false, multiDevice })

  const context = {
    deviceId: deviceIds[0] || '',
    deviceIds,
    vision: vendorConfig.vision === true,
    lastScreenshot: null,
    lastUiLayout: null,
  }

  // maxSteps comes from the shared Copilot setting: 0 = unlimited.
  const rawMaxSteps = Number(settings.maxSteps)
  const maxSteps = Number.isFinite(rawMaxSteps) && rawMaxSteps > 0 ? rawMaxSteps : 0

  const aborted = () => signal?.aborted === true
  const abortError = () => Object.assign(new Error('Aborted'), { code: 'ABORTED' })

  session.messages.push({
    id: uid('msg'),
    role: 'user',
    content: promptText,
    createdAt: new Date().toISOString(),
  })

  const assistantTexts = []
  let steps = 0

  // maxSteps 0 means unlimited — run until the model stops calling tools.
  for (;;) {
    if (aborted())
      throw abortError()
    if (maxSteps > 0 && steps >= maxSteps)
      break

    // Auto-compact when the conversation approaches the context budget.
    if (settings.autoCompact !== false) {
      const budget = Number(settings.contextWindow) || 32000
      if (estimateTokens(session.messages) > budget * 0.75) {
        const result = await compactSessionContext(session.messages, {
          budgetTokens: budget,
          noteText: '[context auto-compacted]',
        })
        if (result.compacted)
          session.messages = result.messages
      }
    }

    const messages = buildApiMessages(session.messages, {
      systemPrompt: config.systemPrompt || undefined,
      vision: context.vision,
    })

    steps++
    onEvent?.({ type: 'step', step: steps })
    const assistantMessage = await agentRound(vendorConfig, messages, tools, onEvent, signal)
    session.messages.push({
      id: uid('msg'),
      role: 'assistant',
      ...assistantMessage,
      createdAt: new Date().toISOString(),
    })

    if (assistantMessage.content)
      assistantTexts.push(String(assistantMessage.content))

    const toolCalls = assistantMessage.tool_calls || []
    if (!toolCalls.length)
      break

    for (const call of toolCalls) {
      if (aborted())
        throw abortError()

      const toolName = call.function?.name || 'unknown'
      let args = {}
      try {
        args = JSON.parse(call.function?.arguments || '{}')
      }
      catch {}

      const toolMessage = {
        id: uid('msg'),
        role: 'tool',
        tool_call_id: call.id,
        name: toolName,
        args,
        content: '',
        status: 'running',
        createdAt: new Date().toISOString(),
      }
      session.messages.push(toolMessage)

      try {
        toolMessage.content = await executeAgentTool(toolName, args, context, adbxSettings)
        toolMessage.status = 'completed'
        onEvent?.({ type: 'tool-result', name: toolName, status: 'completed' })

        // Vision bridge: attach the latest screenshot to the tool message; the
        // shared buildApiMessages re-sends it as a user image message.
        if (context.lastScreenshot && context.vision)
          toolMessage.image = context.lastScreenshot

        if (context.lastUiLayout && !context.vision) {
          const note = `\n[auto ui-dump]\n${context.lastUiLayout.slice(0, 4000)}`
          if (!String(toolMessage.content).includes('[auto ui-dump]'))
            toolMessage.content = `${String(toolMessage.content)}${note}`
        }
      }
      catch (error) {
        toolMessage.content = JSON.stringify({ error: error?.message ?? 'Tool execution failed' })
        toolMessage.status = 'failed'
      }
    }
  }

  const output = assistantTexts.join('\n\n') || `(agent finished after ${steps} step(s) without a textual reply)`

  return { output, steps }
}

export async function runAiPrompt(config = {}, task = null) {
  const vendorConfig = resolveVendorConfig(config)

  if (!vendorConfig)
    throw new Error('AI provider is not configured (missing Base URL / Model / API Key)')

  const prompt = String(config.prompt || '').trim()
  if (!prompt)
    throw new Error('AI prompt is empty')

  const settings = getCopilotSettings()

  // ── agent mode: full autonomous device control ──────────────
  if (config.agentMode === true) {
    const deviceIds = Array.isArray(config.deviceIds) && config.deviceIds.length
      ? config.deviceIds.filter(Boolean)
      : (config.deviceId ? [config.deviceId] : [])
    if (!deviceIds.length)
      throw new Error('Agent tasks need a target device')

    // Session policy: 'new' | 'continue' | 'existing' | 'shared' (see
    // resolveTaskSession). Without a owning task only 'new' makes sense.
    const mode = task?.id ? (config.sessionMode || 'new') : 'new'
    const { sessions, session, persisted: useSession } = resolveTaskSession(task || { id: 'adhoc' }, { ...config, sessionMode: mode })

    // Error isolation: a previous interrupted run may have left unanswered
    // tool_calls in the conversation, which would make EVERY follow-up
    // request fail with a provider 400. Repair before building context.
    sanitizeSessionMessages(session)

    const context = await buildDeviceContext({ ...config, includeDeviceInfo: true })
    const promptText = context.note ? `${prompt}\n\n${context.note}` : prompt

    try {
      const result = await runAiAgentLoop({ vendorConfig, settings, session, config: { ...config, deviceIds }, promptText })
      return { ...result, sessionId: useSession ? session.id : null }
    }
    finally {
      if (useSession)
        saveSessions(sessions, session)
    }
  }

  // ── plain text mode ─────────────────────────────────────────
  const plainMode = task?.id ? (config.sessionMode || 'new') : 'new'
  const { sessions, session, persisted: useSession } = resolveTaskSession(task || { id: 'adhoc' }, { ...config, sessionMode: plainMode })

  // Error isolation (see the agent-mode comment above).
  sanitizeSessionMessages(session)

  try {
    const context = await buildDeviceContext(config)

    const promptText = context.note ? `${prompt}\n\n${context.note}` : prompt
    const userParts = [{ type: 'text', text: promptText }]

    if (context.image) {
      if (vendorConfig.vision || config.vendorSnapshot?.vision) {
        userParts.push({ type: 'image_url', image_url: { url: context.image } })
      }
      else {
        userParts.push({ type: 'text', text: '(A screenshot was captured but the selected vendor is not marked as vision-capable, so it is not attached.)' })
      }
    }

    const userMessage = {
      id: uid('msg'),
      role: 'user',
      content: userParts.length === 1 ? promptText : userParts,
      createdAt: new Date().toISOString(),
    }

    session.messages.push(userMessage)

    // Auto-compact a long-running persistent conversation.
    if (useSession && settings.autoCompact !== false) {
      const budget = Number(settings.contextWindow) || 32000
      if (estimateTokens(session.messages) > budget * 0.75) {
        const result = await compactSessionContext(session.messages, {
          budgetTokens: budget,
          noteText: '[context auto-compacted]',
        })
        if (result.compacted)
          session.messages = result.messages
      }
    }

    const messages = buildApiMessages(session.messages, {
      systemPrompt: config.systemPrompt || undefined,
      vision: Boolean(vendorConfig.vision || config.vendorSnapshot?.vision),
    })

    // Retry up to N times on transient failures so a scheduled AI task keeps
    // running toward completion. The maxRetries is read from the persisted
    // copilot settings (set via the Copilot config drawer) and defaults to 3.
    const maxRetries = Number(settings.maxRetries) || 3
    const retryOnFailure = settings.retryOnFailure !== false

    const text = await callAiWithRetry(vendorConfig, messages, {
      maxRetries: retryOnFailure ? maxRetries : 0,
      retryable: retryOnFailure,
    })

    session.messages.push({
      id: uid('msg'),
      role: 'assistant',
      content: text,
      createdAt: new Date().toISOString(),
    })

    return { output: text, sessionId: useSession ? session.id : null }
  }
  finally {
    if (useSession)
      saveSessions(sessions, session)
  }
}

// ── Web chat (embedded web UI rides the same engine) ─────
/**
 * Running web chats keyed by sessionId so the web server can abort them
 * (web "stop generating" button).
 */
const runningWebChats = new Map()

export function abortWebChat(sessionId) {
  const controller = runningWebChats.get(sessionId)
  if (!controller)
    return false
  controller.abort(new Error('Aborted from web'))
  return true
}

/**
 * One chat turn from the embedded web UI. Reuses the same provider stack,
 * agent tool set and session store as the desktop Copilot, streaming events
 * back through `onEvent` so the browser renders deltas as they arrive.
 *
 * @param {object} options
 * @param {string} options.sessionId conversation to append to ('' → create new)
 * @param {string} options.content   the user message
 * @param {boolean} options.agentMode give the model the device tool set
 * @param {string} options.deviceId  target device for tools (agent mode)
 * @param {string} [options.vendorId] vendor override; defaults to active vendor
 * @param {string} [options.name]    name for a newly created conversation
 * @param {(event: object) => void} [options.onEvent] streaming callback
 * @param {(sessionId: string) => void} [options.onStart] fires once the session is resolved
 */
export async function runWebChat(options = {}) {
  const {
    sessionId = '',
    content,
    agentMode = false,
    deviceId = '',
    deviceIds = [],
    vendorId = '',
    name = '',
    onEvent,
    onStart,
  } = options

  const text = String(content || '').trim()
  if (!text)
    throw new Error('Message content is empty')

  const settings = getCopilotSettings()

  // Resolve vendor: explicit pick → active vendor → first configured vendor.
  const vendors = electronStore.get('copilot.settings.vendors') || {}
  const pick = vendors[vendorId] || vendors[settings.activeVendorId] || Object.values(vendors).find(v => v?.baseUrl && v?.model)
  if (!pick)
    throw new Error('AI provider is not configured (missing Base URL / Model / API Key)')

  const vendorConfig = {
    apiType: pick.apiType,
    baseUrl: pick.baseUrl,
    apiKey: pick.apiKey,
    model: pick.model,
    temperature: pick.temperature,
    maxOutputTokens: pick.maxOutputTokens,
    // Stream from the provider so the browser sees real deltas through SSE.
    streaming: true,
    vision: pick.vision === true,
  }

  // Find or create the conversation (web conversations live in the same
  // store; scope 'web' keeps them out of per-device Copilot windows).
  const sessions = getSessions()
  let session = sessionId ? sessions.find(item => item.id === sessionId) : null

  if (sessionId && !session)
    throw new Error('Conversation not found')

  let created = false
  if (!session) {
    session = createSession({ scope: 'web', name: name || '', deviceId })
    sessions.unshift(session)
    created = true
  }

  // Multi-device binding (群控): a conversation may control several devices
  // at once — agent tools accept per-call targets + broadcast tools fan out.
  const boundDeviceIds = (Array.isArray(deviceIds) && deviceIds.length ? deviceIds : (deviceId ? [deviceId] : []))
    .map(String)
    .filter(Boolean)

  if (boundDeviceIds.length) {
    session.deviceIds = boundDeviceIds
    session.deviceId = boundDeviceIds[0]
  }
  else if (deviceId) {
    session.deviceId = deviceId
    delete session.deviceIds
  }

  // Error isolation: repair tool_calls left unanswered by an interrupted
  // previous turn before appending to the conversation.
  sanitizeSessionMessages(session)

  const controller = new AbortController()
  runningWebChats.set(session.id, controller)
  // Lets the HTTP layer abort the turn when the browser disconnects, even
  // for conversations created by this very call.
  onStart?.(session.id)

  try {
    session.messages.push({
      id: uid('msg'),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    })

    // Auto-compact before the turn when the conversation nears the budget.
    if (settings.autoCompact !== false) {
      const budget = Number(settings.contextWindow) || 32000
      if (estimateTokens(session.messages) > budget * 0.75) {
        const result = await compactSessionContext(session.messages, {
          budgetTokens: budget,
          noteText: '[context auto-compacted]',
        })
        if (result.compacted)
          session.messages = result.messages
      }
    }

    let result
    if (agentMode) {
      if (!session.deviceId && !session.deviceIds?.length)
        throw new Error('Agent mode needs a target device')

      result = await runAiAgentLoop({
        vendorConfig,
        settings,
        session,
        config: { deviceId: session.deviceId, deviceIds: session.deviceIds || (session.deviceId ? [session.deviceId] : []) },
        promptText: text,
        onEvent,
        signal: controller.signal,
      })
    }
    else {
      const messages = buildApiMessages(session.messages, {
        systemPrompt: settings.systemPrompt || undefined,
        vision: vendorConfig.vision,
      })
      onEvent?.({ type: 'step', step: 1 })

      const output = await callAiWithRetry(vendorConfig, messages, {
        maxRetries: settings.retryOnFailure !== false ? (Number(settings.maxRetries) || 3) : 0,
        retryable: settings.retryOnFailure !== false,
        signal: controller.signal,
        onEvent,
      })

      session.messages.push({
        id: uid('msg'),
        role: 'assistant',
        content: output,
        createdAt: new Date().toISOString(),
      })

      result = { output, steps: 1 }
    }

    return {
      output: result.output,
      steps: result.steps,
      sessionId: session.id,
      created,
    }
  }
  finally {
    runningWebChats.delete(session.id)
    saveSessions(sessions, session)
  }
}

// ── Workflows ────────────────────────────────────────────
const MAX_DELAY_SECONDS = 300

function applyVariables(value, variables) {
  return String(value ?? '').replace(/\{(\w+)\}/g, (match, name) => {
    return Object.hasOwn(variables, name) ? String(variables[name]) : match
  })
}

/**
 * Run a workflow's steps sequentially.
 * Variables available in step fields: input, prev, date, time, timestamp, deviceId.
 */
export async function runWorkflowSteps(steps, input = '', deviceId = '') {
  const variables = {
    input: String(input ?? ''),
    prev: String(input ?? ''),
    date: dayjs().format('YYYY-MM-DD'),
    time: dayjs().format('HH:mm:ss'),
    timestamp: String(Date.now()),
    deviceId: String(deviceId ?? ''),
  }

  const results = []
  let failed = false
  let lastOutput = variables.input

  for (const [index, step] of (steps || []).entries()) {
    const stepStart = Date.now()
    const base = {
      index,
      id: step.id,
      name: step.name || `Step ${index + 1}`,
      type: step.type,
    }

    if (failed) {
      results.push({ ...base, status: 'SKIPPED', durationMs: 0 })
      continue
    }

    try {
      let output = ''

      if (step.type === 'ai') {
        const result = await runAiPrompt({
          vendorId: step.vendorId,
          vendorSnapshot: step.vendorSnapshot,
          systemPrompt: applyVariables(step.systemPrompt, variables),
          prompt: applyVariables(step.prompt, variables),
          deviceId: step.deviceId || deviceId,
          includeDeviceInfo: false,
          includeScreenshot: step.includeScreenshot === true,
        })
        output = result.output
      }
      else if (step.type === 'action') {
        const action = { ...step }

        // Variable substitution for text-bearing fields.
        for (const field of ['command', 'text', 'url', 'body', 'title', 'content', 'package']) {
          if (action[field])
            action[field] = applyVariables(action[field], variables)
        }

        const result = await runAction(action)
        output = result.output
      }
      else if (step.type === 'delay') {
        const seconds = Math.max(0, Math.min(MAX_DELAY_SECONDS, Number(step.seconds) || 0))
        await new Promise(resolve => setTimeout(resolve, seconds * 1000))
        output = `waited ${seconds}s`
      }
      else {
        throw new Error(`Unknown step type: ${step.type}`)
      }

      results.push({ ...base, status: 'SUCCESS', output, durationMs: Date.now() - stepStart })
      variables.prev = output
      if (step.id)
        variables[step.id] = output
      lastOutput = output
    }
    catch (error) {
      failed = true
      results.push({
        ...base,
        status: 'FAILED',
        error: error?.message ?? String(error),
        durationMs: Date.now() - stepStart,
      })
    }
  }

  return {
    status: failed ? 'FAILED' : 'SUCCESS',
    steps: results,
    output: lastOutput,
    error: failed ? results.find(result => result.status === 'FAILED')?.error : null,
  }
}

export async function runWorkflow(workflowId, trigger = 'manual') {
  const workflow = findWorkflow(workflowId)

  if (!workflow)
    throw new Error('Workflow not found')

  const steps = Array.isArray(workflow.steps) ? workflow.steps : []

  if (!steps.length)
    throw new Error('Workflow has no steps')

  const run = addRun({
    id: uid('wfrun'),
    kind: 'workflow',
    refId: workflow.id,
    refName: workflow.name,
    status: 'RUNNING',
    trigger,
    startedAt: new Date().toISOString(),
    steps: [],
  })

  const started = Date.now()
  let result

  try {
    result = await runWorkflowSteps(steps)
  }
  catch (error) {
    result = { status: 'FAILED', steps: [], output: '', error: error?.message ?? String(error) }
  }

  const finished = {
    status: result.status,
    steps: result.steps,
    output: truncate(result.output),
    error: result.error,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  }

  updateRun(run.id, finished)

  if (workflow.notifyOnComplete !== false) {
    showNotification(
      `Escrcpy — ${workflow.name}`,
      result.status === 'SUCCESS' ? 'Workflow completed successfully' : `Workflow failed: ${result.error || 'unknown error'}`,
    )
  }

  return { ...run, ...finished }
}

// ── Task execution ───────────────────────────────────────
export function showNotification(title, body) {
  try {
    if (!Notification.isSupported())
      return

    const notification = new Notification({ title, body: String(body || '').slice(0, 500), silent: false })
    notification.on('click', () => notification.close())
    notification.show()
  }
  catch (error) {
    console.warn('[Tasks] Notification failed:', error?.message ?? error)
  }
}

/** Execute one task and record the run. `trigger` is 'schedule' or 'manual'. */
export async function executeTask(task, trigger = 'schedule') {
  const run = addRun({
    id: uid('taskrun'),
    kind: 'task',
    refId: task.id,
    refName: task.name,
    type: task.type,
    status: 'RUNNING',
    trigger,
    startedAt: new Date().toISOString(),
  })

  const started = Date.now()
  let status = 'SUCCESS'
  let output = ''
  let error = null
  let steps = null

  try {
    if (task.type === 'AI') {
      const result = await runAiPrompt(task.config || {}, task)
      output = result.output
      if (result.steps)
        output = `${output}\n\n[agent steps: ${result.steps}]`
    }
    else if (task.type === 'AUTOMATION') {
      const result = await runAction(task.config || {})
      output = result.output
    }
    else if (task.type === 'WORKFLOW') {
      const workflowId = task.config?.workflowId
      if (!workflowId)
        throw new Error('No workflow selected')

      const workflow = findWorkflow(workflowId)
      if (!workflow)
        throw new Error('The linked workflow no longer exists')

      const result = await runWorkflowSteps(workflow.steps || [])
      output = [
        `Workflow ${result.status === 'SUCCESS' ? 'completed' : 'failed'}`,
        ...result.steps.map(step => `  ${step.index + 1}. ${step.name}: ${step.status}${step.error ? ` (${step.error})` : ''}`),
      ].join('\n')
      steps = result.steps

      if (result.status === 'FAILED')
        throw new Error(result.error || 'Workflow failed')
    }
    else {
      throw new Error(`Unknown task type: ${task.type}`)
    }
  }
  catch (err) {
    status = 'FAILED'
    error = err?.message ?? String(err)
    output = output || error
  }

  const finished = {
    status,
    steps,
    output: truncate(output),
    error,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  }

  updateRun(run.id, finished)

  patchTask(task.id, {
    lastRunAt: finished.finishedAt,
    lastStatus: status,
    nextRunAt: computeNextRunAt(task),
  })

  if (task.notifyOnComplete !== false) {
    const title = status === 'SUCCESS'
      ? `Escrcpy — ${task.name}`
      : `Escrcpy — ${task.name} failed`
    showNotification(title, status === 'SUCCESS' ? truncate(output, 300) : truncate(error || 'unknown error', 300))
  }

  return { ...run, ...finished }
}

/** Run a task by id (used by IPC manual runs). */
export async function executeTaskById(id, trigger = 'manual') {
  const task = findTask(id)
  if (!task)
    throw new Error('Task not found')
  return executeTask(task, trigger)
}
