/**
 * Task and workflow execution engine (main process).
 *
 * Task types:
 *  - AI: scheduled prompts executed through the Copilot provider stack
 *  - AUTOMATION: device operations, HTTP requests and desktop notifications
 *  - WORKFLOW: multi-step chains mixing AI steps, actions and delays
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, Notification } from 'electron'
import dayjs from 'dayjs'
import { Adb } from '@devicefarmer/adbkit'
import { createAdbx } from '@escrcpy/adbx'
import { yadbPath } from '$electron/configs/index.js'
import { setupEnvPath } from '$electron/process/helper.js'
import electronStore from '$electron/helpers/store/index.js'
import { chatWithProvider } from '../../copilot/helpers/providers.js'

import { addRun, findTask, findWorkflow, patchTask, updateRun, uid } from './store.js'
import { computeNextRunAt } from './schedule-helper.js'

// Mirrors the Copilot shell guard (desktop/pages/copilot/configs/index.js).
const DANGEROUS_SHELL_PATTERNS = [
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bformat\b/i,
  /(^|\s)su(\s|$)/,
  /\brm\s+-rf?\s+\//i,
  /factory\s*reset/i,
  /\bflash_image\b/i,
  /\bwipe\s+data\b/i,
  /\bmkfs\b/i,
]

export function isDangerousShell(command) {
  return DANGEROUS_SHELL_PATTERNS.some(pattern => pattern.test(String(command || '').trim()))
}

// ── ADB (main-process instance) ──────────────────────────
let adbxInstance = null
let adbxFailed = false

function getAdbx() {
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
export async function runAction(action, context = {}) {
  const config = action || {}
  const kind = config.action || config.kind

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
    }
  }

  const snapshot = config.vendorSnapshot
  if (snapshot?.baseUrl && snapshot?.model && snapshot?.apiKey) {
    return { ...snapshot, streaming: false }
  }

  return null
}

async function collectAiText(config, messages) {
  let text = ''

  await chatWithProvider({
    config,
    messages,
    tools: [],
    onEvent: (event) => {
      if (event.type === 'text-delta')
        text += event.text
    },
  })

  if (!text.trim())
    throw new Error('The model returned an empty response')

  return text
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

export async function runAiPrompt(config = {}) {
  const vendorConfig = resolveVendorConfig(config)

  if (!vendorConfig)
    throw new Error('AI provider is not configured (missing Base URL / Model / API Key)')

  const prompt = String(config.prompt || '').trim()
  if (!prompt)
    throw new Error('AI prompt is empty')

  const context = await buildDeviceContext(config)

  const promptText = context.note ? `${prompt}\n\n${context.note}` : prompt
  const userParts = [{ type: 'text', text: promptText }]

  if (context.image) {
    if (config.vendorSnapshot?.vision) {
      userParts.push({ type: 'image_url', image_url: { url: context.image } })
    }
    else {
      userParts.push({ type: 'text', text: '(A screenshot was captured but the selected vendor is not marked as vision-capable, so it is not attached.)' })
    }
  }

  const messages = []

  if (config.systemPrompt?.trim())
    messages.push({ role: 'system', content: config.systemPrompt.trim() })

  messages.push({
    role: 'user',
    content: userParts.length === 1 ? promptText : userParts,
  })

  const text = await collectAiText(vendorConfig, messages)
  return { output: text }
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
      const result = await runAiPrompt(task.config || {})
      output = result.output
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
