#!/usr/bin/env node
/**
 * E2E fake ADB server.
 *
 * Implements the adb client↔server wire protocol on 127.0.0.1:5037 so the
 * app's bundled adbkit client sees a fully functional Android device without
 * a real adb daemon, USB device or emulator.
 *
 * What it implements (the exact surface the app uses):
 *   - host:version / host:devices / host:devices-l / host:track-devices
 *     (tracker connections get an initial frame plus a frame on every state
 *     change — adbkit turns those into add/change/remove events)
 *   - host:features
 *   - host:transport:<serial> then, on the same socket:
 *       - shell:<command>      (v1 shell: OKAY + raw stream, EOF on end)
 *       - sync:                (binary SEND/DATA/DONE used by adbkit push —
 *                               enough for the yadb binary upload)
 *   - a canned Android shell environment: getprop, wm size, dumpsys battery,
 *     screencap -p (real PNG), input/am/monkey, yadb app_process commands,
 *     uiautomator dump, focused window, etc.
 *
 * Control API (HTTP on 127.0.0.1:5038) — used by the test runner:
 *   GET  /state                    current { serial: type } map
 *   POST /state       { serial, type }   set state, push change to trackers
 *   POST /add         { serial }         device appears
 *   POST /remove      { serial }         device disappears (unplug)
 *   POST /shell-canned { match, output, times }  one-shot canned output
 *   GET  /calls                       every shell command we executed
 *   GET  /sync-received               sync push stats (yadb upload count)
 *   POST /reset                       clear calls / canned outputs
 *
 * The fake `adb` CLI (tests/e2e/fake-adb-bin/adb) forwards host-level
 * commands (`adb reconnect offline`, `adb -s X shell ...`) here, so the
 * app's child-process code path is exercised too.
 */
import net from 'node:net'
import http from 'node:http'
import zlib from 'node:zlib'

const ADB_PORT = Number(process.env.FAKE_ADB_PORT || 5037)
const CTRL_PORT = Number(process.env.FAKE_ADB_CTRL_PORT || 5038)

// ── simulated device ──────────────────────────────────────────
const SERIAL = process.env.FAKE_ADB_SERIAL || 'E2ETEST001'
const devices = new Map([[SERIAL, 'device']]) // serial -> device|offline|unauthorized
const trackerSockets = new Set()
const calls = [] // { t, serial, command }
const canned = [] // { match: RegExp, output: String, times: Number }
const syncStats = { pushes: 0, bytes: 0 }
const state = {
  // mutable "device" facts the canned shell answers read from
  batteryLevel: 88,
  focusedApp: 'com.android.settings/com.android.settings.Settings',
  installedPackages: ['com.android.settings', 'com.android.chrome', 'com.example.e2e'],
}

// ── adb wire helpers ──────────────────────────────────────────
const OKAY = Buffer.from('OKAY')
const FAIL = Buffer.from('FAIL')

function frame(text) {
  const body = Buffer.from(text)
  return Buffer.concat([Buffer.from(body.length.toString(16).padStart(4, '0')), body])
}

function devicesPayload() {
  return [...devices.entries()].map(([id, type]) => `${id}\t${type}\n`).join('')
}

function devicesLPayload() {
  // real `adb devices -l` row format (whitespace-separated columns; the
  // product/model/device columns carry a `key:` prefix). The app derives the
  // device display name from product via `split(':')[1]`.
  return [...devices.entries()]
    .map(([id, type]) => `${id}\t${type}\tusb:1-1\tproduct:FakePhone\tmodel:FakePhone_X20\tdevice:e2e\ttransport_id:1\n`)
    .join('')
}

// ── minimal real PNG (so screencap returns a decodable image) ──
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++)
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Build a small solid-colour PNG (RGB, 8-bit, no interlace). */
function makePng(width = 64, height = 96, rgb = [40, 44, 52]) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).fill(rgb)])
  const raw = Buffer.concat(Array(height).fill(row))
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const SCREENSHOT_PNG = makePng()

// ── v1 shell CRLF mangling ────────────────────────────────────
// A real adb server pipes `shell:` output through a pty-like stage that
// turns every 0x0A into 0x0D 0x0A — including binary data (the famous
// `adb shell screencap -p` corruption). adbkit's LineTransform reverses
// this losslessly (its savedR logic keeps a lone CR that is followed by
// another CR). Emulating the mangling here is what makes adbkit's
// screencap() probe + transform produce a byte-exact PNG again.
const CR = Buffer.from([0x0D])

function mangleCRLF(data) {
  if (Buffer.isBuffer(data)) {
    if (!data.includes(0x0A))
      return data
    const parts = []
    let start = 0
    for (let i = 0; i < data.length; i++) {
      if (data[i] === 0x0A) {
        parts.push(data.subarray(start, i), CR)
        start = i
      }
    }
    parts.push(data.subarray(start))
    return Buffer.concat(parts)
  }
  return Buffer.from(String(data).replace(/\n/g, '\r\n'))
}

// ── simulated Android shell ───────────────────────────────────
const UI_XML = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
  '<hierarchy rotation="0">',
  '  <node bounds="[0,0][1080,2400]" resource-id="" class="android.widget.FrameLayout" package="com.android.settings" content-desc="">',
  '    <node bounds="[40,200][1040,320]" resource-id="android:id/title" class="android.widget.TextView" text="Settings" clickable="false" package="com.android.settings"/>',
  '    <node bounds="[40,400][1040,560]" resource-id="com.android.settings:id/search" class="android.widget.EditText" text="Search settings" clickable="true" package="com.android.settings"/>',
  '    <node bounds="[40,700][1040,860]" resource-id="com.android.settings:id/display" class="android.widget.LinearLayout" text="Display" clickable="true" package="com.android.settings"/>',
  '    <node bounds="[40,900][1040,1060]" resource-id="com.android.settings:id/battery" class="android.widget.LinearLayout" text="Battery" clickable="true" package="com.android.settings"/>',
  '  </node>',
  '</hierarchy>',
].join('\n')

const PROPS = {
  'ro.product.model': 'FakePhone X20',
  'ro.product.brand': 'FakePhone',
  'ro.product.manufacturer': 'FakePhone Inc.',
  'ro.product.device': 'e2e',
  'ro.build.version.release': '14',
  'ro.build.version.sdk': '34',
  'ro.serialno': SERIAL,
  'ro.build.display.id': 'E2E.20261120',
}

function shellAnswer(serial, command) {
  calls.push({ t: Date.now(), serial, command })

  // one-shot canned outputs win (test-injected)
  for (let i = 0; i < canned.length; i++) {
    const c = canned[i]
    if (c.match.test(command)) {
      c.times--
      const output = c.output
      if (c.times <= 0)
        canned.splice(i, 1)
      return output
    }
  }

  const cmd = command.trim()

  // yadb app_process bridge (what adbx uses when yadb is available)
  if (cmd.startsWith('app_process') && cmd.includes('com.ysbing.yadb.Main')) {
    if (cmd.includes('-layout'))
      return '' // writes /data/local/tmp/yadb_layout_dump.xml (read back via cat below)
    if (cmd.includes('-readClipboard'))
      return 'e2e-clipboard-content'
    return '' // -touch/-swipe/-keyboard/-writeClipboard → silent success
  }

  // adbkit's screencap() sends `shell:echo && screencap -p 2>/dev/null`:
  // the `echo` emits a leading LF (mangled to CRLF) which adbkit probes
  // to decide the transform mode, then the PNG follows.
  if (cmd.includes('screencap'))
    return Buffer.concat([Buffer.from([0x0A]), SCREENSHOT_PNG])
  if (cmd.startsWith('cat /data/local/tmp/yadb_layout_dump.xml'))
    return UI_XML
  if (cmd.startsWith('rm -f '))
    return ''
  if (cmd.startsWith('uiautomator dump'))
    return `UI hierchary dumped to: /dev/tty\n${UI_XML}`
  if (cmd.startsWith('getprop ')) {
    const prop = cmd.slice('getprop '.length).trim()
    if (prop.includes(' ') || !prop)
      return Object.entries(PROPS).map(([k, v]) => `[${k}]: [${v}]`).join('\n')
    return PROPS[prop] ?? ''
  }
  if (cmd === 'wm size')
    return 'Physical size: 1080x2400\nOverride size: 1080x2400'
  if (cmd === 'wm density')
    return 'Physical density: 420'
  if (cmd.startsWith('dumpsys battery')) {
    return [
      'Current Battery Service state:',
      '  AC powered: true',
      '  USB powered: true',
      '  Wireless powered: false',
      '  Max charging current: 500000',
      '  Charge counter: 2000000',
      `  level: ${state.batteryLevel}`,
      '  scale: 100',
      '  status: 2',
      '  health: 2',
      '  voltage: 4200',
      '  temperature: 250',
      '  technology: Li-ion',
    ].join('\n')
  }
  if (cmd.includes('mCurrentFocus') || cmd.includes('dumpsys window'))
    return `  mCurrentFocus=Window{e2e1 ${state.focusedApp}}`
  if (cmd.startsWith('input '))
    return '' // tap/swipe/key — silent success
  if (cmd.startsWith('am force-stop'))
    return ''
  if (cmd.startsWith('screenrecord'))
    return ''
  if (cmd.startsWith('pm install'))
    return 'Success'
  if (cmd.startsWith('pm uninstall'))
    return 'Success'
  if (cmd.startsWith('am start'))
    return 'Starting: Intent { cmp=android/com.android.internal.app.ResolverActivity }'
  if (cmd.startsWith('monkey '))
    return (
      '  Events injected: 1'
      + '\n## Network stats elapsed time: 12ms'
    )
  if (cmd.startsWith('pm list packages'))
    return state.installedPackages.map(p => `package:${p}`).join('\n')
  if (cmd.startsWith('settings get '))
    return 'e2e-setting-value'
  if (cmd.startsWith('ip -f inet addr show'))
    return '8: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc...\n    inet 192.168.7.42/24 brd 192.168.7.255 scope global wlan0'
  if (cmd.startsWith('echo '))
    return cmd.slice(5)
  if (cmd.startsWith('svc ') || cmd.startsWith('am broadcast'))
    return ''
  if (cmd === 'id' || cmd.startsWith('id '))
    return 'uid=2000(shell) gid=2000(shell) groups=2000(shell)'
  if (cmd.startsWith('ls'))
    return 'sdcard\ndata\nproc\nsys'
  if (cmd.startsWith('cat /proc') || cmd.startsWith('cat /sys'))
    return 'e2e'
  if (cmd.includes('dumpsys display'))
    return 'mBaseDisplayInfo=DisplayInfo{... real 1080 x 2400 ...}'
  if (cmd.startsWith('dumpsys cpuinfo'))
    return 'CPU usage from 0% to 5%'

  console.warn(`[fake-adb] unmocked shell command: ${cmd}`)
  return ''
}

// ── adb wire protocol server ──────────────────────────────────
function pushToTrackers() {
  const payload = frame(devicesPayload())
  for (const socket of trackerSockets) {
    try {
      socket.write(payload)
    }
    catch {
      trackerSockets.delete(socket)
    }
  }
}

const adbServer = net.createServer((socket) => {
  socket.setNoDelay(true)

  let mode = 'service' // service | transported | sync
  let serial = null
  let buffer = Buffer.alloc(0)

  function fail(message) {
    socket.write(FAIL)
    socket.write(frame(message || 'closed'))
    socket.end()
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    if (mode === 'sync') {
      handleSync()
      return
    }

    // service / transported modes speak the length-prefixed text protocol
    for (;;) {
      if (buffer.length < 4)
        return
      const len = Number.parseInt(buffer.subarray(0, 4).toString('ascii'), 16)
      if (!Number.isFinite(len) || len < 0 || len > 65536) {
        fail('bad hex length')
        return
      }
      if (buffer.length < 4 + len)
        return
      const request = buffer.subarray(4, 4 + len).toString('utf8')
      buffer = buffer.subarray(4 + len)
      handleService(request)
      if (mode === 'sync')
        return // remaining bytes are binary sync frames
    }
  })

  function handleService(request) {
    if (request === 'host:version') {
      socket.write(OKAY)
      socket.write(frame('0024')) // protocol version 36
      return
    }

    if (request === 'host:devices' || request === 'host:devices-l') {
      socket.write(OKAY)
      socket.write(frame(request === 'host:devices' ? devicesPayload() : devicesLPayload()))
      socket.end()
      return
    }

    if (request === 'host:track-devices') {
      socket.write(OKAY)
      socket.write(frame(devicesPayload()))
      trackerSockets.add(socket)
      socket.on('close', () => trackerSockets.delete(socket))
      return
    }

    if (request === 'host:features') {
      socket.write(OKAY)
      socket.write(frame('shell_v2,cmd,stat_v2,ls_v2,fixed_push_mkdir,apex,abb,remount_shell,track_app,sendrecv_v2,abb_exec,mdns'))
      return
    }

    if (request === 'host:kill') {
      socket.write(OKAY)
      socket.end()
      adbServer.close()
      return
    }

    if (request.startsWith('host:transport:')) {
      const target = request.slice('host:transport:'.length)
      if (!devices.has(target)) {
        fail(`device '${target}' not found`)
        return
      }
      serial = target
      mode = 'transported'
      socket.write(OKAY)
      return
    }

    // device-level services (after transport)
    if (mode === 'transported' && request.startsWith('shell:')) {
      const command = request.slice('shell:'.length)
      socket.write(OKAY)
      const answer = shellAnswer(serial, command)
      const payload = mangleCRLF(Buffer.isBuffer(answer) ? answer : Buffer.from(String(answer)))
      socket.write(payload)
      socket.end() // v1 shell: EOF marks end of output
      return
    }

    if (mode === 'transported' && request === 'sync:') {
      socket.write(OKAY)
      mode = 'sync'
      return
    }

    if (request.startsWith('host:reconnect') || request.startsWith('host:')) {
      // host:reconnect-offline etc. are CLI-side concepts; acknowledge
      socket.write(OKAY)
      socket.end()
      return
    }

    fail(`unknown service: ${request}`)
  }

  // binary sync protocol (adbkit push): SEND path,mode | DATA… | DONE mtime
  function handleSync() {
    for (;;) {
      if (buffer.length < 8)
        return
      const cmd = buffer.subarray(0, 4).toString('ascii')

      // DONE carries a timestamp (not a length) — the push is finished
      if (cmd === 'DONE') {
        buffer = buffer.subarray(8)
        syncStats.pushes++
        const resp = Buffer.alloc(8)
        resp.write('OKAY', 0, 'ascii')
        resp.writeUInt32LE(0, 4)
        socket.write(resp)
        socket.end()
        mode = 'transported'
        return
      }

      const len = buffer.readUInt32LE(4)
      if (buffer.length < 8 + len)
        return
      const data = buffer.subarray(8, 8 + len)
      buffer = buffer.subarray(8 + len)

      // RECV:<path> — a pull request (adbkit Sync.pull). Stream fake payload
      // bytes as one DATA frame, then DONE to finish, so record-step pulls
      // and any /sdcard reads succeed end-to-end in e2e.
      if (cmd === 'RECV') {
        const payload = Buffer.from('FAKE-ADB-PULL-PAYLOAD')
        const dataFrame = Buffer.alloc(8 + payload.length)
        dataFrame.write('DATA', 0, 'ascii')
        dataFrame.writeUInt32LE(payload.length, 4)
        payload.copy(dataFrame, 8)
        const doneFrame = Buffer.alloc(8)
        doneFrame.write('DONE', 0, 'ascii')
        doneFrame.writeUInt32LE(0, 4)
        socket.write(Buffer.concat([dataFrame, doneFrame]))
        socket.end()
        mode = 'transported'
        return
      }

      if (cmd === 'SEND') {
        // path,mode — a push begins; wait for DATA/DONE frames
      }
      else if (cmd === 'DATA') {
        syncStats.bytes += data.length
      }
      else if (cmd === 'QUIT') {
        socket.end()
        return
      }
      else {
        const resp = Buffer.alloc(8)
        resp.write('FAIL', 0, 'ascii')
        resp.writeUInt32LE(0, 4)
        socket.write(resp)
        socket.end()
        return
      }
    }
  }

  socket.on('error', err => console.warn('[fake-adb] socket error:', err.message))
})

adbServer.on('error', (err) => {
  console.error('[fake-adb] FATAL server error:', err)
  process.exit(1)
})

adbServer.listen(ADB_PORT, '127.0.0.1', () => {
  console.log(`[fake-adb] wire server on 127.0.0.1:${ADB_PORT}, device ${SERIAL} online`)
})

// ── control API ───────────────────────────────────────────────
const control = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${CTRL_PORT}`)
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : {}
    let result = { ok: true }

    try {
      if (req.method === 'GET' && url.pathname === '/state') {
        result = { devices: Object.fromEntries(devices), syncStats, callsCount: calls.length }
      }
      else if (req.method === 'POST' && url.pathname === '/state') {
        const { serial: id, type } = body
        if (!devices.has(id))
          throw new Error(`unknown serial ${id}`)
        devices.set(id, type)
        pushToTrackers()
      }
      else if (req.method === 'POST' && url.pathname === '/add') {
        devices.set(body.serial || SERIAL, body.type || 'device')
        pushToTrackers()
      }
      else if (req.method === 'POST' && url.pathname === '/remove') {
        devices.delete(body.serial || SERIAL)
        pushToTrackers()
      }
      else if (req.method === 'POST' && url.pathname === '/reconnect-offline') {
        // the fake `adb reconnect offline` CLI calls this: emulate a
        // successful re-handshake — every offline device comes back online
        calls.push({ t: Date.now(), serial: '*', command: 'adb reconnect offline' })
        let recovered = 0
        for (const [id, type] of [...devices.entries()]) {
          if (type === 'offline') {
            devices.set(id, 'device')
            recovered++
          }
        }
        if (recovered)
          pushToTrackers()
        result = { ok: true, recovered }
      }
      else if (req.method === 'POST' && url.pathname === '/shell-canned') {
        canned.push({ match: new RegExp(body.match), output: body.output, times: body.times ?? 1 })
      }
      else if (req.method === 'GET' && url.pathname === '/calls') {
        result = { calls }
      }
      else if (req.method === 'GET' && url.pathname === '/sync-received') {
        result = { syncStats }
      }
      else if (req.method === 'POST' && url.pathname === '/reset') {
        calls.length = 0
        canned.length = 0
        syncStats.pushes = 0
        syncStats.bytes = 0
      }
      else {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result))
    }
    catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
  })
})

control.listen(CTRL_PORT, '127.0.0.1', () => {
  console.log(`[fake-adb] control API on 127.0.0.1:${CTRL_PORT}`)
})

;['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
  adbServer.close()
  control.close()
  process.exit(0)
}))
