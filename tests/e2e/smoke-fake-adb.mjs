#!/usr/bin/env node
/**
 * Protocol smoke test: start the fake adb server, then drive the REAL adbkit
 * client (the exact package the app bundles) through every surface the app
 * uses. If this passes, the fake server is protocol-correct.
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = new URL('.', import.meta.url).pathname
const SERVER = spawn('node', [`${ROOT}fake-adb-server.mjs`], { stdio: ['ignore', 'pipe', 'inherit'] })
let serverLog = ''
SERVER.stdout.on('data', d => serverLog += d.toString())

async function ctrl(method, path, body) {
  const res = await fetch(`http://127.0.0.1:5038${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  // wait for server up
  for (let i = 0; i < 50; i++) {
    try {
      await fetch('http://127.0.0.1:5038/state').then(r => r.json())
      break
    }
    catch {
      await sleep(100)
    }
  }

  const { createRequire } = await import('node:module')
  const desktopRequire = createRequire(new URL('../../desktop/package.json', import.meta.url))
  const adbkit = desktopRequire('@devicefarmer/adbkit')
  const { Adb } = adbkit
  const client = Adb.createClient()
  const runShell = async (serial, command) => {
    const stream = await client.getDevice(serial).shell(command)
    return (await Adb.util.readAll(stream)).toString('utf8').trim()
  }

  // 1. listDevices
  const devices = await client.listDevices()
  check('listDevices sees fake device', devices.length === 1 && devices[0].id === 'E2ETEST001' && devices[0].type === 'device', JSON.stringify(devices))

  // 2. tracker: initial + change events (device → offline → device)
  const tracker = await client.trackDevices()
  const events = []
  tracker.on('add', d => events.push(['add', d.id, d.type]))
  tracker.on('change', d => events.push(['change', d.id, d.type]))
  tracker.on('remove', d => events.push(['remove', d.id, d.type]))
  await sleep(300)

  await ctrl('POST', '/state', { serial: 'E2ETEST001', type: 'offline' })
  await sleep(300)
  await ctrl('POST', '/state', { serial: 'E2ETEST001', type: 'device' })
  await sleep(300)

  const changeEvents = events.filter(e => e[0] === 'change')
  check('tracker emits change on device⇄offline flips', changeEvents.length >= 2, JSON.stringify(events))

  // 3. shell: getprop / wm size / dumpsys battery
  const model = await runShell('E2ETEST001', 'getprop ro.product.model')
  check('shell getprop returns model', model.includes('FakePhone X20'), JSON.stringify(model))

  const size = await runShell('E2ETEST001', 'wm size')
  check('shell wm size', size.includes('1080x2400'), JSON.stringify(size))

  const battery = await runShell('E2ETEST001', 'dumpsys battery')
  check('shell dumpsys battery', battery.includes('level: 88'), battery.slice(0, 40))

  // 4. screencap (adbkit command string: echo && screencap -p)
  const shotStream = await client.getDevice('E2ETEST001').screencap()
  const png = await Adb.util.readAll(shotStream)
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const hasSig = png.subarray(0, 8).equals(sig)
  const hasIEnd = png.subarray(-8, -4).toString('ascii') === 'IEND'
  const pngOk = hasSig && hasIEnd && png.length > 50
  check('screencap returns byte-exact PNG', pngOk, `${png.length} bytes, sig=${png.subarray(0, 8).toString('hex')}, end=${png.subarray(-8).toString('hex')}`)

  // 5. push via sync (yadb binary upload path)
  const fs = await import('node:fs/promises')
  const yadbPath = process.env.E2E_YADB_PATH
  if (yadbPath) {
    await client.getDevice('E2ETEST001').push(yadbPath, '/data/local/tmp/yadb')
    await sleep(300)
    const { syncStats } = await ctrl('GET', '/sync-received')
    check('sync push (yadb upload) received', syncStats.pushes >= 1, JSON.stringify(syncStats))
  }
  else {
    // push a small temp file instead
    const tmp = '/tmp/e2e-push-test.bin'
    await fs.writeFile(tmp, Buffer.alloc(2048, 7))
    await client.getDevice('E2ETEST001').push(tmp, '/data/local/tmp/e2e-push-test.bin')
    await sleep(300)
    const { syncStats } = await ctrl('GET', '/sync-received')
    check('sync push received', syncStats.pushes >= 1 && syncStats.bytes >= 2048, JSON.stringify(syncStats))
  }

  // 6. yadb app_process round trip (what adbx invokes)
  await runShell('E2ETEST001', 'app_process -Djava.class.path=/data/local/tmp/yadb /data/local/tmp com.ysbing.yadb.Main -layout')
  await sleep(100)
  const xml = await runShell('E2ETEST001', 'cat /data/local/tmp/yadb_layout_dump.xml')
  check('yadb -layout + cat returns UI XML', xml.includes('<hierarchy') && xml.includes('com.android.settings'), xml.slice(0, 60))

  // 7. calls log
  const { calls } = await ctrl('GET', '/calls')
  check('calls recorded', calls.length >= 5, `${calls.length} calls`)

  // 8. reconnect-offline control (what the fake adb CLI invokes)
  await ctrl('POST', '/state', { serial: 'E2ETEST001', type: 'offline' })
  await sleep(200)
  await ctrl('POST', '/reconnect-offline')
  await sleep(200)
  const st = await ctrl('GET', '/state')
  check('reconnect-offline brings device back', st.devices.E2ETEST001 === 'device', JSON.stringify(st.devices))

  tracker.end()
  client.kill?.()
}
catch (error) {
  console.error('SMOKE CRASHED:', error)
  results.push({ name: 'crash', ok: false })
}
finally {
  SERVER.kill('SIGTERM')
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
