/**
 * Embedded mirror session (内嵌镜像): runs the scrcpy server on the device and
 * pumps raw H.264/Opus packets to the renderer, where WebCodecs decodes them.
 *
 * This is the in-repo counterpart of the paid "wscrcpy" stack: instead of a
 * native scrcpy window, the video is decoded inside the Electron window so the
 * picture can be embedded in our own UI (and in the web UI over SSE).
 *
 * Protocol notes (scrcpy server 4.x, tunnel_forward mode):
 *  - video socket: dummy byte → 64-byte device name → u32 width → u32 height
 *    → u32 codec metadata → packets with a 12-byte header
 *      flags: 0x80 session (new stream), 0x40 configuration (SPS/PPS),
 *             0x20 keyframe
 *      data packet: i64 pts (masked to 61 bits) + u32 length + payload
 *  - audio socket: u32 codec metadata (0 = disabled) → same packet format
 *  - control socket: device-bound control messages (touch/key/text/...)
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getAdb, getScrcpy } from '$electron/configs/which/index.js'
import { extraResolve } from '$electron/process/resources.js'
import { setupEnvPath } from '$electron/process/helper.js'
import { encodeControlMessage, FrameStreamParser } from './protocol.js'

const SERVER_VERSION = '4.1'
const REMOTE_JAR = '/data/local/tmp/scrcpy-server.jar'
const PTS_MASK = 0x1FFFFFFFFFFFFFn

function adbPath() {
  setupEnvPath()
  return getAdb()
}

export function serverJarPath() {
  const candidates = [
    extraResolve('common/scrcpy/scrcpy-server'),
    path.resolve('electron/resources/extra/common/scrcpy/scrcpy-server'),
    path.resolve(process.resourcesPath || '', 'extra/common/scrcpy/scrcpy-server'),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0]
}

export function execFile(file, args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out: ${args.join(' ')}`))
    }, timeout)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0)
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      else
        reject(new Error(stderr.trim() || `Command failed (${code}): ${args.join(' ')}`))
    })
  })
}

function adbArgs(deviceId, args) {
  return ['-s', deviceId, ...args]
}

export class MirrorSession {
  constructor({ deviceId, options = {}, onEvent = () => {} }) {
    this.deviceId = deviceId
    this.options = options
    this.onEvent = onEvent
    this.scid = randomBytes(4).toString('hex')
    this.socketName = `scrcpy_${this.scid}`
    this.child = null
    this.videoSocket = null
    this.audioSocket = null
    this.controlSocket = null
    this.forwardPorts = []
    this.stopped = false
    this.width = 0
    this.height = 0
    this.videoParser = null
    this.audioParser = null
  }

  emit(event) {
    if (this.stopped)
      return
    try {
      this.onEvent(event)
    }
    catch (error) {
      console.error('[Mirror] event handler failed:', error?.message ?? error)
    }
  }

  async pushServer() {
    const jar = serverJarPath()
    if (!fs.existsSync(jar))
      throw new Error(`scrcpy server not found: ${jar}`)
    await execFile(adbPath(), adbArgs(this.deviceId, ['push', jar, REMOTE_JAR]), { timeout: 30000 })
  }

  buildServerArgs() {
    const {
      maxSize = 1080,
      videoBitRate = 8_000_000,
      maxFps = 60,
      videoCodec = 'h264',
      audio = true,
      audioCodec = 'opus',
      audioBitRate = 128_000,
      lockVideoOrientation = -1,
      displayId = 0,
      stayAwake = false,
      showTouches = false,
    } = this.options

    return [
      `scid=${this.scid}`,
      'log_level=info',
      `video_codec=${videoCodec}`,
      `video_bit_rate=${Number(videoBitRate) || 8_000_000}`,
      `max_size=${Number(maxSize) || 1080}`,
      `max_fps=${Number(maxFps) || 60}`,
      `lock_video_orientation=${Number(lockVideoOrientation)}`,
      `display_id=${Number(displayId) || 0}`,
      'tunnel_forward=true',
      `audio=${audio ? 'true' : 'false'}`,
      `audio_codec=${audioCodec}`,
      `audio_bit_rate=${Number(audioBitRate) || 128_000}`,
      'control=true',
      'send_device_meta=true',
      'send_codec_meta=true',
      'send_frame_meta=true',
      'cleanup=true',
      'power_on=true',
      `stay_awake=${stayAwake ? 'true' : 'false'}`,
      `show_touches=${showTouches ? 'true' : 'false'}`,
    ].join(' ')
  }

  async startServer() {
    const adb = adbPath()
    const args = this.buildServerArgs()
    const child = spawn(adb, adbArgs(this.deviceId, [
      'shell',
      `CLASSPATH=${REMOTE_JAR} app_process / com.genymobile.scrcpy.Server ${SERVER_VERSION} ${args}`,
    ]), { stdio: ['ignore', 'pipe', 'pipe'] })

    this.child = child
    let stderr = ''
    let stdout = ''

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`scrcpy server did not start: ${stderr || stdout || 'timeout'}`))
      }, 12000)

      let settled = false
      const settle = () => {
        if (settled)
          return
        settled = true
        cleanup()
        resolve()
      }
      const onStdout = (chunk) => {
        stdout += chunk.toString()
        // The server prints "[server] INFO: Device: [" (or "Listening on …")
        // once it is accepting connections. Any output means it booted.
        if (stdout.trim())
          settle()
      }
      setTimeout(settle, 3000).unref?.()
      const onStderr = (chunk) => {
        stderr += chunk.toString()
      }
      const onExit = (code) => {
        cleanup()
        reject(new Error(`scrcpy server exited (${code}): ${stderr || stdout || 'unknown error'}`))
      }
      function cleanup() {
        clearTimeout(timer)
        child.stdout.off('data', onStdout)
        child.stderr.off('data', onStderr)
        child.off('exit', onExit)
      }
      child.stdout.on('data', onStdout)
      child.stderr.on('data', onStderr)
      child.once('exit', onExit)
      child.once('error', (error) => {
        cleanup()
        reject(error)
      })
    })

    child.stdout.on('data', () => {})
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      if (/ERROR|FATAL/i.test(text))
        this.emit({ type: 'log', level: 'error', message: text })
    })
    child.once('exit', (code) => {
      if (!this.stopped)
        this.emit({ type: 'error', message: `scrcpy server exited (${code})` })
    })
  }

  async forwardPort() {
    const result = await execFile(adbPath(), adbArgs(this.deviceId, [
      'forward', 'tcp:0', `localabstract:${this.socketName}`,
    ]), { timeout: 15000 })
    const port = Number.parseInt(result.stdout, 10)
    if (!Number.isFinite(port) || port <= 0)
      throw new Error(`adb forward failed: ${result.stdout || result.stderr}`)
    this.forwardPorts.push(port)
    return port
  }

  connectSocket(port, { attempts = 12, interval = 350 } = {}) {
    let attempt = 0
    const tryConnect = () => new Promise((resolve, reject) => {
      attempt += 1
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.setNoDelay(true)
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`Timed out connecting to forwarded port ${port}`))
      }, 8000)
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve(socket)
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })

    return new Promise((resolve, reject) => {
      const next = async () => {
        try {
          resolve(await tryConnect())
        }
        catch (error) {
          if (attempt >= attempts)
            reject(new Error(`Could not connect to scrcpy stream: ${error.message}`))
          else
            setTimeout(next, interval)
        }
      }
      next()
    })
  }

  readExact(stream, length) {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0)
      const onData = (chunk) => {
        buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk)
        if (buffer.length >= length) {
          cleanup()
          resolve(buffer)
        }
      }
      const onEnd = () => {
        cleanup()
        reject(new Error('Stream ended while reading metadata'))
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      function cleanup() {
        stream.off('data', onData)
        stream.off('end', onEnd)
        stream.off('error', onError)
      }
      stream.on('data', onData)
      stream.once('end', onEnd)
      stream.once('error', onError)
    })
  }

  async startVideo() {
    const port = await this.forwardPort()
    const socket = await this.connectSocket(port)
    this.videoSocket = socket

    // scrcpy 3.x/4.x device meta: 64-byte device name + u32 codec id.
    // Width/height arrive in the first "session" frame packet instead.
    const metadata = await this.readExact(socket, 68)
    const name = metadata.subarray(0, 64)
    const end = name.indexOf(0)
    const deviceName = name.subarray(0, end === -1 ? 64 : end).toString('utf8')
    const codecValue = metadata.readUInt32BE(64)

    const codec
      = codecValue === 0x68323635
        ? 'h265'
        : codecValue === 0x61763031
          ? 'av01'
          : 'h264'

    this.emit({
      type: 'metadata',
      deviceName,
      width: this.width,
      height: this.height,
      codec,
    })

    this.videoParser = new FrameStreamParser((packet) => {
      if (packet.type === 'session') {
        this.width = packet.width
        this.height = packet.height
      }
      this.emit({ stream: 'video', ...packet })
    })

    socket.on('data', (chunk) => {
      try {
        this.videoParser.push(chunk)
      }
      catch (error) {
        this.emit({ type: 'error', message: error.message })
        this.stop()
      }
    })
    socket.on('end', () => this.emit({ type: 'close', stream: 'video' }))
    socket.on('error', error => this.emit({ type: 'error', message: error.message }))
  }

  async startAudio() {
    const port = await this.forwardPort()
    const guard = new Promise(resolve => setTimeout(() => resolve('timeout'), 6000))
    const socket = await this.connectSocket(port)
    this.audioSocket = socket

    const readHeader = this.readExact(socket, 4)
    readHeader.catch(() => {})
    const header = await Promise.race([readHeader, guard]).catch(() => null)
    if (!header || header === 'timeout') {
      socket.destroy()
      this.audioSocket = null
      this.emit({ type: 'audio-disabled', reason: 'timeout' })
      return
    }
    const codecValue = header.readUInt32BE(0)

    if (codecValue === 0 || codecValue === 1) {
      socket.destroy()
      this.audioSocket = null
      this.emit({ type: 'audio-disabled', reason: codecValue === 0 ? 'unsupported' : 'errored' })
      return
    }

    const codec
      = codecValue === 0x72617720
        ? 'raw'
        : codecValue === 0x61616320
          ? 'aac'
          : 'opus'

    this.audioParser = new FrameStreamParser((packet) => {
      this.emit({ stream: 'audio', ...packet })
    })

    socket.on('data', (chunk) => {
      try {
        this.audioParser.push(chunk)
      }
      catch (error) {
        this.emit({ type: 'error', message: error.message })
      }
    })
    socket.on('end', () => this.emit({ type: 'close', stream: 'audio' }))
    socket.on('error', () => this.emit({ type: 'audio-disabled', reason: 'errored' }))
  }

  async startControl() {
    const port = await this.forwardPort()
    const socket = await this.connectSocket(port)
    this.controlSocket = socket
    socket.on('error', error => this.emit({ type: 'error', message: error.message }))
    socket.on('data', (chunk) => {
      // Device → client messages (clipboard). Best-effort only.
      if (chunk.length >= 9 && chunk[0] === 0) {
        try {
          const length = chunk.readUInt32BE(5)
          if (chunk.length >= 9 + length)
            this.emit({ type: 'device-clipboard', text: chunk.subarray(9, 9 + length).toString('utf8') })
        }
        catch {}
      }
    })
  }

  async start() {
    await this.pushServer()
    await this.startServer()
    await this.startVideo()
    if (this.options.audio !== false)
      await this.startAudio()
    await this.startControl()
    return {
      ok: true,
      width: this.width,
      height: this.height,
      codec: this.options.videoCodec || 'h264',
    }
  }

  sendControl(message) {
    const socket = this.controlSocket
    if (!socket || socket.destroyed)
      return false
    try {
      socket.write(encodeControlMessage(message))
      return true
    }
    catch (error) {
      this.emit({ type: 'error', message: error.message })
      return false
    }
  }

  async stop() {
    if (this.stopped)
      return
    this.stopped = true

    for (const socket of [this.videoSocket, this.audioSocket, this.controlSocket]) {
      try {
        socket?.destroy()
      }
      catch {}
    }
    this.videoSocket = null
    this.audioSocket = null
    this.controlSocket = null

    if (this.child && !this.child.killed) {
      try {
        this.child.kill()
      }
      catch {}
    }
    this.child = null

    const ports = this.forwardPorts
    this.forwardPorts = []
    for (const port of ports) {
      try {
        await execFile(adbPath(), adbArgs(this.deviceId, ['forward', '--remove', `tcp:${port}`]), { timeout: 5000 })
      }
      catch {}
    }
  }
}

/**
 * List the device's displays (`scrcpy --list-displays`), so the UI can offer
 * 多屏协同: one mirror window per display.
 */
export async function listDisplays(deviceId) {
  setupEnvPath()
  const scrcpy = getScrcpy()
  if (!scrcpy)
    return []
  try {
    const { stdout } = await execFile(scrcpy, ['--serial', deviceId, '--list-displays'], { timeout: 15000 })
    return parseDisplays(stdout)
  }
  catch (error) {
    console.warn('[Mirror] list displays failed:', error?.message ?? error)
    return []
  }
}

export function parseDisplays(text) {
  const displays = []
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/--display-id=(\d+)\s+\(([^)]+)\)/)
    if (!match)
      continue
    const display = { id: Number.parseInt(match[1], 10), resolution: match[2] === 'size unknown' ? '' : match[2] }
    displays.push(display)
  }
  return displays
}

export function getServerVersion() {
  return SERVER_VERSION
}
