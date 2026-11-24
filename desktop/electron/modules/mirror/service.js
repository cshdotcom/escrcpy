/**
 * Embedded mirror service (内嵌镜像): owns one scrcpy session per device and
 * fans its packets out to every subscriber — the Electron mirror window and
 * the web UI (SSE). Also persists keyboard-mapping profiles per device.
 *
 * Everything the paid version gates behind "内嵌镜像 + 键盘映射" lives here:
 *  - raw H.264/Opus streaming into WebCodecs
 *  - touch / key / text / scroll / clipboard injection
 *  - per-device keyboard mapping profiles (tap, swipe, rapid tap, scroll,
 *    joystick, view control, macro)
 */
import { BrowserWindow } from 'electron'
import { ipcxMain } from '@escrcpy/electron-ipcx/main'
import electronStore from '$electron/helpers/store/index.js'
import { MirrorSession, serverJarPath } from './session.js'
import { ANDROID_KEYCODE, META_STATE } from './protocol.js'

const sessions = new Map()

/** Mirrors a small subset of the device state so the renderer can show it. */
function getSession(deviceId) {
  return sessions.get(deviceId) || null
}

function listSessions() {
  return [...sessions.values()].map(item => ({
    deviceId: item.deviceId,
    width: item.session.width,
    height: item.session.height,
    startedAt: item.startedAt,
    subscribers: item.subscribers.size,
  }))
}

function broadcast(entry, event) {
  for (const subscriber of entry.subscribers) {
    try {
      subscriber(event)
    }
    catch (error) {
      console.warn('[Mirror] subscriber failed:', error?.message ?? error)
    }
  }
}

function serializeEvent(deviceId, event) {
  if (event.type === 'data' || event.type === 'configuration') {
    const data = event.data
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
    return {
      deviceId,
      type: event.type,
      stream: event.stream,
      keyframe: event.keyframe,
      pts: typeof event.pts === 'bigint' ? event.pts.toString() : event.pts,
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    }
  }
  return { deviceId, ...event }
}

function createSessionEntry(deviceId, options) {
  const entry = {
    deviceId,
    subscribers: new Set(),
    session: null,
    startedAt: Date.now(),
    stopping: false,
  }

  entry.session = new MirrorSession({
    deviceId,
    options,
    onEvent: (event) => {
      if (event.type === 'close' || event.type === 'error') {
        // Keep the entry alive for a moment so the UI can show the reason.
        broadcast(entry, serializeEvent(deviceId, event))
        return
      }
      broadcast(entry, serializeEvent(deviceId, event))
    },
  })

  sessions.set(deviceId, entry)
  return entry
}

async function startSession(deviceId, options = {}) {
  const id = String(deviceId || '').trim()
  if (!id)
    throw new Error('No device id')

  if (!serverJarPath())
    throw new Error('scrcpy server is missing')

  const existing = sessions.get(id)
  if (existing) {
    if (existing.session.width)
      return { ok: true, width: existing.session.width, height: existing.session.height, reused: true }
    await stopSession(id)
  }

  const entry = createSessionEntry(id, options)
  try {
    const result = await entry.session.start()
    entry.startedAt = Date.now()
    return { ...result, reused: false }
  }
  catch (error) {
    sessions.delete(id)
    await entry.session.stop().catch(() => {})
    throw error
  }
}

export async function stopSession(deviceId) {
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return false
  sessions.delete(deviceId)
  entry.stopping = true
  broadcast(entry, { deviceId, type: 'close', stream: 'all' })
  await entry.session.stop().catch(() => {})
  return true
}

function subscribe(deviceId, callback) {
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return () => {}
  entry.subscribers.add(callback)
  return () => entry.subscribers.delete(callback)
}

/** Attach a renderer window to a session: pushes events over IPC. */
function attachRenderer(deviceId, webContents) {
  if (!webContents)
    return () => {}
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return () => {}
  const callback = (event) => {
    try {
      if (!webContents.isDestroyed?.())
        webContents.send('mirror:event', event)
    }
    catch {}
  }
  entry.subscribers.add(callback)
  const cleanup = () => entry.subscribers.delete(callback)
  webContents.once?.('destroyed', cleanup)
  return cleanup
}

/** Touch injection with normalized (0..1) or absolute coordinates. */
function touch(deviceId, payload) {
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return false
  const width = entry.session.width
  const height = entry.session.height
  if (!width || !height)
    return false
  const x = payload.normalized ? Math.round((Number(payload.x) || 0) * width) : Math.round(Number(payload.x) || 0)
  const y = payload.normalized ? Math.round((Number(payload.y) || 0) * height) : Math.round(Number(payload.y) || 0)
  return entry.session.sendControl({
    type: 2,
    action: payload.action,
    pointerId: payload.pointerId ?? -1,
    x,
    y,
    videoWidth: width,
    videoHeight: height,
    pressure: payload.pressure ?? 1,
  })
}

function key(deviceId, payload) {
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return false
  return entry.session.sendControl({
    type: 0,
    action: payload.action === 'up' ? 1 : 0,
    keyCode: Number(payload.keyCode) || 0,
    repeat: Number(payload.repeat) || 0,
    metaState: Number(payload.metaState) || 0,
  })
}

function text(deviceId, value) {
  const entry = sessions.get(String(deviceId))
  if (!entry || !value)
    return false
  return entry.session.sendControl({ type: 1, text: String(value) })
}

function scroll(deviceId, payload) {
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return false
  const width = entry.session.width
  const height = entry.session.height
  if (!width || !height)
    return false
  return entry.session.sendControl({
    type: 3,
    x: payload.normalized ? Math.round((Number(payload.x) || 0) * width) : Math.round(Number(payload.x) || 0),
    y: payload.normalized ? Math.round((Number(payload.y) || 0) * height) : Math.round(Number(payload.y) || 0),
    videoWidth: width,
    videoHeight: height,
    scrollX: Number(payload.scrollX) || 0,
    scrollY: Number(payload.scrollY) || 0,
  })
}

function clipboard(deviceId, payload = {}) {
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return false
  return entry.session.sendControl({
    type: 9,
    sequence: payload.sequence ?? 0,
    paste: Boolean(payload.paste),
    text: String(payload.text ?? ''),
  })
}

const COMMAND_KEYCODES = {
  'app-switch': ANDROID_KEYCODE.APP_SWITCH,
  'back': ANDROID_KEYCODE.BACK,
  'enter': ANDROID_KEYCODE.ENTER,
  'forward-del': ANDROID_KEYCODE.FORWARD_DEL,
  'home': ANDROID_KEYCODE.HOME,
  'menu': ANDROID_KEYCODE.MENU,
  'move-end': ANDROID_KEYCODE.MOVE_END,
  'move-home': ANDROID_KEYCODE.MOVE_HOME,
  'page-down': ANDROID_KEYCODE.PAGE_DOWN,
  'page-up': ANDROID_KEYCODE.PAGE_UP,
  'power': ANDROID_KEYCODE.POWER,
  'volume-down': ANDROID_KEYCODE.VOLUME_DOWN,
  'volume-up': ANDROID_KEYCODE.VOLUME_UP,
}

function command(deviceId, name, payload = {}) {
  const entry = sessions.get(String(deviceId))
  if (!entry)
    return false
  switch (name) {
    case 'back-or-screen-on':
      return entry.session.sendControl({ type: 4, action: payload.action || 'down' })
    case 'screen-power':
      return entry.session.sendControl({ type: 10, on: payload.on !== false })
    case 'expand-notifications':
      return entry.session.sendControl({ type: 5 })
    case 'expand-settings':
      return entry.session.sendControl({ type: 6 })
    case 'collapse-panel':
      return entry.session.sendControl({ type: 7 })
    case 'rotate':
      return entry.session.sendControl({ type: 11 })
    default: {
      const keyCode = COMMAND_KEYCODES[name]
      if (!keyCode)
        return false
      const down = entry.session.sendControl({ type: 0, action: 0, keyCode, repeat: 0, metaState: 0 })
      entry.session.sendControl({ type: 0, action: 1, keyCode, repeat: 0, metaState: 0 })
      return down
    }
  }
}

// ── keyboard mapping persistence ────────────────────────────────────────────

function keymapStoreKey(deviceId) {
  return `mirror.keymap.${deviceId}`
}

function getKeymap(deviceId) {
  const value = electronStore.get(keymapStoreKey(deviceId))
  if (!value || !Array.isArray(value.profiles))
    return { profiles: [], activeId: null, settings: {} }
  return value
}

function saveKeymap(deviceId, payload) {
  const previous = getKeymap(deviceId)
  const profiles = Array.isArray(payload?.profiles) ? payload.profiles : previous.profiles
  const next = {
    profiles,
    activeId: payload?.activeId ?? previous.activeId,
    settings: { ...previous.settings, ...(payload?.settings || {}) },
  }
  electronStore.set(keymapStoreKey(deviceId), next)
  return next
}

export default {
  name: 'module:mirror:service',
  order: 102,
  apply() {
    const handlers = {
      'mirror:start': async (event, payload) => {
        const deviceId = String(payload?.deviceId || '')
        try {
          const result = await startSession(deviceId, payload?.options)
          attachRenderer(deviceId, event?.sender)
          return { success: true, ...result }
        }
        catch (error) {
          console.warn('[Mirror] start failed:', error?.message ?? error)
          return { success: false, error: { code: 'MIRROR_START', message: error?.message ?? String(error) } }
        }
      },

      'mirror:reset-video': async (_event, payload) => {
        const entry = getSession(String(payload?.deviceId || ''))
        if (!entry)
          return { success: false }
        entry.session.sendControl({ type: 17 })
        return { success: true }
      },

      'mirror:window': async (event, payload) => {
        const win = BrowserWindow.fromWebContents(event?.sender)
        if (!win || win.isDestroyed())
          return { success: false, error: { code: 'MIRROR_WINDOW', message: 'Window not found' } }
        switch (payload?.action) {
          case 'always-on-top':
            win.setAlwaysOnTop(payload.value ?? !win.isAlwaysOnTop())
            return { success: true, value: win.isAlwaysOnTop() }
          case 'fullscreen':
            win.setFullScreen(payload.value ?? !win.isFullScreen())
            return { success: true, value: win.isFullScreen() }
          case 'minimize':
            win.minimize()
            return { success: true }
          case 'close':
            win.close()
            return { success: true }
          default:
            return { success: false }
        }
      },

      'mirror:stop': async (_event, payload) => {
        await stopSession(payload?.deviceId)
        return { success: true }
      },

      'mirror:status': async (_event, payload) => {
        const entry = getSession(String(payload?.deviceId || ''))
        return {
          success: true,
          running: Boolean(entry),
          width: entry?.session.width || 0,
          height: entry?.session.height || 0,
          sessions: listSessions(),
        }
      },

      'mirror:control': async (_event, payload) => {
        const deviceId = payload?.deviceId
        const message = payload?.message || {}
        const entry = getSession(String(deviceId || ''))
        if (!entry)
          return { success: false, error: { code: 'MIRROR_NOT_RUNNING', message: 'Mirror is not running' } }

        switch (message.kind) {
          case 'touch':
            return { success: touch(deviceId, message) }
          case 'key':
            return { success: key(deviceId, message) }
          case 'text':
            return { success: text(deviceId, message.text) }
          case 'scroll':
            return { success: scroll(deviceId, message) }
          case 'clipboard':
            return { success: clipboard(deviceId, message) }
          case 'command':
            return { success: command(deviceId, message.command, message) }
          default:
            return { success: false, error: { code: 'MIRROR_CONTROL', message: `Unknown control kind: ${message.kind}` } }
        }
      },

      'mirror:keymap:get': async (_event, payload) => ({ success: true, ...getKeymap(String(payload?.deviceId || '')) }),

      'mirror:keymap:save': async (_event, payload) => ({
        success: true,
        ...saveKeymap(String(payload?.deviceId || ''), payload),
      }),
    }

    for (const [channel, handler] of Object.entries(handlers))
      ipcxMain.handle(channel, handler)

    return () => {
      for (const channel of Object.keys(handlers))
        ipcxMain.removeHandler?.(channel)
      for (const deviceId of [...sessions.keys()])
        stopSession(deviceId).catch(() => {})
    }
  },

  // Exposed for the web server (SSE streaming) without going through IPC.
  startSession,
  stopSession,
  getSession,
  listSessions,
  subscribe,
  touch,
  key,
  text,
  scroll,
  clipboard,
  command,
  getKeymap,
  saveKeymap,
  META_STATE,
  ANDROID_KEYCODE,
}
