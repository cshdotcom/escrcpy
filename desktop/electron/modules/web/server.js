/**
 * Embedded Web UI server ("网页版"): exposes the Copilot chat engine and the
 * scheduled-task engine over HTTP so most app features work from a phone or
 * any browser on the LAN.
 *
 *  - Port and password are configured in the Copilot settings drawer
 *    (`copilot.settings.webServer` = { enabled, port, password }).
 *  - With a password set the server binds 0.0.0.0 (LAN access) and every
 *    /api call requires a signed-cookie session obtained via POST /api/login.
 *  - Without a password the server binds 127.0.0.1 only (loopback is safe:
 *    the user is already at the machine).
 *  - /api/chat streams SSE events (text deltas, tool calls, steps) straight
 *    from the same provider/agent engine the desktop Copilot uses.
 *
 * No third-party dependencies — node:http + node:crypto only.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import os from 'node:os'
import { app } from 'electron'
import { Adb } from '@devicefarmer/adbkit'
import electronStore from '$electron/helpers/store/index.js'
import { setupEnvPath } from '$electron/process/helper.js'

import {
  abortWebChat,
  executeTaskById,
  listSessionsForPicker,
  runWebChat,
} from '../tasks/helpers/executor.js'
import { getTasks, patchTask, queryRuns } from '../tasks/helpers/store.js'
import { computeNextRunAt } from '../tasks/helpers/schedule-helper.js'
import mirrorModule from '../mirror/service.js'

import { WEB_PAGE_HTML } from './public.js'

const DEFAULT_PORT = 38080
/** Login sessions live 7 days. */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Login brute-force guard: 5 failures → 60s lockout per address. */
const LOGIN_MAX_FAILURES = 5
const LOGIN_LOCKOUT_MS = 60_000

let adbClient = null

/**
 * Direct adbkit client — the middleware is preload-only (it imports
 * renderer APIs like webFrame and must never be linked into the main
 * bundle).
 */
function getAdbClient() {
  if (!adbClient) {
    setupEnvPath()
    adbClient = Adb.createClient()
  }
  return adbClient
}

async function getRawDeviceList() {
  try {
    const devices = await getAdbClient().listDevices()
    return (devices || []).map(device => ({ id: device.id, type: device.type }))
  }
  catch (error) {
    console.warn('[Web] device list failed:', error?.message ?? error)
    return []
  }
}

let server = null
let activePort = 0
let activePassword = ''
const loginFailures = new Map()
/** Sessions currently streaming a chat, guarded so one conversation cannot
 * run two turns at once. */
const activeChats = new Set()

function getWebSettings() {
  const value = electronStore.get('copilot.settings.webServer')
  return {
    enabled: value?.enabled === true,
    port: Number(value?.port) || DEFAULT_PORT,
    password: String(value?.password || ''),
  }
}

/** Persisted HMAC secret so sessions survive restarts. Never sent to clients. */
function getSecret() {
  let secret = electronStore.get('webServer.secret')
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    secret = crypto.randomBytes(32).toString('hex')
    electronStore.set('webServer.secret', secret)
  }
  return secret
}

function signToken(expiresAt) {
  return crypto.createHmac('sha256', getSecret()).update(String(expiresAt)).digest('hex')
}

function issueToken() {
  const expiresAt = Date.now() + TOKEN_TTL_MS
  return `${expiresAt}.${signToken(expiresAt)}`
}

function verifyToken(token) {
  if (typeof token !== 'string')
    return false
  const [expiresAt, signature] = token.split('.')
  if (!expiresAt || !signature)
    return false
  if (Number(expiresAt) < Date.now())
    return false
  const expected = signToken(expiresAt)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function timingSafeEqualString(a, b) {
  const bufferA = Buffer.from(String(a || ''))
  const bufferB = Buffer.from(String(b || ''))
  if (bufferA.length !== bufferB.length)
    return false
  return crypto.timingSafeEqual(bufferA, bufferB)
}

function parseCookies(header) {
  const result = {}
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index === -1)
      continue
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return result
}

function isAuthorized(req) {
  const { password } = getWebSettings()
  // No password configured → server is loopback-bound; every local request
  // is trusted.
  if (!password)
    return true

  const cookies = parseCookies(req.headers.cookie)
  if (verifyToken(cookies.escrcpy_web))
    return true

  const auth = String(req.headers.authorization || '')
  return auth.startsWith('Bearer ') && verifyToken(auth.slice(7).trim())
}

/** LAN + loopback URLs the server is reachable on (for the settings drawer). */
export function getWebStatus() {
  const { enabled, port, password } = getWebSettings()
  const urls = []
  if (server && enabled) {
    urls.push(`http://127.0.0.1:${activePort}`)
    for (const [name, infos] of Object.entries(os.networkInterfaces())) {
      for (const info of infos || []) {
        if (info.family === 'IPv4' && !info.internal)
          urls.push(`http://${info.address}:${activePort} (${name})`)
      }
    }
  }
  return {
    running: Boolean(server) && enabled,
    port: activePort,
    lanOnly: !password,
    urls,
  }
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : {})
      }
      catch (error) {
        reject(new Error(`Invalid JSON body: ${error?.message ?? error}`))
      }
    })
    req.on('error', reject)
  })
}

/** Tasks serialized for the web UI — vendor snapshots may carry API keys. */
function serializeTaskForWeb(task) {
  const config = { ...(task.config || {}) }
  delete config.vendorSnapshot
  return {
    id: task.id,
    name: task.name,
    type: task.type,
    cronExpr: task.cronExpr,
    enabled: task.enabled !== false,
    nextRunAt: task.enabled !== false ? (task.nextRunAt || computeNextRunAt(task)) : null,
    lastRunAt: task.lastRunAt || null,
    lastStatus: task.lastStatus || null,
    notifyOnComplete: task.notifyOnComplete !== false,
    sessionMode: config.sessionMode || 'new',
    agentMode: config.agentMode === true,
    config,
  }
}

function sanitizeSession(session) {
  const messages = (session.messages || []).map((message) => {
    if (message.image || (message.images && message.images.length)) {
      // Screenshots can be megabytes; the web UI lazily pulls one at a time.
      return { ...message, image: undefined, images: message.images?.length ? ['(image hidden — use the desktop app)'] : undefined }
    }
    return message
  })
  return { ...session, messages }
}

async function handleLogin(req, res) {
  const { password } = getWebSettings()

  // No password configured → nothing to log in to.
  if (!password)
    return sendJson(res, 200, { success: true, token: '', noPassword: true })

  const address = req.socket.remoteAddress || 'unknown'
  const state = loginFailures.get(address)
  if (state && state.lockedUntil > Date.now()) {
    const seconds = Math.ceil((state.lockedUntil - Date.now()) / 1000)
    res.setHeader('Retry-After', String(seconds))
    return sendJson(res, 429, { success: false, error: `Too many attempts — try again in ${seconds}s` })
  }

  const body = await readBody(req)
  const given = String(body?.password || '')

  if (!timingSafeEqualString(given, password)) {
    const failures = (state?.failures || 0) + 1
    loginFailures.set(address, {
      failures,
      lockedUntil: failures >= LOGIN_MAX_FAILURES ? Date.now() + LOGIN_LOCKOUT_MS : 0,
    })
    return sendJson(res, 401, { success: false, error: 'Incorrect password' })
  }

  loginFailures.delete(address)
  const token = issueToken()
  res.setHeader('Set-Cookie', `escrcpy_web=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`)
  return sendJson(res, 200, { success: true, token })
}

async function handleChat(req, res) {
  const body = await readBody(req, 10 * 1024 * 1024)
  const {
    sessionId = '',
    content = '',
    agentMode = false,
    deviceId = '',
    deviceIds = [],
    vendorId = '',
    name = '',
    stream = true,
  } = body

  if (sessionId && activeChats.has(sessionId))
    return sendJson(res, 409, { success: false, error: 'A turn is already running on this conversation' })

  const wantsSse = stream === true

  if (!wantsSse) {
    try {
      const result = await runWebChat({ sessionId, content, agentMode, deviceId, deviceIds, vendorId, name })
      return sendJson(res, 200, { success: true, ...result })
    }
    catch (error) {
      return sendJson(res, 500, { success: false, error: { code: error?.code || 'UNKNOWN_ERROR', message: error?.message ?? String(error) } })
    }
  }

  // SSE streaming response.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const write = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    catch {}
  }

  let chatSessionId = sessionId

  // Browser tab closed / network dropped → abort the running turn.
  const onClose = () => {
    if (chatSessionId)
      abortWebChat(chatSessionId)
  }
  res.on('close', onClose)

  try {
    const result = await runWebChat({
      sessionId,
      content,
      agentMode,
      deviceId,
      deviceIds,
      vendorId,
      name,
      onStart: (id) => {
        chatSessionId = id
        activeChats.add(id)
      },
      onEvent: write,
    })
    write({ type: 'done', ...result })
  }
  catch (error) {
    write({ type: 'error', code: error?.code || 'UNKNOWN_ERROR', message: error?.message ?? String(error) })
  }
  finally {
    if (chatSessionId)
      activeChats.delete(chatSessionId)
    try {
      res.end()
    }
    catch {}
  }
}

/**
 * SSE stream of the embedded mirror: raw packets (base64) + lifecycle events.
 * The browser decodes with WebCodecs, exactly like the desktop mirror window.
 */
function handleMirrorStream(req, res, url) {
  const deviceId = String(url.searchParams.get('deviceId') || '').trim()
  if (!deviceId) {
    sendJson(res, 400, { success: false, error: 'Missing deviceId' })
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')

  let closed = false
  const unsubscribe = mirrorModule.subscribe(deviceId, (event) => {
    if (closed)
      return
    try {
      const payload = { ...event }
      if (payload.data && typeof payload.data !== 'string') {
        const buffer = Buffer.isBuffer(payload.data) ? payload.data : Buffer.from(payload.data)
        payload.data = buffer.toString('base64')
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    catch {
      closed = true
      try {
        res.end()
      }
      catch {}
    }
  })

  const ping = setInterval(() => {
    if (closed)
      return
    try {
      res.write(': ping\n\n')
    }
    catch {
      closed = true
    }
  }, 15000)
  ping.unref?.()

  req.on('close', () => {
    closed = true
    clearInterval(ping)
    unsubscribe()
  })
  res.on('error', () => {
    closed = true
    clearInterval(ping)
    unsubscribe()
  })
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  const method = req.method || 'GET'

  // ── public routes ─────────────────────────────────────
  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    return res.end(WEB_PAGE_HTML)
  }

  if (method === 'GET' && path === '/healthz')
    return sendJson(res, 200, { ok: true, app: 'Escrcpy', version: app.getVersion() })

  if (method === 'POST' && path === '/api/login') {
    try {
      return await handleLogin(req, res)
    }
    catch (error) {
      return sendJson(res, 400, { success: false, error: error?.message ?? 'Bad request' })
    }
  }

  if (!path.startsWith('/api/'))
    return sendJson(res, 404, { error: 'Not found' })

  // ── authenticated routes ──────────────────────────────
  if (!isAuthorized(req))
    return sendJson(res, 401, { success: false, error: 'Unauthorized' })

  try {
    if (method === 'GET' && path === '/api/status') {
      const status = getWebStatus()
      const { password } = getWebSettings()
      const vendors = electronStore.get('copilot.settings.vendors') || {}
      let devices = []
      try {
        devices = await getRawDeviceList()
      }
      catch {
        devices = []
      }
      return sendJson(res, 200, {
        success: true,
        version: app.getVersion(),
        web: { running: status.running, port: status.port },
        authRequired: Boolean(password),
        devices: devices.map(device => ({ id: device.id, status: device.type })),
        vendors: Object.values(vendors).map(v => ({
          id: v?.id,
          name: v?.name || v?.id,
          model: v?.model || '',
          vision: v?.vision === true,
          configured: Boolean(v?.baseUrl && v?.model),
        })),
      })
    }

    if (method === 'GET' && path === '/api/devices') {
      const devices = await getRawDeviceList()
      return sendJson(res, 200, { success: true, devices: devices.map(d => ({ id: d.id, status: d.type })) })
    }

    if (method === 'GET' && path === '/api/sessions')
      return sendJson(res, 200, { success: true, sessions: listSessionsForPicker() })

    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1])
      const sessions = electronStore.get('copilot.sessions') || []
      const session = Array.isArray(sessions) ? sessions.find(item => item?.id === id) : null

      if (method === 'GET') {
        if (!session)
          return sendJson(res, 404, { success: false, error: 'Conversation not found' })
        return sendJson(res, 200, { success: true, session: sanitizeSession(session) })
      }

      if (method === 'DELETE') {
        electronStore.set('copilot.sessions', (Array.isArray(sessions) ? sessions : []).filter(item => item?.id !== id))
        return sendJson(res, 200, { success: true })
      }
    }

    if (method === 'POST' && path === '/api/chat')
      return await handleChat(req, res)

    if (method === 'POST' && path === '/api/chat/abort') {
      const body = await readBody(req)
      const aborted = abortWebChat(String(body?.sessionId || ''))
      return sendJson(res, 200, { success: aborted })
    }

    if (method === 'GET' && path === '/api/tasks')
      return sendJson(res, 200, { success: true, tasks: getTasks().map(serializeTaskForWeb) })

    if (method === 'GET' && path === '/api/runs') {
      const kind = url.searchParams.get('kind') || undefined
      const refId = url.searchParams.get('refId') || undefined
      const limit = Number(url.searchParams.get('limit')) || 100
      return sendJson(res, 200, { success: true, runs: queryRuns({ kind, refId, limit }) })
    }

    const taskRunMatch = path.match(/^\/api\/tasks\/([^/]+)\/run$/)
    if (method === 'POST' && taskRunMatch) {
      const run = await executeTaskById(decodeURIComponent(taskRunMatch[1]), 'manual')
      return sendJson(res, 200, { success: true, run })
    }

    const taskToggleMatch = path.match(/^\/api\/tasks\/([^/]+)\/toggle$/)
    if (method === 'POST' && taskToggleMatch) {
      const body = await readBody(req)
      const id = decodeURIComponent(taskToggleMatch[1])
      const task = getTasks().find(item => item.id === id)
      if (!task)
        return sendJson(res, 404, { success: false, error: 'Task not found' })
      const enabled = body?.enabled !== false
      const updated = patchTask(id, { enabled, nextRunAt: enabled ? computeNextRunAt(task) : null })
      return sendJson(res, 200, { success: true, task: serializeTaskForWeb(updated) })
    }

    if (method === 'GET' && path === '/api/mirror/status') {
      return sendJson(res, 200, {
        success: true,
        sessions: mirrorModule.listSessions(),
      })
    }

    if (method === 'GET' && path === '/api/mirror/stream')
      return handleMirrorStream(req, res, url)

    if (method === 'POST' && path === '/api/mirror/start') {
      const body = await readBody(req)
      const result = await mirrorModule.startSession(String(body?.deviceId || ''), {
        maxSize: 720,
        maxFps: 30,
        audio: false,
        ...(body?.options || {}),
      })
      return sendJson(res, 200, { success: true, ...result })
    }

    if (method === 'POST' && path === '/api/mirror/stop') {
      const body = await readBody(req)
      await mirrorModule.stopSession(String(body?.deviceId || ''))
      return sendJson(res, 200, { success: true })
    }

    if (method === 'POST' && path === '/api/mirror/control') {
      const body = await readBody(req)
      const message = body?.message || {}
      const deviceId = String(body?.deviceId || '')
      let result = false
      switch (message.kind) {
        case 'touch':
          result = mirrorModule.touch(deviceId, message)
          break
        case 'key':
          result = mirrorModule.key(deviceId, message)
          break
        case 'text':
          result = mirrorModule.text(deviceId, message.text)
          break
        case 'scroll':
          result = mirrorModule.scroll(deviceId, message)
          break
        case 'clipboard':
          result = mirrorModule.clipboard(deviceId, message)
          break
        case 'command':
          result = mirrorModule.command(deviceId, message.command, message)
          break
        default:
          break
      }
      return sendJson(res, 200, { success: result })
    }

    if (method === 'GET' && path === '/api/mirror/keymap') {
      const deviceId = String(url.searchParams.get('deviceId') || '')
      return sendJson(res, 200, { success: true, ...mirrorModule.getKeymap(deviceId) })
    }

    if (method === 'POST' && path === '/api/mirror/keymap') {
      const body = await readBody(req)
      const saved = mirrorModule.saveKeymap(String(body?.deviceId || ''), body)
      return sendJson(res, 200, { success: true, ...saved })
    }

    return sendJson(res, 404, { success: false, error: 'Not found' })
  }
  catch (error) {
    console.error('[Web] request failed:', error?.message ?? error)
    return sendJson(res, 500, { success: false, error: error?.message ?? 'Internal error' })
  }
}

export async function startWebServer() {
  if (server)
    return

  const { port, password } = getWebSettings()
  const host = password ? '0.0.0.0' : '127.0.0.1'

  await new Promise((resolve, reject) => {
    const instance = http.createServer((req, res) => {
      route(req, res).catch((error) => {
        console.error('[Web] route error:', error?.message ?? error)
        try {
          sendJson(res, 500, { success: false, error: 'Internal error' })
        }
        catch {}
      })
    })

    instance.on('error', (error) => {
      console.error('[Web] server error:', error?.message ?? error)
      server = null
      reject(error)
    })

    instance.listen(port, host, () => {
      server = instance
      activePort = port
      activePassword = password
      console.log(`[Web] Escrcpy web UI listening on http://${host}:${port}${password ? ' (password protected)' : ' (loopback only — set a password for LAN access)'}`)
      resolve()
    })
  })
}

export function stopWebServer() {
  if (!server)
    return
  try {
    server.closeAllConnections?.()
    server.close()
  }
  catch (error) {
    console.warn('[Web] stop failed:', error?.message ?? error)
  }
  server = null
  activePort = 0
  console.log('[Web] Escrcpy web UI stopped')
}

/**
 * Module entry: keep the HTTP server in sync with the settings — start on
 * boot when enabled, restart on port/password change, stop when disabled.
 */
export default {
  name: 'module:web:server',
  apply() {
    const sync = async () => {
      const { enabled, port, password } = getWebSettings()
      const needsRestart = server && (port !== activePort || password !== activePassword)

      if (needsRestart || (server && !enabled))
        stopWebServer()

      if (enabled && !server) {
        try {
          await startWebServer()
        }
        catch (error) {
          // Port in use etc. — surface clearly instead of crashing the app.
          console.error('[Web] failed to start:', error?.message ?? error)
        }
      }
    }

    electronStore.onDidChange('copilot.settings.webServer', () => {
      sync().catch(error => console.error('[Web] settings sync failed:', error?.message ?? error))
    })

    // Only start once Electron is ready (app.getVersion and the adb
    // middleware both need it).
    if (app.isReady())
      sync().catch(() => {})
    else
      app.whenReady().then(sync).catch(error => console.error('[Web] start failed:', error?.message ?? error))

    return () => {
      stopWebServer()
    }
  },
}
