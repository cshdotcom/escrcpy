#!/usr/bin/env node
/**
 * Full-chain E2E test runner for Escrcpy.
 *
 * Runs the REAL app (built with `pnpm build` in desktop/) under Xvfb with:
 *   - a protocol-level fake ADB server (tests/e2e/fake-adb-server.mjs) on :5037
 *   - a fake `adb` CLI shim on PATH (tests/e2e/fake-adb-bin) for host commands
 *   - an OpenAI-compatible mock LLM (tests/e2e/mock-llm-server.mjs) on :5039
 *   - an isolated HOME so the app's electron-store config is ours to control
 *
 * The app is driven through CDP (RemoteDebugger) the same way a user would:
 * DOM events for typing/sending in the Copilot chat, window.$preload IPC for
 * tasks, HTTP for device-state flips on the fake adb server.
 *
 * Usage:  node tests/e2e/run-e2e.mjs          (expects desktop/dist-electron to exist)
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
const E2E_HOME = '/tmp/e2e-home'
const E2E_SAVE = '/tmp/e2e-save'
const USER_DATA = path.join(E2E_HOME, '.config/escrcpy')
const CONFIG_JSON = path.join(USER_DATA, 'config.json')
const CDP_PORT = 9222
const ADB_CTRL = 'http://127.0.0.1:5038'
const LLM_CTRL = 'http://127.0.0.1:5040'
const SERIAL = 'E2ETEST001'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok === false && detail ? ` — ${String(detail).slice(0, 400)}` : ''}`)
}
async function waitFor(fn, { timeoutMs = 20000, intervalMs = 400, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value)
        return value
    }
    catch (error) {
      lastErr = error
    }
    await sleep(intervalMs)
  }
  throw new Error(`timeout waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`)
}
async function ctrl(base, method, api, body) {
  const res = await fetch(`${base}${api}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

/**
 * Type + send one message in a Copilot window like a user would. Tries the
 * send button under several titles (i18n may not be loaded in this env —
 * raw keys show up) and always falls back to an Enter keystroke.
 */
async function sendInCopilot(session, text) {
  await session.evaluate(`(() => {
    const ta = document.querySelector('.copilot-input textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  return session.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => ['发送', 'Send', 'copilot.send'].includes(b.title))
    if (btn && !btn.disabled) { btn.click(); return 'btn' }
    const ta = document.querySelector('.copilot-input textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }))
    return 'enter'
  })()`)
}

/**
 * fetch with fresh connections + retries — immune to the web server's
 * restart window (pooled sockets die when the listener restarts).
 */
async function fetchRetry(url, options = {}, tries = 6) {
  let lastError = null
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fetch(url, { ...options, headers: { connection: 'close', ...(options.headers || {}) } })
    }
    catch (error) { lastError = error }
    await sleep(400)
  }
  throw lastError
}

const procs = []
function cleanupAll() {
  for (const p of procs) {
    try { p.kill('SIGTERM') }
    catch {}
  }
  try { execSync('pkill -f "Xvfb :99" 2>/dev/null || true') }
  catch {}
  try { execSync('pkill -f "electron . --remote-debugging-port=9222" 2>/dev/null || true') }
  catch {}
}
process.on('exit', cleanupAll)
process.on('SIGINT', () => { cleanupAll(); process.exit(130) })
process.on('SIGTERM', () => { cleanupAll(); process.exit(143) })

let electronProc = null
let electronLogs = ''

function writeBaseConfig() {
  fs.rmSync(E2E_HOME, { recursive: true, force: true })
  fs.mkdirSync(USER_DATA, { recursive: true })
  fs.mkdirSync(E2E_SAVE, { recursive: true })

  const copilotSettings = {
    activeVendorId: 'e2e',
    maxSteps: 0, // unlimited — user-facing default for the agent loop
    requireConfirm: false,
    streaming: true,
    allowShell: true,
    systemPrompt: 'You are a helpful Android automation assistant.',
    autoScreenshotAfterAction: true,
    autoUiDumpAfterAction: true,
    retryOnFailure: true,
    maxRetries: 3,
    autoCompact: true,
    contextWindow: 32000,
    launchOnBoot: false,
    revealWindowOnTaskFire: true,
    vendors: {
      e2e: {
        id: 'e2e',
        name: 'E2E Mock',
        apiType: 'openai',
        baseUrl: 'http://127.0.0.1:5039/v1',
        apiKey: 'sk-e2e-initial',
        model: 'mock-gpt-4o',
        vision: true,
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    },
  }

  // IMPORTANT: electron-store persists NESTED objects — the keys
  // 'copilot.settings' / 'common.adbDir' are dot-paths, not flat keys.
  const config = {
    version: '3.10.2', // match app version so migrations keep our adbDir

    // ── v3.8.0 scheduler probes ──
    // A task overdue by >24h must be SKIPPED with a recorded reason; a task
    // overdue by minutes must be caught up and run once.
    tasks: {
      list: [
        {
          id: 'task_stale_skip',
          name: 'Stale probe (skip with reason)',
          type: 'AI',
          enabled: true,
          cronExpr: '0 4 * * *',
          notifyOnComplete: false,
          createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
          config: { action: 'ai', vendorId: 'e2e', prompt: 'stale probe', sessionMode: 'new' },
          nextRunAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
        },
        {
          id: 'task_catchup',
          name: 'Catch-up probe',
          type: 'AI',
          enabled: true,
          // One-shot cron (Jan 1) so the fabricated overdue occurrence fires
          // exactly once via catch-up and never interferes with later phases.
          cronExpr: '0 0 1 1 *',
          notifyOnComplete: false,
          createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
          config: { action: 'ai', vendorId: 'e2e', prompt: 'CATCHUP_PROBE_PROMPT', sessionMode: 'new' },
          nextRunAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      ],
    },
    common: {
      adbDir: path.join(__dirname, 'fake-adb-bin'),
      scrcpyDir: path.join(__dirname, 'fake-adb-bin'), // fake scrcpy keeps the dependency dialog away
      saveDir: E2E_SAVE,
    },
    copilot: {
      settings: copilotSettings,
    },
  }

  fs.writeFileSync(CONFIG_JSON, JSON.stringify(config, null, 2))
}

function readStore() {
  return JSON.parse(fs.readFileSync(CONFIG_JSON, 'utf8'))
}

function startElectron() {
  electronLogs = ''
  const bin = path.join(DESKTOP, 'node_modules', '.bin', 'electron')
  electronProc = spawn(bin, ['.', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], {
    cwd: DESKTOP,
    env: {
      ...process.env,
      HOME: E2E_HOME,
      DISPLAY: ':99',
      PATH: `${path.join(__dirname, 'fake-adb-bin')}:${process.env.PATH}`,
      DESKTOP_PATH: E2E_SAVE,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (d) => { electronLogs += d.toString() }
  electronProc.stdout.on('data', collect)
  electronProc.stderr.on('data', collect)
  procs.push(electronProc)
  return electronProc
}

async function findTarget(predicate, timeoutMs = 15000) {
  return waitFor(async () => {
    const targets = await listTargets(CDP_PORT)
    return targets.find(predicate)
  }, { timeoutMs, label: 'cdp target' })
}

async function main() {
  // ── preflight ────────────────────────────────────────────
  if (!fs.existsSync(path.join(DESKTOP, 'dist-electron', 'main.js'))) {
    console.error('dist-electron/main.js not found — run `pnpm build` in desktop/ first')
    process.exit(1)
  }

  console.log('== Escrcpy full-chain E2E ==')
  console.log(`repo: ${REPO}`)

  // clean leftovers
  try { execSync('pkill -f "electron . --remote-debugging-port=9222" || true', { shell: '/bin/bash' }) }
  catch {}
  try { execSync('pkill -f "tests/e2e/fake-adb-server" || true', { shell: '/bin/bash' }) }
  catch {}
  try { execSync('pkill -f "tests/e2e/mock-llm-server" || true', { shell: '/bin/bash' }) }
  catch {}
  await sleep(800)

  // ── infrastructure ───────────────────────────────────────
  const fakeAdb = spawn('node', [path.join(__dirname, 'fake-adb-server.mjs')], { stdio: ['ignore', 'inherit', 'inherit'] })
  procs.push(fakeAdb)
  const mockLlm = spawn('node', [path.join(__dirname, 'mock-llm-server.mjs')], { stdio: ['ignore', 'inherit', 'inherit'] })
  procs.push(mockLlm)

  await waitFor(async () => {
    try {
      await ctrl(ADB_CTRL, 'GET', '/state')
      return true
    }
    catch { return false }
  }, { timeoutMs: 10000, label: 'fake adb control' })

  // Xvfb display server
  const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1600x1000x24'], { stdio: 'ignore' })
  procs.push(xvfb)
  await sleep(700)

  // ── boot 1: fresh config ─────────────────────────────────
  writeBaseConfig()
  startElectron()

  await waitForVersion(CDP_PORT, 30000)
  console.log('\n-- CDP online, waiting for main window --')

  const mainTarget = await findTarget(t => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('copilot') && !t.url.includes('tasks'), 25000)
  const main = await CdpSession.connect(mainTarget.webSocketDebuggerUrl)
  console.log(`main window: ${mainTarget.url}`)

  // ════════ S1 · boot & device discovery ════════
  console.log('\n[S1] boot & device discovery')

  await waitFor(() => main.evaluate(`!!document.querySelector('#app') && document.querySelectorAll('*').length > 200`), { timeoutMs: 25000, label: 'renderer DOM' })
  check('S1.1 main window renders the app shell', true)

  const deviceSeen = await waitFor(async () => {
    return await main.evaluate(`document.body.innerText.includes('${SERIAL}')`)
  }, { timeoutMs: 20000, label: 'device row' })
  check('S1.2 fake device appears in the device list', deviceSeen, SERIAL)

  const guardOk = electronLogs.includes('[Guard] main-process exception guard installed')
  check('S1.3 main-process exception guard installed', guardOk)

  const noCrashDialog = !electronLogs.includes('A JavaScript error occurred')
  check('S1.4 no "A JavaScript error occurred" dialog', noCrashDialog)

  const modelText = await waitFor(() => main.evaluate(`document.body.innerText.includes('FakePhone')`), { timeoutMs: 20000, intervalMs: 600, label: 'device display name' })
  check('S1.5 device display name rendered (devices-l product chain)', Boolean(modelText))

  // ════════ S2 · AI API config persistence (bug regression) ════════
  console.log('\n[S2] AI API config persistence')

  const modelsResult = await main.evaluate(`(async () => {
    const result = await window.$preload.ipcxRenderer.invoke('copilot:fetch-models', { config: {
      apiType: 'openai', baseUrl: 'http://127.0.0.1:5039/v1', apiKey: 'sk-e2e-test', model: 'mock-gpt-4o' } })
    return JSON.stringify(result)
  })()`)
  let modelsOk = false
  let modelsDetail = modelsResult
  try {
    const parsed = JSON.parse(modelsResult)
    const list = parsed?.data?.models || parsed?.models || parsed
    modelsOk = Array.isArray(list) && list.length === 3 && list.includes('mock-glm-4.7')
    modelsDetail = JSON.stringify(list)
  }
  catch {}
  check('S2.1 copilot:fetch-models returns mock model list', modelsOk, modelsDetail)

  // change the API key through the store the same way the config drawer does
  await main.evaluate(`(async () => {
    const settings = window.$preload.store.get('copilot.settings')
    settings.vendors.e2e.apiKey = 'sk-e2e-persisted'
    settings.vendors.e2e.model = 'mock-glm-4.7'
    window.$preload.store.set('copilot.settings', settings)
    return true
  })()`)

  await sleep(800) // electron-store write is sync; give watchers a beat
  const persisted = readStore()
  const keyOnDisk = persisted?.copilot?.settings?.vendors?.e2e?.apiKey
  const modelOnDisk = persisted?.copilot?.settings?.vendors?.e2e?.model
  check('S2.2 edited vendor config lands in config.json', keyOnDisk === 'sk-e2e-persisted' && modelOnDisk === 'mock-glm-4.7', `apiKey=${keyOnDisk} model=${modelOnDisk}`)

  // ── reboot the app, config must survive ──
  console.log('-- rebooting app for persistence regression --')
  electronProc.kill('SIGTERM')
  await waitFor(() => electronProc.exitCode !== null || electronProc.killed, { timeoutMs: 10000, label: 'electron exit' })
  await sleep(1500)
  startElectron()
  await waitForVersion(CDP_PORT, 30000)
  const mainTarget2 = await findTarget(t => t.type === 'page' && t.url.includes('index.html') && !t.url.includes('copilot') && !t.url.includes('tasks'), 25000)
  const main2 = await CdpSession.connect(mainTarget2.webSocketDebuggerUrl)
  await waitFor(() => main2.evaluate(`!!document.querySelector('#app')`), { timeoutMs: 25000, label: 'renderer DOM (boot 2)' })

  const survived = await main2.evaluate(`(async () => {
    const settings = window.$preload.store.get('copilot.settings')
    return JSON.stringify({ apiKey: settings?.vendors?.e2e?.apiKey, model: settings?.vendors?.e2e?.model })
  })()`)
  let survivedOk = false
  try {
    const parsed = JSON.parse(survived)
    survivedOk = parsed.apiKey === 'sk-e2e-persisted' && parsed.model === 'mock-glm-4.7'
  }
  catch {}
  check('S2.3 AI API config survives app restart', survivedOk, survived)

  const deviceSeen2 = await waitFor(() => main2.evaluate(`document.body.innerText.includes('${SERIAL}')`), { timeoutMs: 20000, label: 'device row (boot 2)' })
  check('S2.4 device re-discovered after restart', Boolean(deviceSeen2))

  // ════════ S3 · Copilot chat: window, tool loop, vision ════════
  console.log('\n[S3] Copilot chat (open-window regression + tool loop + vision bridge)')

  await ctrl(LLM_CTRL, 'POST', '/reset')
  await ctrl(ADB_CTRL, 'POST', '/reset')

  // open the Copilot window for the device the same way the control bar does
  await main2.evaluate(`(async () => {
    window.$preload.win.open('pages/copilot', {
      title: 'copilot.welcome.title', type: 'device',
      device: { id: '${SERIAL}', name: 'FakePhone X20' }, instanceId: '${SERIAL}',
    })
    return true
  })()`)

  const copilotTarget = await findTarget(t => t.type === 'page' && t.url.includes('copilot'), 20000)
  check('S3.1 Copilot window opens (v3.4 regression)', Boolean(copilotTarget), copilotTarget?.url)
  const copilot = await CdpSession.connect(copilotTarget.webSocketDebuggerUrl)

  await waitFor(() => copilot.evaluate(`!!document.querySelector('.copilot-input textarea')`), { timeoutMs: 20000, label: 'copilot composer' })
  check('S3.2 Copilot composer rendered', true)

  // script the mock: tool round-trips then a final answer
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { tool: { name: 'get_device_info', arguments: {} } },
    { tool: { name: 'screenshot', arguments: {} } },
    { text: 'ALL_DONE_MODEL_MODEL=FakePhone X20 battery=88' },
  ] })

  // type + send like a user
  await copilot.evaluate(`(() => {
    const ta = document.querySelector('.copilot-input textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '请打开设置并告诉我设备状态')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  await copilot.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.title === '发送' || b.title === 'Send')
    if (btn && !btn.disabled) { btn.click(); return true }
    const ta = document.querySelector('.copilot-input textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }))
    return 'enter'
  })()`)

  const finalAnswer = await waitFor(() => copilot.evaluate(`document.body.innerText.includes('ALL_DONE_MODEL_MODEL')`), { timeoutMs: 60000, intervalMs: 800, label: 'final answer' })
  check('S3.3 Copilot final answer rendered (3-round tool loop)', Boolean(finalAnswer))

  const toolCards = await copilot.evaluate(`(document.body.innerText.includes('设备信息') || document.body.innerText.includes('Device info') || document.body.innerText.includes('get_device_info')) && (document.body.innerText.includes('屏幕截图') || document.body.innerText.includes('screenshot'))`)
  check('S3.4 tool execution cards rendered (labeled, visible)', Boolean(toolCards))

  const { stats: llmStats } = await ctrl(LLM_CTRL, 'GET', '/stats')
  check('S3.5 tool round-trips hit the mock LLM (requests >= 3)', llmStats.requests >= 3, JSON.stringify(llmStats))
  check('S3.6 screenshot reached the model (vision bridge, sawImage)', llmStats.sawImage === true, `imageCount=${llmStats.imageCount}`)

  const { requests: llmRequests } = await ctrl(LLM_CTRL, 'GET', '/requests')
  const toolMsgs = llmRequests.filter(r => (r.messages || []).some(m => m.role === 'tool')).length
  check('S3.7 tool results sent back to the model (role:tool messages)', toolMsgs >= 2, `${toolMsgs} requests with tool results`)

  const sessionOnDisk = readStore()?.copilot?.sessions || []
  const scoped = sessionOnDisk.find(s => s.scope === SERIAL || s.scope === `task:`)
  check('S3.8 conversation persisted to disk (scoped session)', Boolean(scoped && scoped.messages?.length >= 3), `${sessionOnDisk.length} sessions`)

  // ════════ S4 · context auto-compaction ════════
  console.log('\n[S4] context auto-compaction')

  // shrink the window and inject a long history into the SAME window scope
  await copilot.evaluate(`(async () => {
    const settings = window.$preload.store.get('copilot.settings')
    settings.contextWindow = 4000
    settings.autoCompact = true
    window.$preload.store.set('copilot.settings', settings)

    // build a fat session (many long turns) in this window's scope
    const msgs = []
    for (let i = 0; i < 40; i++) {
      msgs.push({ id: 'u' + i, role: 'user', content: 'round ' + i + ' ' + 'context filler token word '.repeat(30), createdAt: new Date().toISOString() })
      msgs.push({ id: 'a' + i, role: 'assistant', content: 'ack ' + i + ' ' + 'assistant filler token word '.repeat(30), createdAt: new Date().toISOString() })
    }
    const sessions = window.$preload.store.get('copilot.sessions') || []
    const existing = sessions.find(s => s.scope === '${SERIAL}')
    const fat = existing || { id: 'session_fat_${SERIAL}', scope: '${SERIAL}', name: 'fat', messages: [] }
    fat.messages = msgs
    if (!sessions.includes(fat)) sessions.unshift(fat)
    window.$preload.store.set('copilot.sessions', sessions)
    return fat.messages.length
  })()`)

  // reload the copilot window so the composer picks up the new settings/session
  await copilot.send('Page.reload')
  await sleep(1500)
  const copilotTarget2 = await findTarget(t => t.type === 'page' && t.url.includes('copilot'), 20000)
  const copilot2 = await CdpSession.connect(copilotTarget2.webSocketDebuggerUrl)
  await waitFor(() => copilot2.evaluate(`!!document.querySelector('.copilot-input textarea')`), { timeoutMs: 25000, label: 'copilot composer (reload)' })

  // summarizer script: first call summarizes (compaction), last is the answer
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { text: 'SUMMARY_OF_EARLY_TURNS: the user asked about settings and device status across 40 rounds.' },
    { text: 'COMPACTED_ANSWER_OK' },
  ] })

  await copilot2.evaluate(`(() => {
    const ta = document.querySelector('.copilot-input textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '继续')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  await copilot2.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => ['发送', 'Send', 'copilot.send'].includes(b.title))
    if (btn && !btn.disabled) { btn.click(); return true }
    const ta = document.querySelector('.copilot-input textarea')
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }))
    return 'enter-fallback'
  })()`)

  let compactAnswerSeen = false
  try {
    await waitFor(() => copilot2.evaluate(`document.body.innerText.includes('COMPACTED_ANSWER_OK')`), { timeoutMs: 45000, intervalMs: 800, label: 'compacted answer' })
    compactAnswerSeen = true
  }
  catch (error) {
    // diagnose: what did the page do? what did the mock see?
    const pageState = await copilot2.evaluate(`(function () {
      const btn = [...document.querySelectorAll('button')].find(b => b.title === '发送' || b.title === 'Send')
      const ta = document.querySelector('.copilot-input textarea')
      return JSON.stringify({
        hasBtn: !!btn, btnDisabled: btn ? btn.disabled : null,
        taValue: ta ? ta.value : null, taDisabled: ta ? ta.disabled : null,
        bodyHasSummary: document.body.innerText.includes('SUMMARY_OF_EARLY_TURNS'),
        bodyHasContinue: document.body.innerText.includes('继续'),
        msgCount: document.querySelectorAll('.el-scrollbar .message, [class*=message]').length,
      })
    })()`)
    const { stats: s4stats } = await ctrl(LLM_CTRL, 'GET', '/stats')
    const s4sessions = await copilot2.evaluate(`JSON.stringify((window.$preload.store.get('copilot.sessions') || []).map(s => ({ id: s.id, scope: s.scope, n: (s.messages || []).length })))`)
    console.log(`  [diag] page: ${pageState}\n  [diag] mock: ${JSON.stringify(s4stats)}\n  [diag] sessions: ${s4sessions}`)
  }
  check('S4.1 chat still answers after compaction trigger', compactAnswerSeen)

  const compactionState = await (async () => {
    try {
      return await waitFor(async () => {
        return await copilot2.evaluate(`(async () => {
      const sessions = window.$preload.store.get('copilot.sessions') || []
      const s = sessions.find(x => x.scope === '${SERIAL}')
      if (!s) return JSON.stringify({ err: 'no session' })
      const note = (s.messages || []).find(m => m.meta?.kind === 'note' || String(m.content || '').includes('compact') || String(m.content || '').includes('SUMMARY_OF_EARLY_TURNS'))
      return JSON.stringify({ count: s.messages.length, hasNote: !!note, first: String((s.messages[0] || {}).content || '').slice(0, 80) })
    })()`)
      }, { timeoutMs: 15000, intervalMs: 800, label: 'compaction state on disk' })
    }
    catch {
      return JSON.stringify({ count: -1, hasNote: false, first: 'unavailable' })
    }
  })()
  let compactOk = false
  let compactDetail = compactionState
  try {
    const parsed = JSON.parse(compactionState)
    compactOk = parsed.count <= 20 && (parsed.hasNote || (parsed.first || '').includes('SUMMARY'))
    compactDetail = `messages=${parsed.count} hasNote=${parsed.hasNote} first="${parsed.first}"`
  }
  catch {}
  check('S4.2 long conversation compacted (61+ → small, with note/summary)', compactOk, compactDetail)

  // restore a sane window for later stages
  await copilot2.evaluate(`(async () => {
    const settings = window.$preload.store.get('copilot.settings')
    settings.contextWindow = 32000
    window.$preload.store.set('copilot.settings', settings)
    return true
  })()`)

  // ════════ S5 · scheduled AI tasks (agent + continue + unlimited) ════════
  console.log('\n[S5] scheduled AI tasks')

  const vendorsRes = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:vendors')
    return JSON.stringify(r)
  })()`)
  let vendorsOk = false
  let vendorsDetail = vendorsRes
  try {
    const parsed = JSON.parse(vendorsRes)
    const vendors = parsed?.data?.vendors || parsed?.vendors || []
    const e2e = vendors.find(v => v.id === 'e2e')
    vendorsOk = Boolean(e2e && e2e.baseUrl)
    vendorsDetail = JSON.stringify(vendors.map(v => v.id))
  }
  catch {}
  check('S5.1 tasks:vendors exposes configured vendor (unconfigured-picker regression data)', vendorsOk, vendorsDetail)

  // save an agent task via IPC with a plain object payload (clone-bug regression)
  const saveRes = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:save', { task: {
      name: 'E2E agent task',
      type: 'AI',
      enabled: true,
      cronExpr: '* * * * *', // every minute — scheduler fires it during the run
      config: {
        action: 'ai',
        vendorId: 'e2e',
        prompt: '打开设置页面并完成检查',
        deviceId: '${SERIAL}',
        agentMode: true,
        sessionMode: 'continue',
      },
    } })
    return JSON.stringify(r)
  })()`)
  let savedTask = null
  let saveOk = false
  let saveDetail = saveRes
  try {
    const parsed = JSON.parse(saveRes)
    savedTask = parsed?.task || parsed?.data?.task
    saveOk = Boolean(savedTask?.id && savedTask?.nextRunAt)
    saveDetail = `id=${savedTask?.id} nextRunAt=${savedTask?.nextRunAt} name=${savedTask?.name} err=${parsed?.error?.message || ''}`
  }
  catch {}
  check('S5.2 task saved via IPC (clone-bug regression)', saveOk, saveDetail)

  // run #1 — agent loop with unlimited steps (4 tool rounds, maxSteps=0)
  await ctrl(LLM_CTRL, 'POST', '/reset')
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { tool: { name: 'open_app', arguments: { package: 'com.android.settings' } } },
    { tool: { name: 'screenshot', arguments: {} } },
    { tool: { name: 'tap', arguments: { x: 100, y: 500 } } },
    { tool: { name: 'get_ui_layout', arguments: {} } },
    { text: 'AGENT_RUN_1_DONE' },
  ] })

  const run1 = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:run', { id: ${JSON.stringify(savedTask?.id)} })
    return JSON.stringify(r)
  })()`)
  let run1Ok = false
  let run1Detail = run1
  try {
    const parsed = JSON.parse(run1)
    const run = parsed?.run || parsed?.data?.run
    run1Ok = (run?.output || '').includes('AGENT_RUN_1_DONE')
    run1Detail = `status=${run?.status} output=${String(run?.output || '').slice(0, 80)} err=${parsed?.error?.message || ''}`
  }
  catch {}
  check('S5.3 agent task run #1 completes 4-step autonomous loop', run1Ok, run1Detail)

  const { calls: adbCalls } = await ctrl(ADB_CTRL, 'GET', '/calls')
  const monkeyCalled = adbCalls.some(c => c.command.includes('monkey -p com.android.settings'))
  const tapCalled = adbCalls.some(c => c.command.includes('-touch') || c.command.includes('input tap'))
  check('S5.4 agent actually operated the device (monkey/tap on fake adb)', monkeyCalled && tapCalled, `monkey=${monkeyCalled} tap=${tapCalled}`)

  const taskSession = (readStore()?.copilot?.sessions || []).find(s => s.taskId === savedTask?.id)
  check('S5.5 persistent task conversation created (taskId-scoped, device scope)', Boolean(taskSession && taskSession.scope === SERIAL), `scope=${taskSession?.scope}`)

  // run #2 — same session: the model must see run #1 history
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { text: 'REMEMBER_RUN_1_SAW_HISTORY' },
  ] })
  const run2 = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:run', { id: ${JSON.stringify(savedTask?.id)} })
    return JSON.stringify(r)
  })()`)

  const { requests: taskReqs } = await ctrl(LLM_CTRL, 'GET', '/requests')
  const run2Req = taskReqs[taskReqs.length - 1]
  const sawHistory = JSON.stringify(run2Req?.messages || []).includes('AGENT_RUN_1_DONE')
  check('S5.6 sessionMode=continue keeps memory across runs (run #2 sees run #1)', sawHistory, `msgs=${(run2Req?.messages || []).length}`)

  const sessionsAfter = readStore()?.copilot?.sessions || []
  const tSessions = sessionsAfter.filter(s => s.taskId === savedTask?.id)
  check('S5.7 both runs share ONE conversation (no new session per run)', tSessions.length === 1 && tSessions[0].messages.length > 4, `${tSessions.length} session(s), ${tSessions[0]?.messages?.length} messages`)

  // scheduler: the enabled per-minute task fires on its own (minute boundary
  // + 20s scan). No file hacking — the main process owns its task memory.
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [{ text: 'SCHEDULED_FIRE_OK' }] })

  const scheduledRun = await waitFor(async () => {
    const runsRes = await main2.evaluate(`(async () => {
      const r = await window.$preload.ipcxRenderer.invoke('tasks:runs', { id: ${JSON.stringify(savedTask?.id)} })
      return JSON.stringify(r)
    })()`)
    try {
      const parsed = JSON.parse(runsRes)
      const runs = parsed?.runs || parsed?.data?.runs || []
      return runs.find(r => r.source === 'schedule' || r.trigger === 'schedule' || String(r.output || '').includes('SCHEDULED_FIRE_OK')) || null
    }
    catch { return null }
  }, { timeoutMs: 110000, intervalMs: 2000, label: 'scheduled run' })
  check('S5.8 scheduler fires the task on time (minute cron + 20s scan)', Boolean(scheduledRun), JSON.stringify(scheduledRun)?.slice(0, 120))

  // ════════ S6 · phantom-offline self-heal (bug regression) ════════
  console.log('\n[S6] phantom-offline self-heal')

  await ctrl(ADB_CTRL, 'POST', '/reset')
  const t0 = Date.now()
  await ctrl(ADB_CTRL, 'POST', '/state', { serial: SERIAL, type: 'offline' })

  // UI should reflect offline at some point (tracker change event forwarded)
  const uiOffline = await waitFor(() => main2.evaluate(`document.body.innerText.toLowerCase().includes('offline') || document.body.innerText.includes('离线')`), { timeoutMs: 15000, intervalMs: 600, label: 'offline badge' })
  check('S6.1 offline state reaches the UI (change event forwarded)', Boolean(uiOffline))

  // self-heal: health check (≤10s) + reconnect offline → device back online
  const healed = await waitFor(async () => {
    const { devices } = await ctrl(ADB_CTRL, 'GET', '/state')
    return devices[SERIAL] === 'device'
  }, { timeoutMs: 35000, intervalMs: 800, label: 'device self-heal' })
  const healMs = Date.now() - t0
  check('S6.2 device self-heals after going offline (no replug)', Boolean(healed), `${healMs}ms`)

  const { calls: healCalls } = await ctrl(ADB_CTRL, 'GET', '/calls')
  const reconnectCalled = healCalls.some(c => c.command === 'adb reconnect offline')
  check('S6.3 app executed `adb reconnect offline` (child-process path)', reconnectCalled, `${healCalls.length} calls`)

  const uiBackOnline = await waitFor(() => main2.evaluate(`document.body.innerText.includes('${SERIAL}') && !(document.body.innerText.toLowerCase().includes('offline') || document.body.innerText.includes('离线'))`), { timeoutMs: 15000, intervalMs: 600, label: 'online badge' })
  check('S6.4 UI shows the device online again', Boolean(uiBackOnline))

  const stillAlive = electronProc && !electronProc.killed && electronProc.exitCode === null
  check('S6.5 Electron process alive through the whole run', Boolean(stillAlive), `exitCode=${electronProc?.exitCode}`)
  check('S6.6 no renderer crash dialog in logs', !electronLogs.includes('A JavaScript error occurred'))

  // ════════ S7 · v3.8.0: scheduler reliability ════════
  console.log('\n[S7] scheduler reliability (skip-with-reason / catch-up / concurrency)')

  // Silence the per-minute probe tasks so they stop consuming mock scripts.
  for (const taskId of [savedTask?.id, 'task_catchup'].filter(Boolean)) {
    await main2.evaluate(`(async () => {
      await window.$preload.ipcxRenderer.invoke('tasks:toggle', { id: ${JSON.stringify(taskId)}, enabled: false })
      return true
    })()`)
  }
  await sleep(500)

  const runsAll = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:runs', { limit: 200 })
    return JSON.stringify(r)
  })()`)
  let allRuns = []
  try {
    const parsed = JSON.parse(runsAll)
    allRuns = parsed?.runs || parsed?.data?.runs || []
  }
  catch {}

  const skipRun = allRuns.find(r => r.refId === 'task_stale_skip' && r.status === 'SKIPPED')
  check('S7.1 >24h-overdue occurrence skipped WITH recorded reason', Boolean(skipRun && /overdue/i.test(String(skipRun.error || ''))), JSON.stringify(skipRun)?.slice(0, 140))

  const staleRescheduled = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:list')
    const parsed = JSON.parse(JSON.stringify(r))
    const tasks = parsed?.tasks || parsed?.data?.tasks || []
    return JSON.stringify(tasks.find(t => t.id === 'task_stale_skip')?.nextRunAt)
  })()`)
  let staleOk = false
  try {
    staleOk = Date.parse(JSON.parse(staleRescheduled)) > Date.now()
  }
  catch {}
  check('S7.2 skipped task rescheduled to a future slot', staleOk, staleRescheduled)

  const catchupRun = allRuns.find(r => r.refId === 'task_catchup' && r.status === 'SUCCESS' && (r.trigger === 'schedule' || r.source === 'schedule'))
  check('S7.3 10min-overdue task caught up and ran (sleep/app-closed scenario)', Boolean(catchupRun), JSON.stringify(catchupRun)?.slice(0, 140))

  // ════════ S8 · v3.8.0: embedded web UI ════════
  console.log('\n[S8] embedded web UI (port + password + chat + tasks)')

  const WEB_PORT = 38081
  await main2.evaluate(`(async () => {
    const settings = window.$preload.store.get('copilot.settings')
    settings.webServer = { enabled: true, port: ${WEB_PORT}, password: '' }
    window.$preload.store.set('copilot.settings', settings)
    return true
  })()`)

  const healthz = await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${WEB_PORT}/healthz`)
      return res.ok ? await res.json() : null
    }
    catch { return null }
  }, { timeoutMs: 15000, intervalMs: 500, label: 'web server healthz' })
  check('S8.1 web server starts from settings (healthz responds)', Boolean(healthz?.ok))

  const page = await fetch(`http://127.0.0.1:${WEB_PORT}/`).then(r => r.text())
  check('S8.2 web page served (contains app shell + login flow)', page.includes('Escrcpy') && page.includes('api/login'))

  const webStatusIpc = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('web:status')
    return JSON.stringify(r)
  })()`)
  let webStatusOk = false
  try {
    const parsed = JSON.parse(webStatusIpc)
    webStatusOk = parsed?.running === true && (parsed?.urls || []).some(u => String(u).includes(`127.0.0.1:${WEB_PORT}`))
  }
  catch {}
  check('S8.3 web:status IPC reports running + reachable URL', webStatusOk, webStatusIpc.slice(0, 160))

  // web chat, JSON mode, against the same mock LLM the desktop uses
  await ctrl(LLM_CTRL, 'POST', '/reset')
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [{ text: 'WEB_CHAT_OK_ANSWER' }] })
  const chatJson = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'hello from web', stream: false, name: 'web e2e' }),
  }).then(r => r.json())
  const webSessionId = chatJson?.sessionId || ''
  check('S8.4 web chat JSON round-trip (same engine as desktop)', Boolean(chatJson?.success && String(chatJson?.output || '').includes('WEB_CHAT_OK_ANSWER') && webSessionId), JSON.stringify(chatJson)?.slice(0, 140))

  // web chat, SSE streaming mode
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [{ text: 'WEB_SSE_STREAM_DONE' }] })
  const sseRes = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: webSessionId, content: 'stream please', stream: true }),
  })
  const sseText = await sseRes.text()
  const sseFrames = sseText.split('\n\n').filter(f => f.startsWith('data:')).map(f => JSON.parse(f.slice(5)))
  const sawDelta = sseFrames.some(e => e.type === 'text-delta')
  const sawDone = sseFrames.some(e => e.type === 'done' && String(e.output || '').includes('WEB_SSE_STREAM_DONE'))
  check('S8.5 web chat SSE streaming (text-delta frames + done)', sawDelta && sawDone, `${sseFrames.length} frames`)

  // web exposes tasks and can run them
  const webTasks = await fetch(`http://127.0.0.1:${WEB_PORT}/api/tasks`).then(r => r.json())
  const webTaskList = webTasks?.tasks || []
  check('S8.6 web task list matches app tasks', webTaskList.length >= 2 && webTaskList.every(t => !t.config?.vendorSnapshot), `${webTaskList.length} tasks (vendorSnapshot stripped: ${webTaskList.every(t => !t.config?.vendorSnapshot)})`)

  // password auth: flip password → server restarts bound to 0.0.0.0 with auth
  await main2.evaluate(`(async () => {
    const settings = window.$preload.store.get('copilot.settings')
    settings.webServer.password = 'e2e-secret'
    window.$preload.store.set('copilot.settings', settings)
    return true
  })()`)

  await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${WEB_PORT}/api/status`)
      return res.status === 401
    }
    catch { return false }
  }, { timeoutMs: 15000, intervalMs: 600, label: 'web auth enforcement' })
  check('S8.7 password protects /api (401 without session)', true)

  const badLogin = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }),
  }).then(r => r.status)
  const goodLogin = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'e2e-secret' }),
  })
  const setCookie = goodLogin.headers.get('set-cookie') || ''
  const cookieToken = /escrcpy_web=([^;]+)/.exec(setCookie)?.[1] || ''
  const authedStatus = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/status`, { headers: { cookie: `escrcpy_web=${cookieToken}` } }).then(r => r.status)
  check('S8.8 login flow works (wrong pw 401 → right pw sets cookie → 200)',
    badLogin === 401 && Boolean(cookieToken) && authedStatus === 200,
    `wrong=${badLogin} authed=${authedStatus} token=${cookieToken ? 'ok' : 'MISSING'}`)

  // ════════ S9 · v3.8.0: task context modes (existing / shared) ════════
  console.log('\n[S9] task context modes (pick existing / shared one-context)')

  await ctrl(LLM_CTRL, 'POST', '/reset')
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { text: 'EXISTING_MODE_DONE' },
    { text: 'SHARED_TASK_A_DONE' },
    { text: 'SHARED_TASK_B_DONE' },
  ] })

  // 'existing': bind a task to the web-created conversation and run it
  const saveExisting = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:save', { task: {
      name: 'Existing-context task', type: 'AI', enabled: false, cronExpr: '0 5 * * *',
      config: { action: 'ai', vendorId: 'e2e', prompt: 'continue in existing session', sessionMode: 'existing', sessionId: ${JSON.stringify(webSessionId)} },
    } })
    return JSON.stringify(r)
  })()`)
  let existingTaskId = ''
  try { existingTaskId = JSON.parse(saveExisting)?.task?.id || '' }
  catch {}
  check('S9.1 sessionMode=existing task saves with picked conversation', Boolean(existingTaskId), saveExisting.slice(0, 120))

  const existingRun = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:run', { id: ${JSON.stringify(existingTaskId)} })
    return JSON.stringify(r)
  })()`)
  let existingRunOk = false
  try { existingRunOk = String(JSON.parse(existingRun)?.run?.output || '').includes('EXISTING_MODE_DONE') }
  catch {}
  check('S9.2 existing-context run completes', existingRunOk, existingRun.slice(0, 120))

  const webSessionAfter = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/sessions/${webSessionId}`, { headers: { cookie: `escrcpy_web=${cookieToken}` } }).then(r => r.json())
  const existingMsgCount = (webSessionAfter?.session?.messages || []).length
  check('S9.3 existing-context run appended to the SAME conversation', existingMsgCount >= 5, `${existingMsgCount} messages in web session`)

  // 'shared': two tasks sharing ONE global conversation
  const saveShared = await main2.evaluate(`(async () => {
    const mk = name => window.$preload.ipcxRenderer.invoke('tasks:save', { task: {
      name, type: 'AI', enabled: false, cronExpr: '0 5 * * *',
      config: { action: 'ai', vendorId: 'e2e', prompt: name + ' prompt', sessionMode: 'shared' },
    } })
    const a = await mk('Shared task A')
    const b = await mk('Shared task B')
    return JSON.stringify({ a: JSON.parse(JSON.stringify(a))?.task?.id, b: JSON.parse(JSON.stringify(b))?.task?.id })
  })()`)
  let sharedIds = { a: '', b: '' }
  try { sharedIds = JSON.parse(saveShared) }
  catch {}
  check('S9.4 two shared-context tasks saved', Boolean(sharedIds.a && sharedIds.b), saveShared.slice(0, 120))

  await main2.evaluate(`(async () => {
    await window.$preload.ipcxRenderer.invoke('tasks:run', { id: ${JSON.stringify(sharedIds.a)} })
    await window.$preload.ipcxRenderer.invoke('tasks:run', { id: ${JSON.stringify(sharedIds.b)} })
    return true
  })()`)

  const sharedSession = (readStore()?.copilot?.sessions || []).find(s => s.id === 'session_shared_tasks')
  const sharedMsgCount = (sharedSession?.messages || []).length
  const sharedSawBoth = JSON.stringify(sharedSession?.messages || []).includes('SHARED_TASK_A_DONE') && JSON.stringify(sharedSession?.messages || []).includes('SHARED_TASK_B_DONE')
  check('S9.5 all shared tasks reason inside ONE conversation', Boolean(sharedSession) && sharedSawBoth && sharedMsgCount >= 4, `messages=${sharedMsgCount} sawBoth=${sharedSawBoth}`)

  // ════════ S10 · v3.8.0: error isolation + auto-reconnect ════════
  console.log('\n[S10] error isolation (dangling tool_calls) + renderer auto-reconnect')

  // Inject a half-finished agent turn (assistant tool_calls without results)
  // into the web conversation — the next chat must repair it instead of
  // failing with a provider 400 forever.
  await main2.evaluate(`(async () => {
    const sessions = window.$preload.store.get('copilot.sessions') || []
    const s = sessions.find(x => x.id === ${JSON.stringify(webSessionId)})
    if (s) {
      s.messages.push({ id: 'dangling_assistant', role: 'assistant', content: 'let me check', tool_calls: [{ id: 'call_dangling_1', type: 'function', function: { name: 'get_device_info', arguments: '{}' } }], createdAt: new Date().toISOString() })
      window.$preload.store.set('copilot.sessions', sessions)
    }
    return true
  })()`)

  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [{ text: 'REPAIRED_AFTER_DANGLING' }] })
  const repairedChat = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cookie': `escrcpy_web=${cookieToken}` },
    body: JSON.stringify({ sessionId: webSessionId, content: 'continue after crash', stream: false }),
  }).then(r => r.json())
  const repairedSession = (readStore()?.copilot?.sessions || []).find(s => s.id === webSessionId)
  const syntheticTool = (repairedSession?.messages || []).find(m => m.role === 'tool' && m.tool_call_id === 'call_dangling_1')
  check('S10.1 dangling tool_calls repaired (synthetic result injected)', Boolean(repairedChat?.success && syntheticTool), `synthetic=${Boolean(syntheticTool)} out=${String(repairedChat?.output || '').slice(0, 60)}`)

  // Renderer auto-reconnect: two transient 500s, then success — the chat
  // must recover on its own and show the reconnect banner meanwhile.
  await ctrl(LLM_CTRL, 'POST', '/reset')
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { error: { status: 500, message: 'mock transient failure 1' } },
    { error: { status: 500, message: 'mock transient failure 2' } },
    { text: 'RECONNECT_RECOVERED_ANSWER' },
  ] })

  const requestsBeforeReconnect = (await ctrl(LLM_CTRL, 'GET', '/stats')).stats.requests

  await sendInCopilot(copilot2, '触发一次瞬态错误')

  let sawReconnectBanner = false
  const reconnectAnswer = await (async () => {
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      // sample both conditions on each poll

      const banner = await copilot2.evaluate(`document.body.innerText.includes('正在自动重连') || document.body.innerText.includes('auto reconnecting') || document.body.innerText.includes('copilot.reconnect.banner')`)
      if (banner)
        sawReconnectBanner = true

      const done = await copilot2.evaluate(`document.body.innerText.includes('RECONNECT_RECOVERED_ANSWER')`)
      if (done)
        return true

      await sleep(300)
    }
    return false
  })()
  check('S10.2 renderer auto-reconnect recovers after transient 500s', Boolean(reconnectAnswer))
  check('S10.3 reconnect banner visible during retries', sawReconnectBanner)

  const requestsAfterReconnect = (await ctrl(LLM_CTRL, 'GET', '/stats')).stats.requests
  check('S10.4 provider actually saw the retries (3 requests for one turn)', requestsAfterReconnect - requestsBeforeReconnect >= 3, `delta=${requestsAfterReconnect - requestsBeforeReconnect}`)

  // Error isolation: a hard-failed turn must not poison the next one.
  await ctrl(LLM_CTRL, 'POST', '/reset')
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { error: { status: 500, message: 'fail 1' } },
    { error: { status: 500, message: 'fail 2' } },
    { error: { status: 500, message: 'fail 3' } },
    { error: { status: 500, message: 'fail 4' } },
    { error: { status: 500, message: 'fail 5' } },
    { error: { status: 500, message: 'fail 6' } },
    { error: { status: 500, message: 'fail 7' } },
  ] })

  await sendInCopilot(copilot2, '这轮会失败')

  await waitFor(() => copilot2.evaluate(`/(auto-reconnected 5 times|\u91CD\u8FDE 5 \u6B21|copilot\.reconnect\.exhausted)/.test(document.body.innerText)`), { timeoutMs: 60000, intervalMs: 800, label: 'exhausted error banner' })
  check('S10.5 persistent failures surface a clear error after retries exhausted', true)

  // next turn must succeed cleanly (no error inertia)
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [{ text: 'NEXT_TURN_CLEAN_ANSWER' }] })
  await sendInCopilot(copilot2, '下一轮正常')
  const nextTurnClean = await waitFor(() => copilot2.evaluate(`document.body.innerText.includes('NEXT_TURN_CLEAN_ANSWER')`), { timeoutMs: 30000, intervalMs: 600, label: 'clean next turn' })
  check('S10.6 next turn succeeds after a hard failure (error isolation)', Boolean(nextTurnClean))

  // ════════ S11 · v3.9.0: group control + smart recognition + multi-device AI ════════
  console.log('\n[S11] group control (群控) + image recognition (智能识别) + multi-device AI')

  // a second fake device for group control
  await ctrl(ADB_CTRL, 'POST', '/add', { serial: 'E2ETEST002' })
  await sleep(1200)

  const groupDevices = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('group:devices')
    return JSON.stringify(r)
  })()`)
  let groupDeviceCount = 0
  try {
    groupDeviceCount = (JSON.parse(groupDevices)?.devices || []).length
  }
  catch {}
  check('S11.1 group:devices lists both fake devices', groupDeviceCount >= 2, groupDevices.slice(0, 140))

  // broadcast tap to both devices through the group IPC
  const broadcastRes = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('group:broadcast', {
      deviceIds: ['E2ETEST001', 'E2ETEST002'],
      action: { action: 'tap', x: 111, y: 222 },
    })
    return JSON.stringify(r)
  })()`)
  let broadcastOk = false
  try {
    broadcastOk = JSON.parse(broadcastRes)?.success === true
  }
  catch {}
  check('S11.2 group:broadcast taps every selected device', broadcastOk, broadcastRes.slice(0, 140))

  const { calls: postBroadcastCalls } = await ctrl(ADB_CTRL, 'GET', '/calls')
  const tappedDevices = new Set(postBroadcastCalls.filter(c => c.command.includes('input tap') || c.command.includes('-touch')).map(c => c.serial))
  check('S11.3 broadcast reached BOTH devices (per-device input tap)', tappedDevices.has('E2ETEST001') && tappedDevices.has('E2ETEST002'), [...tappedDevices].join(','))

  // smart recognition: capture a screenshot via a task, then match it as a template
  const shotSave = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:save', { task: {
      name: 'S11 screenshot probe', type: 'AUTOMATION', enabled: false, cronExpr: '0 5 * * *',
      config: { action: 'screenshot', deviceId: 'E2ETEST001' },
    } })
    const saved = JSON.parse(JSON.stringify(r))
    const run = await window.$preload.ipcxRenderer.invoke('tasks:run', { id: saved?.task?.id })
    return JSON.stringify(run)
  })()`)
  let templatePath = ''
  try {
    templatePath = String(JSON.parse(shotSave)?.run?.output || '').replace('screenshot saved: ', '')
  }
  catch {}
  check('S11.4 screenshot probe produced a template file', Boolean(templatePath), templatePath)

  const matchSave = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('tasks:save', { task: {
      name: 'S11 match probe', type: 'AUTOMATION', enabled: false, cronExpr: '0 5 * * *',
      config: { action: 'match_image', deviceId: 'E2ETEST001', templatePath: ${JSON.stringify('${TEMPLATE}')}, threshold: 0.9 },
    } })
    const saved = JSON.parse(JSON.stringify(r))
    const run = await window.$preload.ipcxRenderer.invoke('tasks:run', { id: saved?.task?.id })
    return JSON.stringify(run)
  })()`.replace('${TEMPLATE}', templatePath))
  let matchOk = false
  let matchDetail = matchSave
  try {
    const run = JSON.parse(matchSave)?.run
    matchOk = run?.status === 'SUCCESS' && String(run?.output || '').includes('FOUND')
    matchDetail = `status=${run?.status} output=${String(run?.output || '').slice(0, 100)}`
  }
  catch {}
  check('S11.5 match_image recognizes the identical template (opencv TM_CCOEFF_NORMED)', matchOk, matchDetail)

  // multi-device AI: one web conversation controlling BOTH devices (broadcast tool)
  await ctrl(LLM_CTRL, 'POST', '/reset')
  await ctrl(LLM_CTRL, 'POST', '/script', { steps: [
    { tool: { name: 'broadcast_tap', arguments: { x: 77, y: 88 } } },
    { text: 'MULTI_DEVICE_AI_DONE' },
  ] })
  const multiChat = await fetchRetry(`http://127.0.0.1:${WEB_PORT}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cookie': `escrcpy_web=${cookieToken}` },
    body: JSON.stringify({ content: 'tap on all my devices', agentMode: true, deviceIds: ['E2ETEST001', 'E2ETEST002'], stream: false, name: 'multi-device e2e' }),
  }).then(r => r.json())
  check('S11.6 multi-device AI conversation completes (broadcast tool round)', Boolean(multiChat?.success && String(multiChat?.output || '').includes('MULTI_DEVICE_AI_DONE')), JSON.stringify(multiChat)?.slice(0, 140))

  const { calls: postAiCalls } = await ctrl(ADB_CTRL, 'GET', '/calls')
  const aiTapped = new Set(postAiCalls.filter(c => (c.command.includes('input tap') || c.command.includes('-touch')) && c.command.includes('77')).map(c => c.serial))
  check('S11.7 AI broadcast_tap reached BOTH devices in one conversation', aiTapped.has('E2ETEST001') && aiTapped.has('E2ETEST002'), [...aiTapped].join(','))

  // ════════ S12 · v3.10.0: embedded mirror (内嵌镜像) + keyboard mapping ════════
  console.log('\n[S12] embedded mirror (内嵌镜像) + keyboard mapping')

  const mirrorStatus = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('mirror:status', { deviceId: 'E2ETEST001' })
    return JSON.stringify(r)
  })()`)
  let statusOk = false
  try {
    statusOk = JSON.parse(mirrorStatus)?.success === true && JSON.parse(mirrorStatus)?.running === false
  }
  catch {}
  check('S12.1 mirror:status IPC responds (no session yet)', statusOk, mirrorStatus.slice(0, 140))

  const mirrorStart = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('mirror:start', { deviceId: 'E2ETEST001', options: { audio: false } })
    return JSON.stringify(r)
  })()`)
  let startHandled = false
  try {
    const parsed = JSON.parse(mirrorStart)
    startHandled = parsed?.success === false && Boolean(parsed?.error?.message)
  }
  catch {}
  check('S12.2 mirror:start fails gracefully without a real scrcpy device', startHandled, mirrorStart.slice(0, 180))

  const keymapSaved = await main2.evaluate(`(async () => {
    const mapping = {
      id: 'map_e2e', kind: 'tap', enabled: true,
      trigger: { combo: 'KeyQ' }, position: { x: 0.25, y: 0.75 }, action: { type: 'tap' },
    }
    const profile = { id: 'profile_e2e', name: 'E2E', mappings: [mapping], settings: { behaviorLevel: 'medium' } }
    const saved = await window.$preload.ipcxRenderer.invoke('mirror:keymap:save', {
      deviceId: 'E2ETEST001', profiles: [profile], activeId: profile.id, settings: {},
    })
    const loaded = await window.$preload.ipcxRenderer.invoke('mirror:keymap:get', { deviceId: 'E2ETEST001' })
    return JSON.stringify({ saved, loaded })
  })()`)
  let keymapOk = false
  try {
    const parsed = JSON.parse(keymapSaved)
    const loaded = parsed?.loaded
    const profile = (loaded?.profiles || []).find(p => p.id === 'profile_e2e')
    keymapOk = Boolean(profile && profile.mappings?.[0]?.trigger?.combo === 'KeyQ' && profile.mappings[0].position.x === 0.25)
  }
  catch {}
  check('S12.3 keyboard mapping profile persists (save → load)', keymapOk, keymapSaved.slice(0, 180))

  const mirrorDisplays = await main2.evaluate(`(async () => {
    const r = await window.$preload.ipcxRenderer.invoke('mirror:displays', { deviceId: 'E2ETEST001' })
    return JSON.stringify(r)
  })()`)
  let displaysOk = false
  try {
    displaysOk = JSON.parse(mirrorDisplays)?.success === true
  }
  catch {}
  check('S12.7 mirror:displays IPC responds (multi-display cooperation)', displaysOk, mirrorDisplays.slice(0, 120))

  const webMirrorStatus = await fetch(`http://127.0.0.1:${WEB_PORT}/api/mirror/status`, { headers: { cookie: `escrcpy_web=${cookieToken}` } }).then(r => r.json()).catch(() => null)
  check('S12.4 web /api/mirror/status responds', Boolean(webMirrorStatus?.success), JSON.stringify(webMirrorStatus)?.slice(0, 120))

  const webKeymap = await fetch(`http://127.0.0.1:${WEB_PORT}/api/mirror/keymap?deviceId=E2ETEST001`, { headers: { cookie: `escrcpy_web=${cookieToken}` } }).then(r => r.json()).catch(() => null)
  const webProfile = (webKeymap?.profiles || []).find(p => p.id === 'profile_e2e')
  check('S12.5 web keymap API returns the saved profile', Boolean(webProfile && webProfile.mappings?.length === 1), JSON.stringify(webKeymap)?.slice(0, 140))

  const webPage = await fetch(`http://127.0.0.1:${WEB_PORT}/`, { headers: { cookie: `escrcpy_web=${cookieToken}` } }).then(r => r.text()).catch(() => '')
  check('S12.6 web page ships the mirror tab + WebCodecs decoder', webPage.includes('tab-mirror') && webPage.includes('VideoDecoder'), `len=${webPage.length}`)

  // ════════ S13 · v3.10.0: visual workflow editor + web workflow chain ════════
  console.log('\n[S13] visual workflow editor + web workflow chain')

  const wfSave = await main2.evaluate(`(async () => {
    const workflow = {
      id: 'wf_e2e_visual',
      name: 'E2E visual workflow',
      description: 'delay-only chain for the visual editor',
      notifyOnComplete: false,
      steps: [{ id: 'step_delay_1', type: 'delay', name: 'Wait', seconds: 1 }],
    }
    const r = await window.$preload.ipcxRenderer.invoke('workflows:save', { workflow })
    return JSON.stringify(r)
  })()`)
  let wfSaved = null
  try {
    wfSaved = JSON.parse(wfSave)
  }
  catch {}
  check('S13.1 workflow saves through IPC', Boolean(wfSaved?.success), wfSave.slice(0, 140))

  const webWorkflows = await fetch(`http://127.0.0.1:${WEB_PORT}/api/workflows`, { headers: { cookie: `escrcpy_web=${cookieToken}` } }).then(r => r.json()).catch(() => null)
  const webWf = (webWorkflows?.workflows || []).find(w => w.id === 'wf_e2e_visual')
  check('S13.2 web /api/workflows returns the chain with steps', Boolean(webWf && webWf.steps?.length === 1 && webWf.steps[0].type === 'delay'), JSON.stringify(webWf)?.slice(0, 160))

  const webWfRun = await fetch(`http://127.0.0.1:${WEB_PORT}/api/workflows/wf_e2e_visual/run`, {
    method: 'POST', headers: { cookie: `escrcpy_web=${cookieToken}` },
  }).then(r => r.json()).catch(() => null)
  check('S13.3 web runs the workflow end-to-end', Boolean(webWfRun?.success && webWfRun?.run?.status === 'SUCCESS'), JSON.stringify(webWfRun)?.slice(0, 160))

  const webPageWf = await fetch(`http://127.0.0.1:${WEB_PORT}/`, { headers: { cookie: `escrcpy_web=${cookieToken}` } }).then(r => r.text()).catch(() => '')
  check('S13.4 web page renders the workflow chain panel', webPageWf.includes('workflow-list') && webPageWf.includes('refreshWorkflows'), `len=${webPageWf.length}`)

  // teardown
  main.close(); main2.close(); copilot.close(); copilot2.close()
  console.log(`\n== ${results.filter(r => r.ok).length}/${results.length} checks passed ==`)
  cleanupAll()
  process.exit(results.every(r => r.ok) ? 0 : 1)
}

main().catch((error) => {
  console.error('\nRUNNER CRASHED:', error)
  console.error('---- electron log tail ----')
  console.error(electronLogs.slice(-3000))
  results.forEach(r => !r.ok && console.log(`FAILED: ${r.name}`))
  cleanupAll()
  process.exit(1)
})
