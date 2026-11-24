#!/usr/bin/env node
/**
 * Visual smoke test for the v3.10.0 UI additions:
 *   - the Konva workflow canvas (new workflow → nodes/edges → add a step)
 *   - the embedded mirror window (opens, fails gracefully without a device)
 *
 * Usage: node tests/e2e/visual-smoke.mjs  (expects desktop/dist-electron to exist)
 * Screenshots land in /home/z/my-project/download/.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { CdpSession, listTargets, waitForVersion } from './cdp.cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '../..')
const DESKTOP = path.join(REPO, 'desktop')
const HOME = '/tmp/visual-home'
const SAVE = '/tmp/visual-save'
const USER_DATA = path.join(HOME, '.config/escrcpy')
const CONFIG_JSON = path.join(USER_DATA, 'config.json')
const CDP_PORT = 9333
const OUT = '/home/z/my-project/download'

fs.rmSync(HOME, { recursive: true, force: true })
fs.mkdirSync(USER_DATA, { recursive: true })
fs.mkdirSync(SAVE, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

fs.writeFileSync(CONFIG_JSON, JSON.stringify({
  version: '3.10.2',
  common: { adbDir: path.join(__dirname, 'fake-adb-bin'), scrcpyDir: path.join(__dirname, 'fake-adb-bin'), saveDir: SAVE },
  copilot: { settings: {} },
}, null, 2))

const procs = []
function cleanup() {
  for (const proc of procs) {
    try {
      proc.kill()
    }
    catch {}
  }
  try {
    execSync('pkill -f "remote-debugging-port=9333" || true', { shell: '/bin/bash' })
  }
  catch {}
  try {
    execSync('pkill -f "tests/e2e/fake-adb-server" || true', { shell: '/bin/bash' })
  }
  catch {}
}
process.on('exit', cleanup)

async function waitFor(fn, { timeoutMs = 20000, intervalMs = 300, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value)
        return value
    }
    catch {}
    await sleep(intervalMs)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const fakeAdb = spawn('node', [path.join(__dirname, 'fake-adb-server.mjs')], { stdio: ['ignore', 'inherit', 'inherit'] })
procs.push(fakeAdb)
await waitFor(async () => {
  const res = await fetch('http://127.0.0.1:5038/state')
  return res.ok
}, { label: 'fake adb' })

const xvfb = spawn('Xvfb', [':98', '-screen', '0', '1600x1000x24'], { stdio: 'ignore' })
procs.push(xvfb)
await sleep(700)

const bin = path.join(DESKTOP, 'node_modules', '.bin', 'electron')
const electron = spawn(bin, ['.', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], {
  cwd: DESKTOP,
  env: {
    ...process.env,
    HOME,
    DISPLAY: ':98',
    PATH: `${path.join(__dirname, 'fake-adb-bin')}:${process.env.PATH}`,
    DESKTOP_PATH: SAVE,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
electron.stdout.on('data', d => (logs += d.toString()))
electron.stderr.on('data', d => (logs += d.toString()))
procs.push(electron)

await waitForVersion(CDP_PORT, 40000)
const mainTarget = await waitFor(async () => {
  const targets = await listTargets(CDP_PORT)
  return targets.find(t => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('tasks') && !t.url.includes('mirror'))
}, { label: 'main window' })
const main = await CdpSession.connect(mainTarget.webSocketDebuggerUrl)

await waitFor(() => main.evaluate(`!!document.querySelector('#app')`), { label: 'main DOM' })

const consoleErrors = []
main.on?.('Runtime.exceptionThrown', () => {})
try {
  await main.send('Runtime.enable')
}
catch {}

// ── tasks window → workflow canvas ─────────────────────────────────────────
await main.evaluate(`(async () => {
  await window.$preload.win.open('pages/tasks', { title: 'tasks.name', type: 'tasks' })
  return true
})()`)

const tasksTarget = await waitFor(async () => {
  const targets = await listTargets(CDP_PORT)
  return targets.find(t => t.type === 'page' && t.url.includes('tasks'))
}, { label: 'tasks window' })
const tasks = await CdpSession.connect(tasksTarget.webSocketDebuggerUrl)
try {
  await tasks.send('Runtime.enable')
}
catch {}
const taskErrors = []
try {
  tasks.on('Runtime.exceptionThrown', (params) => {
    taskErrors.push(params?.exceptionDetails?.text || 'exception')
  })
}
catch {}

await waitFor(() => tasks.evaluate(`document.querySelectorAll('*').length > 100`), { label: 'tasks DOM' })

// switch to the workflows tab
await tasks.evaluate(`(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(el => (el.textContent || '').includes('工作流') || (el.textContent || '').includes('Workflow'))
  if (tab) tab.click()
  return Boolean(tab)
})()`)
await sleep(600)

const clickedNew = await tasks.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(el => (el.textContent || '').includes('新建工作流') || (el.textContent || '').includes('tasks.workflow.create'))
  if (btn) {
    btn.click()
    return true
  }
  return false
})()`)
console.log('new workflow button:', clickedNew)

await sleep(1200)
const canvasState = await tasks.evaluate(`(() => {
  const stage = document.querySelector('.konvajs-content')
  const nodes = document.querySelectorAll('.konvajs-content canvas').length
  return JSON.stringify({ hasStage: Boolean(stage), canvases: nodes })
})()`)
console.log('canvas:', canvasState)

// add a delay step through the toolbar
const added = await tasks.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.el-dialog button')].find(el => (el.textContent || '').includes('延时') || (el.textContent || '').includes('delay'))
  if (btn) {
    btn.click()
    return true
  }
  return false
})()`)
console.log('add delay step:', added)
await sleep(800)

const shot1 = await tasks.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
fs.writeFileSync(path.join(OUT, 'workflow-canvas.jpg'), Buffer.from(shot1.data, 'base64'))

const nodeCount = await tasks.evaluate(`(() => {
  const shapes = document.querySelectorAll('.konvajs-content')
  return shapes.length
})()`)

// ── mirror window ──────────────────────────────────────────────────────────
await main.evaluate(`(async () => {
  await window.$preload.win.open('pages/mirror', {
    instanceId: 'mirror:E2ETEST001',
    device: { id: 'E2ETEST001', name: 'E2E device', status: 'device' },
    title: 'device.actions.more.mirror.inset',
    type: 'mirror',
  })
  return true
})()`)

const mirrorTarget = await waitFor(async () => {
  const targets = await listTargets(CDP_PORT)
  return targets.find(t => t.type === 'page' && t.url.includes('mirror'))
}, { label: 'mirror window' })
const mirror = await CdpSession.connect(mirrorTarget.webSocketDebuggerUrl)
const mirrorErrors = []
try {
  await mirror.send('Runtime.enable')
  mirror.on('Runtime.exceptionThrown', (params) => {
    mirrorErrors.push(params?.exceptionDetails?.text || 'exception')
  })
}
catch {}

await waitFor(() => mirror.evaluate(`document.querySelectorAll('*').length > 20`), { label: 'mirror DOM' })
await sleep(2500)

const mirrorState = await mirror.evaluate(`(() => {
  const text = document.body.innerText
  return JSON.stringify({ text: text.slice(0, 200) })
})()`)
console.log('mirror state:', mirrorState)

const mirrorDom = await mirror.evaluate(`(() => {
  const buttons = document.querySelectorAll('header button, .app-region-drag button').length
  const konva = document.querySelectorAll('.konvajs-content').length
  const video = document.querySelectorAll('video').length
  const canvas = document.querySelectorAll('canvas').length
  return JSON.stringify({ buttons, konva, video, canvas })
})()`)
console.log('mirror dom:', mirrorDom)

const panelToggle = await mirror.evaluate(`(() => {
  const btns = [...document.querySelectorAll('.app-region-drag button')]
  const btn = btns[0]
  if (!btn) return false
  btn.click()
  return true
})()`)
await sleep(600)
const panelState = await mirror.evaluate(`(() => {
  const text = document.body.innerText
  return JSON.stringify({ hasKeymapPanel: text.includes('keyboard.mapping.name') || text.includes('键盘映射'), hasAdd: text.includes('keyboard.mapping.profile.new') })
})()`)
console.log('panel toggle:', panelToggle, panelState)

const mirrorStyle = await mirror.evaluate(`(() => {
  const root = document.querySelector('#app')
  const body = getComputedStyle(document.body).backgroundColor
  const rootBg = root ? getComputedStyle(root).backgroundColor : 'none'
  return JSON.stringify({ body, rootBg, size: [window.innerWidth, window.innerHeight] })
})()`)
console.log('mirror style:', mirrorStyle)
await mirror.send('Page.bringToFront').catch(() => {})
await sleep(500)
const shot2 = await mirror.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
fs.writeFileSync(path.join(OUT, 'mirror-window.jpg'), Buffer.from(shot2.data, 'base64'))

console.log('\n== visual smoke summary ==')
console.log('canvas has konva stage:', canvasState.includes('"hasStage":true'))
console.log('node count after add:', nodeCount)
console.log('tasks exceptions:', taskErrors.length, taskErrors.slice(0, 3))
console.log('mirror exceptions:', mirrorErrors.length, mirrorErrors.slice(0, 3))
console.log('electron log errors:', (logs.match(/ERROR|Error:/g) || []).length)
console.log('electron log tail:', logs.split('\n').filter(l => /ERROR|Error:|Mirror/i.test(l)).slice(-12).join(' | ') )

cleanup()
process.exit(0)
