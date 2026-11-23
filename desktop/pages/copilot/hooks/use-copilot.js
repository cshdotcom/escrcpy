import { buildToolSchemas, DEFAULT_SETTINGS, isDangerousShell, KEY_EVENTS, VENDOR_PRESETS } from '../configs/index.js'
import { buildApiMessages, compactSessionContext, estimateTokens, sanitizeSessionMessages } from '@escrcpy/shared'

const { t } = useI18n()

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function nowISO() {
  return new Date().toISOString()
}

/** Load persisted copilot settings, seeding built-in vendors on first run. */
function loadSettings() {
  const stored = window.$preload.store.get('copilot.settings') || {}

  const vendors = { ...(stored.vendors || {}) }
  for (const preset of VENDOR_PRESETS) {
    if (!vendors[preset.id])
      vendors[preset.id] = { ...preset, apiKey: '', vision: preset.id === 'glm' || preset.id === 'openai' || preset.id === 'anthropic' || preset.id === 'gemini' }
  }

  // Migrate legacy settings that did not include the new autonomous defaults.
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    vendors,
  }
  // Treat negative/missing maxSteps as 0 (unlimited) for safety.
  if (!Number.isFinite(merged.maxSteps) || merged.maxSteps < 0)
    merged.maxSteps = 0
  const contextWindow = Number(merged.contextWindow)
  if (!Number.isFinite(contextWindow) || contextWindow < 4000)
    merged.contextWindow = 32000
  else
    merged.contextWindow = contextWindow

  return merged
}

/**
 * The Copilot agent: session management, streaming chat orchestration
 * and tool execution against the selected Android device.
 *
 * Sessions are scoped to the window's instanceId (typically the device id the
 * Copilot window was opened for) so that multiple Copilot windows opened for
 * different devices no longer share the same conversation list.
 */
export function useCopilot() {
  const settings = reactive(loadSettings())
  const windowScope = window.$preload.payload?.instanceId || window.$preload.payload?.device?.id || 'default'

  const allSessions = ref(window.$preload.store.get('copilot.sessions') || [])
  // Only show sessions belonging to this window's scope; legacy sessions
  // without a scope are kept visible everywhere for backward compatibility.
  const sessions = computed(() => allSessions.value.filter((session) => {
    if (!session.scope)
      return true
    return session.scope === windowScope
  }))

  const activeSessionId = ref(sessions.value[0]?.id || '')

  const isStreaming = ref(false)
  const streamingText = ref('')
  const streamingSteps = ref(0)
  const stepLimitReached = ref(false)
  const lastError = ref(null)

  // Auto-reconnect state for the visible banner ("reconnecting 2/5…")
  const isReconnecting = ref(false)
  const reconnectAttempt = ref(0)
  const reconnectMax = ref(0)

  // Pending tool confirmation (human in the loop)
  const pendingConfirm = ref(null)
  let confirmResolver = null

  const allowAllThisSession = ref(false)

  let currentRequestAborted = false
  const currentRequestId = ref('')

  const activeVendor = computed(() => {
    return settings.vendors[settings.activeVendorId] || Object.values(settings.vendors)[0] || null
  })

  const isConfigured = computed(() => {
    const vendor = activeVendor.value
    return Boolean(vendor?.baseUrl && vendor?.model)
  })

  const activeSession = computed(() => {
    return sessions.value.find(session => session.id === activeSessionId.value) || null
  })

  // ── persistence ─────────────────────────────────────────────
  watch(() => allSessions.value, (value) => {
    try {
      const serialized = JSON.parse(JSON.stringify(value))

      // The main-process task executor also writes `copilot.sessions` (task
      // conversations with `taskId`). Merge those in so a stale in-memory
      // copy from this window never clobbers a session another process just
      // wrote — and so renderer-side deletions never resurrect them.
      const disk = window.$preload.store.get('copilot.sessions') || []
      const taskSessions = (Array.isArray(disk) ? disk : []).filter(session => session?.id && session.taskId)
      const merged = [...taskSessions, ...serialized.filter(session => !session.taskId)]

      window.$preload.store.set('copilot.sessions', merged)
    }
    catch (error) {
      console.error('[Copilot] persist sessions failed:', error)
    }
  }, { deep: true })

  function persistSettings() {
    // Mirror launchOnBoot into Electron's login-item settings so scheduled
    // tasks fire even if the user has not opened the app after system boot.
    try {
      window.$preload.ipcxRenderer.invoke('tasks:set-launch-on-boot', { enabled: Boolean(settings.launchOnBoot) }).catch(() => {})
    }
    catch {
      // ignore — the IPC may not be available in older hosts
    }

    try {
      window.$preload.store.set('copilot.settings', JSON.parse(JSON.stringify({
        ...toRaw(settings),
        vendors: toRaw(settings.vendors),
      })))
    }
    catch (error) {
      // The hardened store retries transient fs errors; if it still fails,
      // surface it instead of failing silently (the old "config does not
      // persist" bug was invisible to the user).
      console.error('[Copilot] persist settings failed:', error)
      ElMessage?.error?.(error?.message || 'Failed to save Copilot settings')
    }
  }

  // ── sessions ────────────────────────────────────────────────
  function createSession(deviceId) {
    const session = {
      id: uid('session'),
      scope: windowScope,
      name: '',
      deviceId: deviceId || '',
      createdAt: nowISO(),
      updatedAt: nowISO(),
      messages: [],
    }
    allSessions.value.unshift(session)
    activeSessionId.value = session.id
    return session
  }

  function ensureSession(deviceId) {
    return activeSession.value || createSession(deviceId)
  }

  function deleteSession(id) {
    const index = allSessions.value.findIndex(session => session.id === id)
    if (index === -1)
      return

    allSessions.value.splice(index, 1)
    if (activeSessionId.value === id)
      activeSessionId.value = sessions.value[0]?.id || ''
  }

  function renameSession(id, name) {
    const session = allSessions.value.find(item => item.id === id)
    if (session)
      session.name = name
  }

  function clearSessionMessages(id) {
    const session = allSessions.value.find(item => item.id === id)
    if (session)
      session.messages = []
  }

  function clearAllSessions() {
    // Only clear sessions in the current window scope (legacy unscoped ones
    // are also cleared so the obvious "clear all" button still works).
    allSessions.value.forEach((session) => {
      if (!session.scope || session.scope === windowScope)
        session.messages = []
    })
  }

  function deleteMessage(sessionId, messageId) {
    const session = allSessions.value.find(item => item.id === sessionId)
    if (!session)
      return
    const index = session.messages.findIndex(message => message.id === messageId)
    if (index !== -1)
      session.messages.splice(index, 1)
  }

  function touchSession(session) {
    if (session)
      session.updatedAt = nowISO()
  }

  // ── vendor management ───────────────────────────────────────
  function addVendor(preset) {
    const id = uid('vendor')
    settings.vendors[id] = {
      ...preset,
      id,
      apiKey: '',
      vision: false,
    }
    settings.activeVendorId = id
    persistSettings()
    return settings.vendors[id]
  }

  function deleteVendor(id) {
    if (Object.keys(settings.vendors).length <= 1)
      return false

    delete settings.vendors[id]
    if (settings.activeVendorId === id)
      settings.activeVendorId = Object.keys(settings.vendors)[0]
    persistSettings()
    return true
  }

  function importVendors(list) {
    let count = 0
    for (const vendor of list) {
      if (!vendor?.baseUrl)
        continue
      const id = uid('vendor')
      settings.vendors[id] = {
        id,
        name: vendor.name || 'Custom',
        apiType: vendor.apiType || 'openai',
        baseUrl: vendor.baseUrl,
        apiKey: vendor.apiKey || '',
        model: vendor.model || '',
        temperature: vendor.temperature ?? 0.7,
        maxOutputTokens: vendor.maxOutputTokens ?? 4096,
        vision: vendor.vision ?? false,
      }
      count++
    }
    persistSettings()
    return count
  }

  // ── API bridge ──────────────────────────────────────────────
  function requestChat(messages, tools, onData) {
    const vendor = toRaw(activeVendor.value)
    const config = {
      apiType: vendor.apiType,
      baseUrl: vendor.baseUrl,
      apiKey: vendor.apiKey,
      model: vendor.model,
      temperature: vendor.temperature,
      maxOutputTokens: vendor.maxOutputTokens,
      streaming: settings.streaming,
    }

    currentRequestId.value = uid('req')
    currentRequestAborted = false

    return window.$preload.ipcxRenderer.invoke('copilot:chat', {
      requestId: currentRequestId.value,
      config,
      messages: JSON.parse(JSON.stringify(messages)),
      tools: JSON.parse(JSON.stringify(tools)),
      onData: (event) => {
        if (!currentRequestAborted)
          onData?.(event)
      },
    })
  }

  async function stopStreaming() {
    currentRequestAborted = true
    if (currentRequestId.value) {
      await window.$preload.ipcxRenderer.invoke('copilot:abort', { requestId: currentRequestId.value }).catch(() => {})
    }
  }

  async function fetchModels(vendor) {
    const config = {
      apiType: vendor.apiType,
      baseUrl: vendor.baseUrl,
      apiKey: vendor.apiKey,
      model: vendor.model,
    }
    return window.$preload.ipcxRenderer.invoke('copilot:fetch-models', { config })
  }

  async function testConnection(vendor) {
    const config = {
      apiType: vendor.apiType,
      baseUrl: vendor.baseUrl,
      apiKey: vendor.apiKey,
      model: vendor.model,
    }
    return window.$preload.ipcxRenderer.invoke('copilot:test-connection', { config })
  }

  // ── auto-reconnect ──────────────────────────────────────────
  // Transient provider failures (network drop, stream timeout, 5xx,
  // rate-limit) should not kill a chat turn: retry the SAME turn with
  // exponential backoff and a visible status instead of surfacing an error.
  const TRANSIENT_ERROR_CODES = new Set([
    'NETWORK_ERROR',
    'SERVER_ERROR',
    'RATE_LIMITED',
    'STREAM_TIMEOUT',
    'TIMEOUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'UNKNOWN_ERROR',
  ])

  function isTransientError(error) {
    const code = error?.code || ''
    if (TRANSIENT_ERROR_CODES.has(code))
      return true
    // Network-level failures arrive as TypeError from fetch with no code.
    if (!code && error?.message && /network|fetch|socket|stream|timeout/i.test(error.message))
      return true
    return false
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ── tool execution ──────────────────────────────────────────
  function requestToolConfirm(toolCall) {
    if (!settings.requireConfirm || allowAllThisSession.value)
      return Promise.resolve('allow')

    return new Promise((resolve) => {
      pendingConfirm.value = toolCall
      confirmResolver = resolve
    })
  }

  function resolveToolConfirm(result) {
    if (result === 'allow-all') {
      allowAllThisSession.value = true
      result = 'allow'
    }
    pendingConfirm.value = null
    confirmResolver?.(result)
    confirmResolver = null
  }

  function truncate(text, max = 8000) {
    const value = String(text ?? '')
    if (value.length <= max)
      return value
    return `${value.slice(0, max)}\n... (${value.length - max} more characters truncated)`
  }

  async function executeTool(name, args, context) {
    const adb = window.$preload.adb
    const deviceId = context.deviceId

    if (!deviceId && name !== 'list_devices')
      throw new Error(t('copilot.noDevice'))

    switch (name) {
      case 'list_devices': {
        const devices = await adb.getDeviceList()
        return JSON.stringify(devices.map(device => ({ id: device.id, status: device.status })))
      }

      case 'get_device_info': {
        const [screen, battery, model, brand, version, focus] = await Promise.all([
          adb.deviceInfo.getScreenSize(deviceId).catch(() => null),
          adb.deviceInfo.getBatteryLevel(deviceId).catch(() => null),
          adb.deviceInfo.getProperty(deviceId, 'ro.product.model').catch(() => null),
          adb.deviceInfo.getProperty(deviceId, 'ro.product.brand').catch(() => null),
          adb.deviceInfo.getProperty(deviceId, 'ro.build.version.release').catch(() => null),
          adb.deviceShell(deviceId, 'dumpsys window | grep mCurrentFocus').catch(() => null),
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
        const base64 = await adb.screencap(deviceId, { returnBase64: true })
        context.lastScreenshot = `data:image/png;base64,${base64}`
        const { width, height } = await adb.deviceInfo.getScreenSize(deviceId).catch(() => ({ width: 0, height: 0 }))
        return JSON.stringify({
          captured: true,
          width,
          height,
          attachedToConversation: Boolean(activeVendor.value?.vision),
          note: activeVendor.value?.vision ? undefined : t('copilot.error.guidance.VISION_NOT_SUPPORTED'),
        })
      }

      case 'get_ui_layout': {
        const xml = await adb.uiDump(deviceId)
        context.lastUiLayout = truncate(xml, 12000)
        return context.lastUiLayout
      }

      case 'tap': {
        await adb.input.tap(deviceId, Math.round(args.x), Math.round(args.y))
        await capturePostActionContext(context, deviceId)
        return JSON.stringify({ success: true, action: 'tap', x: args.x, y: args.y })
      }

      case 'swipe': {
        await adb.input.swipe(deviceId, Math.round(args.x1), Math.round(args.y1), Math.round(args.x2), Math.round(args.y2), args.duration || 300)
        await capturePostActionContext(context, deviceId)
        return JSON.stringify({ success: true, action: 'swipe', from: [args.x1, args.y1], to: [args.x2, args.y2] })
      }

      case 'input_text': {
        await adb.input.text(deviceId, String(args.text ?? ''))
        await capturePostActionContext(context, deviceId)
        return JSON.stringify({ success: true, action: 'input_text', text: args.text })
      }

      case 'key': {
        const keyCode = KEY_EVENTS[String(args.key).toLowerCase()]
        if (!keyCode)
          throw new Error(`Unknown key: ${args.key}`)
        await adb.input.key(deviceId, keyCode)
        await capturePostActionContext(context, deviceId)
        return JSON.stringify({ success: true, action: 'key', key: args.key })
      }

      case 'open_app': {
        await adb.deviceShell(deviceId, `monkey -p ${String(args.package).trim()} -c android.intent.category.LAUNCHER 1`)
        // Give Android a moment to actually display the app before capturing.
        await new Promise(resolve => setTimeout(resolve, 800))
        await capturePostActionContext(context, deviceId)
        return JSON.stringify({ success: true, action: 'open_app', package: args.package })
      }

      case 'shell': {
        const command = String(args.command || '').trim()
        if (isDangerousShell(command))
          throw new Error(t('copilot.tool.blocked'))
        const output = await adb.deviceShell(deviceId, command)
        // Shell commands may change device state (e.g. "input tap"), so capture
        // the screen afterwards to let the model verify the result.
        if (/\b(input|am|pm|svc|settings|cmd)\b/i.test(command))
          await capturePostActionContext(context, deviceId)
        return truncate(output, 6000)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  /**
   * After every mutating action, capture a screenshot + UI dump and store them
   * on the context. The agent loop then attaches them to the next user-facing
   * tool message so the model can reason about the result without issuing
   * another screenshot call itself.
   */
  async function capturePostActionContext(context, deviceId) {
    const adb = window.$preload.adb
    const tasks = []

    if (settings.autoScreenshotAfterAction) {
      tasks.push(
        adb.screencap(deviceId, { returnBase64: true })
          .then((base64) => { context.lastScreenshot = `data:image/png;base64,${base64}` })
          .catch(error => console.warn('[Copilot] auto screenshot failed:', error?.message ?? error)),
      )
    }

    if (settings.autoUiDumpAfterAction) {
      tasks.push(
        Promise.resolve(adb.uiDump(deviceId))
          .then((xml) => { context.lastUiLayout = truncate(xml, 12000) })
          .catch(error => console.warn('[Copilot] auto ui-dump failed:', error?.message ?? error)),
      )
    }

    if (tasks.length)
      await Promise.all(tasks)
  }

  // ── message context building ────────────────────────────────
  function buildContextMessages(session) {
    return buildApiMessages(session.messages, {
      systemPrompt: settings.systemPrompt,
      vision: Boolean(activeVendor.value?.vision),
    })
  }

  /** Rough context usage (0..1) for the compact indicator in the composer. */
  const contextUsage = computed(() => {
    const session = activeSession.value
    if (!session)
      return 0
    const budget = Number(settings.contextWindow) || 32000
    return Math.min(1, estimateTokens(session.messages || []) / budget)
  })

  /**
   * Auto-compact the session when the estimated context approaches the model
   * budget. Tries an LLM summary of the older turns first (so the agent keeps
   * its memory), falls back to aggressive truncation when the summarize call
   * fails. A systemNote message is left in the conversation so the user can
   * see that compaction happened.
   */
  async function compactIfNeeded(session) {
    if (settings.autoCompact === false)
      return false

    const budget = Number(settings.contextWindow) || 32000
    const messages = session.messages || []

    if (estimateTokens(messages) <= budget * 0.75)
      return false

    const summarize = async (toSummarize) => {
      try {
        const request = await requestChat([
          { role: 'system', content: 'You are a conversation summarizer. Produce a dense, factual summary of the conversation: what the user asked for, what actions were performed on the device (tools called and their outcomes), current screen state and any pending goals. Keep it under 400 words. Reply in the conversation language.' },
          { role: 'user', content: JSON.stringify(toSummarize.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '', name: m.name, tool_calls: m.tool_calls }))) },
        ], [], () => {})

        if (!request?.success || !request.message?.content)
          return null
        return String(request.message.content)
      }
      catch {
        return null
      }
    }

    const result = await compactSessionContext(messages, {
      budgetTokens: budget,
      summarize,
      noteText: t('copilot.compact.note'),
    })

    if (result.compacted) {
      session.messages = result.messages
      touchSession(session)
      console.log(`[Copilot] context auto-compacted (strategy: ${result.strategy})`)
    }

    return result.compacted
  }

  // ── send / agent loop ───────────────────────────────────────
  async function send(text, deviceId) {
    const session = ensureSession(deviceId)
    const content = String(text || '').trim()
    if (!content || isStreaming.value)
      return

    // Error isolation: every new turn starts from a clean slate — stale
    // error banners, reconnect progress and half-finished tool sequences
    // from a previous failed turn never leak into this one.
    lastError.value = null
    stepLimitReached.value = false
    isReconnecting.value = false
    reconnectAttempt.value = 0
    sanitizeSessionMessages(session)

    if (!isConfigured.value) {
      lastError.value = t('copilot.error.configIncomplete')
      return
    }

    session.deviceId = deviceId || session.deviceId
    session.messages.push({
      id: uid('msg'),
      role: 'user',
      content,
      createdAt: nowISO(),
    })
    touchSession(session)

    // Compact before starting the (possibly long) agent loop so the whole
    // turn fits in the context window.
    await compactIfNeeded(session)

    isStreaming.value = true
    streamingText.value = ''
    streamingSteps.value = 0

    // 0 (or negative) means unlimited — run until the model stops calling tools.
    const rawMax = Number(settings.maxSteps)
    const maxSteps = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 0
    const tools = buildToolSchemas({ allowShell: settings.allowShell })
    const context = { deviceId: session.deviceId, lastScreenshot: null, lastUiLayout: null }

    try {
      let continueLoop = true

      // the step limit is enforced at the end of each iteration below
      while (continueLoop) {
        // Honors user-initiated abort between iterations, not only mid-request.
        if (currentRequestAborted) {
          if (streamingText.value) {
            session.messages.push({
              id: uid('msg'),
              role: 'assistant',
              content: streamingText.value,
              stopped: true,
              createdAt: nowISO(),
            })
          }
          lastError.value = t('copilot.stopped')
          break
        }

        streamingSteps.value++
        streamingText.value = ''

        const contextMessages = buildContextMessages(session)

        // One chat round with auto-reconnect: transient failures (network,
        // timeout, 5xx, rate-limit) retry the same round with backoff while
        // a visible banner shows the reconnect progress. User aborts and
        // config/auth errors are never retried.
        const maxReconnect = settings.autoReconnect !== false ? (Number(settings.reconnectMaxRetries) || 5) : 0
        reconnectMax.value = maxReconnect

        let result = null
        let attempt = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // fresh buffer each attempt — a retried turn regenerates from the
          // persisted context, partial text of the failed attempt is dropped
          result = await requestChat(contextMessages, tools, (event) => {
            if (event.type === 'text-delta')
              streamingText.value += event.text
          })

          if (result.success)
            break

          const transient = isTransientError(result.error) && result.error?.code !== 'ABORTED'
          if (!transient || currentRequestAborted || attempt >= maxReconnect)
            break

          attempt++
          reconnectAttempt.value = attempt
          isReconnecting.value = true

          const backoff = Math.min(1200 * 2 ** (attempt - 1), 15000)
          await sleep(backoff)

          // the user may have hit stop while we were waiting
          if (currentRequestAborted)
            break

          streamingText.value = ''
        }

        isReconnecting.value = false
        reconnectAttempt.value = 0

        if (!result.success) {
          if (result.error?.code === 'ABORTED') {
            if (streamingText.value) {
              session.messages.push({
                id: uid('msg'),
                role: 'assistant',
                content: streamingText.value,
                stopped: true,
                createdAt: nowISO(),
              })
            }
            lastError.value = t('copilot.stopped')
          }
          else if (isTransientError(result.error) && maxReconnect > 0) {
            const guidance = result.error?.code ? t(`copilot.error.guidance.${result.error.code}`) : ''
            const base = guidance && !guidance.startsWith('copilot.') ? guidance : (result.error?.message || t('copilot.error.executionFailed'))
            lastError.value = `${base}（${t('copilot.reconnect.exhausted', { attempts: maxReconnect })}）`
          }
          else {
            const guidance = result.error?.code ? t(`copilot.error.guidance.${result.error.code}`) : ''
            lastError.value = guidance && !guidance.startsWith('copilot.') ? guidance : (result.error?.message || t('copilot.error.executionFailed'))
          }
          break
        }

        // Persist the assistant reply (with any tool calls it requested).
        // If the model returned empty text AND no tool calls, surface a visible
        // placeholder so the user sees something happened instead of a blank turn.
        const assistantText = result.message.content || ''
        const toolCalls = result.message.tool_calls || []
        if (!assistantText.trim() && !toolCalls.length) {
          session.messages.push({
            id: uid('msg'),
            role: 'assistant',
            content: t('copilot.tool.noResult'),
            usage: result.usage,
            createdAt: nowISO(),
          })
          touchSession(session)
          break
        }

        const assistantMessage = {
          id: uid('msg'),
          role: 'assistant',
          content: assistantText,
          tool_calls: toolCalls,
          usage: result.usage,
          createdAt: nowISO(),
        }
        session.messages.push(assistantMessage)
        streamingText.value = ''
        touchSession(session)

        if (!toolCalls.length)
          break

        // Execute each tool call, then feed results back to the model.
        for (const call of toolCalls) {
          // Honor abort between tool calls within a single assistant turn —
          // previously stop only took effect after the next chat request.
          if (currentRequestAborted) {
            session.messages.push({
              id: uid('msg'),
              role: 'tool',
              tool_call_id: call.id,
              name: call.function?.name || 'unknown',
              content: JSON.stringify({ error: t('copilot.stopped'), aborted: true }),
              status: 'aborted',
              createdAt: nowISO(),
            })
            continue
          }

          const toolName = call.function?.name || 'unknown'
          const args = safeParse(call.function?.arguments)

          const decision = await requestToolConfirm({ name: toolName, args })
          if (decision !== 'allow') {
            session.messages.push({
              id: uid('msg'),
              role: 'tool',
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify({ error: t('copilot.tool.denied') }),
              status: 'denied',
              createdAt: nowISO(),
            })
            continue
          }

          // Wrap in reactive() so later status/content mutations trigger UI
          // updates — mutating a plain object pushed into a reactive array
          // leaves the tool card stuck on "running" forever.
          const toolMessage = reactive({
            id: uid('msg'),
            role: 'tool',
            tool_call_id: call.id,
            name: toolName,
            args,
            content: '',
            status: 'running',
            createdAt: nowISO(),
          })
          session.messages.push(toolMessage)

          try {
            toolMessage.content = await executeTool(toolName, args, context)
            toolMessage.status = 'completed'

            // Attach the most recent auto-captured screenshot (set either by an
            // explicit screenshot tool call or by capturePostActionContext)
            // to the tool message so vision-capable models can see what
            // happened. For non-vision models we append a short UI dump
            // breadcrumb to the tool content so they can still reason about it.
            if (context.lastScreenshot && activeVendor.value?.vision)
              toolMessage.image = context.lastScreenshot

            if (context.lastUiLayout && !activeVendor.value?.vision) {
              const note = `\n[auto ui-dump]\n${context.lastUiLayout.slice(0, 4000)}`
              if (!String(toolMessage.content).includes('[auto ui-dump]'))
                toolMessage.content = `${String(toolMessage.content)}${note}`
            }
          }
          catch (error) {
            toolMessage.content = JSON.stringify({ error: error?.message ?? 'Tool execution failed' })
            toolMessage.status = 'failed'
          }

          touchSession(session)
        }

        // Loop continues so the model can react to the tool results,
        // unless the step limit was just reached.
        if (maxSteps > 0 && streamingSteps.value >= maxSteps) {
          stepLimitReached.value = true
          continueLoop = false
        }
      }
    }
    finally {
      isStreaming.value = false
      streamingText.value = ''
    }
  }

  return {
    settings,
    sessions,
    activeSessionId,
    activeSession,
    activeVendor,
    isConfigured,
    isStreaming,
    streamingText,
    streamingSteps,
    stepLimitReached,
    lastError,
    isReconnecting,
    reconnectAttempt,
    reconnectMax,
    pendingConfirm,
    contextUsage,

    createSession,
    ensureSession,
    deleteSession,
    renameSession,
    clearSessionMessages,
    clearAllSessions,
    deleteMessage,

    addVendor,
    deleteVendor,
    importVendors,
    persistSettings,

    send,
    stopStreaming,
    fetchModels,
    testConnection,
    resolveToolConfirm,
  }
}

function safeParse(value) {
  if (typeof value !== 'string')
    return value ?? {}
  try {
    return JSON.parse(value)
  }
  catch {
    return {}
  }
}
