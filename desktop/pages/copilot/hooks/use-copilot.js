import { buildToolSchemas, DEFAULT_SETTINGS, isDangerousShell, KEY_EVENTS, VENDOR_PRESETS } from '../configs/index.js'

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

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    vendors,
  }
}

/**
 * The Copilot agent: session management, streaming chat orchestration
 * and tool execution against the selected Android device.
 */
export function useCopilot() {
  const settings = reactive(loadSettings())
  const sessions = ref(window.$preload.store.get('copilot.sessions') || [])
  const activeSessionId = ref(sessions.value[0]?.id || '')

  const isStreaming = ref(false)
  const streamingText = ref('')
  const streamingSteps = ref(0)
  const stepLimitReached = ref(false)
  const lastError = ref(null)

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
  watch(() => sessions.value, (value) => {
    window.$preload.store.set('copilot.sessions', JSON.parse(JSON.stringify(value)))
  }, { deep: true })

  function persistSettings() {
    window.$preload.store.set('copilot.settings', JSON.parse(JSON.stringify({
      ...toRaw(settings),
      vendors: toRaw(settings.vendors),
    })))
  }

  // ── sessions ────────────────────────────────────────────────
  function createSession(deviceId) {
    const session = {
      id: uid('session'),
      name: '',
      deviceId: deviceId || '',
      createdAt: nowISO(),
      updatedAt: nowISO(),
      messages: [],
    }
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    return session
  }

  function ensureSession(deviceId) {
    return activeSession.value || createSession(deviceId)
  }

  function deleteSession(id) {
    const index = sessions.value.findIndex(session => session.id === id)
    if (index === -1)
      return

    sessions.value.splice(index, 1)
    if (activeSessionId.value === id)
      activeSessionId.value = sessions.value[0]?.id || ''
  }

  function renameSession(id, name) {
    const session = sessions.value.find(item => item.id === id)
    if (session)
      session.name = name
  }

  function clearSessionMessages(id) {
    const session = sessions.value.find(item => item.id === id)
    if (session)
      session.messages = []
  }

  function clearAllSessions() {
    sessions.value.forEach((session) => {
      session.messages = []
    })
  }

  function deleteMessage(sessionId, messageId) {
    const session = sessions.value.find(item => item.id === sessionId)
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
        return truncate(xml, 12000)
      }

      case 'tap': {
        await adb.input.tap(deviceId, Math.round(args.x), Math.round(args.y))
        return JSON.stringify({ success: true, action: 'tap', x: args.x, y: args.y })
      }

      case 'swipe': {
        await adb.input.swipe(deviceId, Math.round(args.x1), Math.round(args.y1), Math.round(args.x2), Math.round(args.y2), args.duration || 300)
        return JSON.stringify({ success: true, action: 'swipe', from: [args.x1, args.y1], to: [args.x2, args.y2] })
      }

      case 'input_text': {
        await adb.input.text(deviceId, String(args.text ?? ''))
        return JSON.stringify({ success: true, action: 'input_text', text: args.text })
      }

      case 'key': {
        const keyCode = KEY_EVENTS[String(args.key).toLowerCase()]
        if (!keyCode)
          throw new Error(`Unknown key: ${args.key}`)
        await adb.input.key(deviceId, keyCode)
        return JSON.stringify({ success: true, action: 'key', key: args.key })
      }

      case 'open_app': {
        await adb.deviceShell(deviceId, `monkey -p ${String(args.package).trim()} -c android.intent.category.LAUNCHER 1`)
        return JSON.stringify({ success: true, action: 'open_app', package: args.package })
      }

      case 'shell': {
        const command = String(args.command || '').trim()
        if (isDangerousShell(command))
          throw new Error(t('copilot.tool.blocked'))
        const output = await adb.deviceShell(deviceId, command)
        return truncate(output, 6000)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  // ── message context building ────────────────────────────────
  function buildContextMessages(session) {
    const messages = []

    if (settings.systemPrompt?.trim())
      messages.push({ role: 'system', content: settings.systemPrompt.trim() })

    const history = session.messages.slice(-40)
    for (const message of history) {
      if (message.role === 'user') {
        const parts = []
        const text = typeof message.content === 'string' ? message.content : ''
        if (text)
          parts.push({ type: 'text', text })

        // Attach the most recent screenshot before this message for vision models.
        if (activeVendor.value?.vision) {
          for (const image of message.images || [])
            parts.push({ type: 'image_url', image_url: { url: image } })
        }

        messages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? text : parts })
        continue
      }

      if (message.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: message.content || null,
          ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
        })
        continue
      }

      if (message.role === 'tool') {
        messages.push({
          role: 'tool',
          tool_call_id: message.tool_call_id,
          name: message.name,
          content: String(message.content ?? ''),
        })
      }
    }

    return messages
  }

  // ── send / agent loop ───────────────────────────────────────
  async function send(text, deviceId) {
    const session = ensureSession(deviceId)
    const content = String(text || '').trim()
    if (!content || isStreaming.value)
      return

    lastError.value = null
    stepLimitReached.value = false

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

    isStreaming.value = true
    streamingText.value = ''
    streamingSteps.value = 0

    const maxSteps = Math.min(Math.max(Number(settings.maxSteps) || 30, 1), 100)
    const tools = buildToolSchemas({ allowShell: settings.allowShell })
    const context = { deviceId: session.deviceId, lastScreenshot: null }

    try {
      let continueLoop = true

      while (continueLoop && streamingSteps.value < maxSteps) {
        streamingSteps.value++
        streamingText.value = ''

        const contextMessages = buildContextMessages(session)
        const result = await requestChat(contextMessages, tools, (event) => {
          if (event.type === 'text-delta')
            streamingText.value += event.text
        })

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
          else {
            const guidance = result.error?.code ? t(`copilot.error.guidance.${result.error.code}`) : ''
            lastError.value = guidance && !guidance.startsWith('copilot.') ? guidance : (result.error?.message || t('copilot.error.executionFailed'))
          }
          break
        }

        // Persist the assistant reply (with any tool calls it requested)
        const assistantMessage = {
          id: uid('msg'),
          role: 'assistant',
          content: result.message.content || '',
          tool_calls: result.message.tool_calls || [],
          usage: result.usage,
          createdAt: nowISO(),
        }
        session.messages.push(assistantMessage)
        streamingText.value = ''
        touchSession(session)

        const toolCalls = result.message.tool_calls || []
        if (!toolCalls.length)
          break

        // Execute each tool call, then feed results back to the model
        for (const call of toolCalls) {
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

          const toolMessage = {
            id: uid('msg'),
            role: 'tool',
            tool_call_id: call.id,
            name: toolName,
            args,
            content: '',
            status: 'running',
            createdAt: nowISO(),
          }
          session.messages.push(toolMessage)

          try {
            toolMessage.content = await executeTool(toolName, args, context)
            toolMessage.status = 'completed'

            // Attach the captured screenshot to the conversation for vision models.
            if (toolName === 'screenshot' && context.lastScreenshot && activeVendor.value?.vision) {
              let target = null
              for (let i = session.messages.length - 1; i >= 0; i--) {
                if (session.messages[i].role === 'user') {
                  target = session.messages[i]
                  break
                }
              }
              if (target)
                target.images = [...(target.images || []).slice(-1), context.lastScreenshot]
              else
                toolMessage.image = context.lastScreenshot
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
        if (streamingSteps.value >= maxSteps) {
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
    pendingConfirm,

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
