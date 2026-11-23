import fs from 'node:fs'
import path from 'node:path'
import { desktopPath, yadbPath } from '$electron/configs/index.js'
import electronStore from '$electron/helpers/store/index.js'
import { Adb } from '@devicefarmer/adbkit'
import { createAdbx } from '@escrcpy/adbx'
import pLimit from 'p-limit'
import dayjs from 'dayjs'
import { ProcessManager } from '$electron/process/manager.js'
import { sheller } from '$electron/helpers/shell/index.js'
import { parseBatteryDump } from './helpers/battery/index.js'
import { ADBDownloader } from './helpers/downloader/index.js'
import adbScanner, { MDNS_CONFIG, probeDeviceCandidates, scanMdnsDevices } from './helpers/scanner/index.js'
import { ADBUploader } from './helpers/uploader/index.js'
import { electronAPI } from '@electron-toolkit/preload'
import { readDirWithStat } from './helpers/explorer/index.js'
import { setupEnvPath } from '$electron/process/helper.js'
import { filterConnectedDevices } from './helpers/index.js'

const processManager = new ProcessManager()

let client = null
let adbx = null

export function getAdbx() {
  if (!adbx) {
    throw new Error('ADB middleware has not been initialized')
  }

  return adbx
}

electronAPI.ipcRenderer.on('quit-before', () => {
  client?.kill?.()
  processManager.kill()
})

electronStore.onDidChange('common.adbDir', async (...args) => {
  const [value, oldValue] = args

  if (value === oldValue) {
    return false
  }

  try {
    await client?.kill?.()
    await processManager.kill()
  }
  catch (error) {
    console.warn(error.message)
  }

  init()
})

function normalizeAdbError(error) {
  const message = error?.stderr || error?.message
  throw new Error(message)
}

async function shell(command) {
  const adbProcess = sheller(`adb ${command}`, {
    shell: true,
    encoding: 'utf8',
  })

  processManager.add(adbProcess)

  const promise = adbProcess.catch(normalizeAdbError)

  return Object.assign(adbProcess, {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  })
}

async function deviceShell(id, command) {
  return getAdbx().shell(id, command)
}

async function kill(...params) {
  return client.kill(...params)
}

async function getDeviceIP(id) {
  try {
    const { stdout } = await shell(`-s ${id} shell ip -f inet addr show wlan0`)
    const reg = /inet ([0-9.]+)\/\d+/
    const match = stdout.match(reg)
    const value = match[1]

    return value
  }
  catch (error) {
    console.warn('adb.getDeviceIP.error', error.message)
  }
}

async function tcpip(id, port = 5555) {
  return client.getDevice(id).tcpip(port)
}

async function screencap(deviceId, options = {}) {
  const { returnBase64 = false } = options

  const screenshot = await getAdbx().screenshot.capture(deviceId)

  if (returnBase64) {
    return screenshot.toString('base64')
  }

  const fileName = `Screencap-${dayjs().format('YYYY-MM-DD-HH-mm-ss')}.png`
  const savePath = options.savePath || path.join(electronStore.get('common.saveDir') || desktopPath, fileName)

  await fs.promises.writeFile(savePath, screenshot)
  return true
}

async function install(id, path) {
  return getAdbx().install(id, path)
}

async function uninstall(id, path) {
  return getAdbx().uninstall(id, path)
}

async function isInstalled(id, pkg) {
  return getAdbx().isInstalled(id, pkg)
}

async function version() {
  return client.version()
}

async function watch(callback) {
  // Robust device tracker:
  //  - forwards 'change' events too (state flips like device⇄offline arrive
  //    as 'change', NOT as add/remove — dropping them left the UI showing
  //    a stale "offline" device until the user physically replugged it)
  //  - reconnects automatically when the tracker stream ends or errors
  //    (adb daemon restart, transient socket failure) instead of going
  //    permanently deaf
  let closed = false
  let tracker = null
  let reconnectAttempt = 0
  let reconnectTimer = null

  function scheduleReconnect() {
    if (closed || reconnectTimer)
      return

    reconnectAttempt++
    const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempt, 4), 15000)
    console.warn(`[ADB] device tracker lost (attempt #${reconnectAttempt}), reconnecting in ${delay}ms`)

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null
      if (closed)
        return

      try {
        tracker = await client.trackDevices()
        reconnectAttempt = 0
        attach()
        console.log('[ADB] device tracker reconnected')
      }
      catch (error) {
        console.warn('[ADB] tracker reconnect failed:', error?.message ?? error)
        scheduleReconnect()
      }
    }, delay)
  }

  function attach() {
    tracker.on('add', ret => callback('add', ret))
    tracker.on('change', ret => callback('change', ret))
    tracker.on('remove', (device) => {
      callback('remove', device)
    })
    tracker.on('end', () => {
      if (closed)
        return
      callback('end', {})
      scheduleReconnect()
    })
    tracker.on('error', (err) => {
      if (closed)
        return
      callback('error', err)
      // ending the tracker triggers the 'end' handler above → reconnect
      try {
        tracker?.end?.()
      }
      catch {
        scheduleReconnect()
      }
    })
  }

  tracker = await client.trackDevices()
  attach()

  return () => {
    closed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    try {
      tracker?.end?.()
    }
    catch {}
  }
}

async function readdir(id, currentPath) {
  const device = await client.getDevice(id)

  const value = await readDirWithStat(device, currentPath)

  return value
}

async function push(id, filePath, args = {}) {
  const { progress, saveDir = '/sdcard/Download' } = args

  const fileName = path.basename(filePath)

  const fullSavePath = `${saveDir}/${fileName}`.replace(/\/+/g, '/')

  const transfer = await client.getDevice(id).push(filePath, fullSavePath)

  return new Promise((resolve, reject) => {
    transfer.on('progress', (stats) => {
      progress?.(stats)
    })

    transfer.on('end', () => {
      resolve(fullSavePath)
    })

    transfer.on('error', (err) => {
      reject(err)
    })
  })
}

async function pull(id, filePath, args = {}) {
  const { progress, saveDir = '../' } = args

  const fileName = path.basename(filePath)

  const fullSavePath = path.resolve(saveDir, fileName)

  const transfer = await client.getDevice(id).pull(filePath)

  return new Promise((resolve, reject) => {
    transfer.on('progress', (stats) => {
      progress?.(stats)
    })

    transfer.on('end', () => {
      resolve(fullSavePath)
    })

    transfer.on('error', (err) => {
      reject(err)
    })

    transfer.pipe(fs.createWriteStream(fullSavePath))
  })
}

async function scannerConnect(password, options = {}) {
  return adbScanner.connect({
    password,
    adb: {
      pair,
      connect,
      shell,
    },
    ...options,
  })
}

async function discoverConnect(options = {}) {
  const {
    timeout = MDNS_CONFIG.DISCOVER_TIMEOUT,
    probeTimeout = MDNS_CONFIG.PROBE_TIMEOUT,
    ports = MDNS_CONFIG.DEFAULT_PROBE_PORTS,
    concurrency = Number(electronStore.get('common.concurrencyLimit') ?? 5),
    excludeConnected = true,
    onStatus = () => {},
    onDevice = () => {},
  } = options

  const devices = await scanMdnsDevices({
    timeout,
    onStatus,
    onDevice,
  })

  if (!devices.length) {
    return {
      success: false,
      errorCode: 'NO_DEVICES',
      error: 'No wireless debugging devices discovered',
      devices: [],
      results: [],
    }
  }

  const reachableDevices = await probeDeviceCandidates(devices, {
    ports,
    timeout: probeTimeout,
    concurrency,
    onStatus,
    onDevice,
  })

  if (!reachableDevices.length) {
    onStatus('unreachable')

    return {
      success: false,
      errorCode: 'NO_REACHABLE_DEVICES',
      error: 'No reachable ADB ports discovered',
      devices,
      results: [],
    }
  }

  const connectableDevices = await filterConnectedDevices(reachableDevices, {
    client,
    excludeConnected,
  })

  if (!connectableDevices.length) {
    onStatus('connected')

    return {
      success: false,
      errorCode: 'NO_UNCONNECTED_DEVICES',
      error: 'Discovered devices are already connected',
      devices,
      results: [],
    }
  }

  const limit = pLimit(concurrency)
  const results = await Promise.all(
    connectableDevices.map(device =>
      limit(async () => {
        onStatus('connecting', device)

        try {
          const message = await connect(device.address, device.port)
          const result = {
            ...device,
            success: true,
            message,
          }

          onStatus('connected', result)

          return result
        }
        catch (error) {
          const result = {
            ...device,
            success: false,
            message: error?.message || error?.cause?.message || error,
          }

          onStatus('connect-error', result)

          return result
        }
      }),
    ),
  )

  const success = results.some(item => item.success)

  if (!success) {
    onStatus('error')
  }

  return {
    success,
    errorCode: success ? undefined : 'NO_CONNECTED_DEVICES',
    error: success ? undefined : 'Failed to connect discovered devices',
    devices,
    results,
  }
}

async function battery(id) {
  const res = await deviceShell(id, 'dumpsys battery')

  const value = parseBatteryDump(res)

  return value
}

async function pair(host, port, code) {
  const address = port ? `${host}:${port}` : host

  const { stderr, stdout } = await shell(`pair ${address} ${code}`)

  if (stderr) {
    throw stderr
  }

  return stdout
}

async function connect(host, port) {
  const address = port ? `${host}:${port}` : host

  const { stderr, stdout } = await shell(`connect ${address}`)

  if (stderr) {
    throw stderr
  }

  const errorKeys = ['cannot', 'failed']

  if (errorKeys.some(item => stdout.includes(item))) {
    throw stdout
  }

  return stdout
}

async function disconnect(host, port) {
  const address = port ? `${host}:${port}` : host

  const { stderr, stdout } = await shell(`disconnect ${address}`)

  if (stderr) {
    throw stderr
  }

  return stdout
}

function uploader(options = {}) {
  const { deviceId, localPaths, remotePath = '/sdcard/Download', ...initialOptions } = options

  const uploader = new ADBUploader({
    adb: client,
    onError: (error, file) => {
      console.error(`Error uploading ${file}:`, error)
    },
    ...initialOptions,
  })

  return {
    context: uploader,
    start: () => uploader.uploadTo(
      remotePath,
      localPaths,
      deviceId,
    ),
    cancel: () => uploader.cancel(),
  }
}

function downloader(options = {}) {
  const { deviceId, items, localPath, ...initialOptions } = options

  const downloaderInstance = new ADBDownloader({
    adb: client,
    onError: (error, file) => {
      console.error(`Error downloading ${file}:`, error)
    },
    ...initialOptions,
  })

  return {
    context: downloaderInstance,
    start: () => downloaderInstance.downloadTo(deviceId, items, localPath),
    preview: () => downloaderInstance.previewTasks(deviceId, items),
    cancel: () => downloaderInstance.cancel(),
  }
}

async function waitForDevice(id) {
  const device = client.getDevice(id)

  return device.waitForDevice()
}

async function getSerialNo(id) {
  let value = id

  try {
    value = await getAdbx().deviceInfo.serialNo(id)
  }
  catch (error) {
    console.error('getSerialNo.error', error?.message || error)
  }

  return value
}

async function getScreenSize(id) {
  try {
    return await getAdbx().deviceInfo.getScreenSize(id)
  }
  catch (error) {
    console.error('getScreenSize.error', error?.message || error)
  }

  return null
}

async function getDeviceList() {
  const listDevicesWithPaths = await client.listDevicesWithPaths()
  const devices = listDevicesWithPaths.filter(item => !['offline'].includes(item.type))

  // Offline devices cannot be used, but they CAN usually be recovered without
  // replugging — kick adb as soon as we notice one (rate-limited).
  recoverOfflineDevices(listDevicesWithPaths)

  const concurrencyLimit = Number(electronStore.get('common.concurrencyLimit') ?? 10)
  const limit = pLimit(concurrencyLimit)

  const value = await Promise.all(
    devices.map(item =>
      limit(async () => {
        const [serialNo, screenSize] = await Promise.all([
          getSerialNo(item.id),
          getScreenSize(item.id),
        ])
        return {
          ...item,
          serialNo,
          screenWidth: screenSize?.width ?? null,
          screenHeight: screenSize?.height ?? null,
        }
      }),
    ),
  )

  return value
}

/**
 * Lightweight device snapshot for polling: no enrichment shell calls, just
 * id + state. Used by the renderer to detect state flips without hammering
 * the device with getprop/wm size round-trips every few seconds.
 */
async function getRawDeviceList() {
  const devices = await client.listDevices()
  return devices.map(device => ({ id: device.id, type: device.type }))
}

// ── offline self-healing ────────────────────────────────────
let lastOfflineRecoveryAt = 0
const OFFLINE_RECOVERY_INTERVAL_MS = 15_000

// Escalation state: how many consecutive recovery rounds a device has stayed
// offline through, and when the daemon was last restarted. `adb reconnect`
// cannot fix a zombie adb server; after a few failed rounds we restart the
// daemon itself (with a long cooldown so we never thrash).
let offlineStreaks = new Map()
let lastKillServerAt = 0
const KILL_SERVER_COOLDOWN_MS = 5 * 60 * 1000

/**
 * When adb reports a device as `offline` the connection is usually just
 * desynchronised (USB hiccup, device slept). `adb reconnect offline` asks the
 * daemon to re-handshake — historically users had to physically unplug and
 * replug the device to recover from this state.
 */
async function recoverOfflineDevices(devices) {
  const offline = (devices || []).filter(device => device.type === 'offline')

  if (!offline.length) {
    offlineStreaks.clear()
    return false
  }

  if (Date.now() - lastOfflineRecoveryAt < OFFLINE_RECOVERY_INTERVAL_MS)
    return false

  lastOfflineRecoveryAt = Date.now()

  console.log(`[ADB] ${offline.length} offline device(s) detected (${offline.map(d => d.id).join(', ')}), running "adb reconnect offline"`)

  try {
    await shell('reconnect offline')
  }
  catch (error) {
    console.warn('[ADB] reconnect offline failed:', error?.message ?? error)
  }

  // Escalation: if the same devices keep coming back offline across recovery
  // rounds, the adb daemon itself is wedged. Restart it once (cooldown 5min);
  // the tracker reconnect logic picks the socket back up automatically.
  for (const device of offline) {
    const streak = (offlineStreaks.get(device.id) || 0) + 1
    offlineStreaks.set(device.id, streak)
  }

  const worst = Math.max(...[...offlineStreaks.values()])
  if (worst >= 3 && Date.now() - lastKillServerAt > KILL_SERVER_COOLDOWN_MS) {
    lastKillServerAt = Date.now()
    offlineStreaks.clear()

    console.warn('[ADB] devices stuck offline after repeated reconnects, restarting adb server')

    try {
      await shell('kill-server')
      // adbkit reconnects lazily on the next command; give the daemon a beat
      // before the health check's next listDevices() spins it up again.
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    catch (error) {
      console.warn('[ADB] kill-server failed:', error?.message ?? error)
    }
  }

  return true
}

/**
 * Periodic device health check: catches offline flips even when no window is
 * listening to the tracker (e.g. app minimized to tray with scheduled tasks).
 */
function startDeviceHealthCheck() {
  const timer = setInterval(async () => {
    try {
      const devices = await client.listDevices()
      await recoverOfflineDevices(devices)
    }
    catch {
      // adb daemon hiccup — the tracker reconnect logic handles the socket
    }
  }, 10_000)

  // Don't keep the process alive just for this interval (should not matter
  // inside Electron, but be a good citizen anyway).
  if (typeof timer.unref === 'function')
    timer.unref()

  return timer
}

let deviceHealthTimer = null

function init() {
  // Setup the PATH environment variable by injecting necessary tool paths
  setupEnvPath()

  client = Adb.createClient()

  adbx = createAdbx({
    adb: client,
    yadbPath,
  })

  if (!deviceHealthTimer)
    deviceHealthTimer = startDeviceHealthCheck()
}

async function killProcesses() {
  return processManager.kill()
}

/** Device input primitives backed by adbx (yadb when available, e.g. non-ASCII text input). */
const input = {
  tap: (id, x, y) => getAdbx().input.tap(id, x, y),
  swipe: (id, x1, y1, x2, y2, duration) => getAdbx().input.swipe(id, x1, y1, x2, y2, duration),
  longPress: (id, x, y, duration) => getAdbx().input.longPress(id, x, y, duration),
  drag: (id, x1, y1, x2, y2, duration) => getAdbx().input.drag(id, x1, y1, x2, y2, duration),
  text: (id, text) => getAdbx().input.text(id, text),
  key: (id, keyCode) => getAdbx().input.key(id, keyCode),
}

/** Dump the current UI hierarchy XML for AI screen understanding. */
function uiDump(id) {
  return getAdbx().ui.dumpLayout(id)
}

const deviceInfo = {
  getScreenSize: id => getAdbx().deviceInfo.getScreenSize(id),
  battery: id => getAdbx().deviceInfo.battery(id),
  getProperty: (id, prop) => getAdbx().deviceInfo.getProperty(id, prop),
  getBatteryLevel: id => getAdbx().deviceInfo.getBatteryLevel(id),
}

const clipboard = {
  read: id => getAdbx().clipboard.read(id),
  write: (id, text) => getAdbx().clipboard.write(id, text),
}

export default {
  shell,
  init,
  getScreenSize,
  getDeviceList,
  getRawDeviceList,
  deviceShell,
  kill,
  pair,
  connect,
  disconnect,
  getDeviceIP,
  tcpip,
  screencap,
  install,
  uninstall,
  isInstalled,
  version,
  push,
  pull,
  watch,
  readdir,
  scannerConnect,
  discoverConnect,
  battery,
  uploader,
  downloader,
  waitForDevice,
  getSerialNo,
  killProcesses,
  input,
  uiDump,
  deviceInfo,
  clipboard,
}
