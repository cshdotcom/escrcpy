/**
 * AI provider adapters for the Copilot module.
 *
 * Unified message format (OpenAI-flavoured):
 *   { role: 'system', content: string }
 *   { role: 'user', content: string | Array<{ type: 'text', text } | { type: 'image_url', image_url: { url } }> }
 *   { role: 'assistant', content: string | null, tool_calls?: Array<{ id, type: 'function', function: { name, arguments: string } }> }
 *   { role: 'tool', tool_call_id: string, name?: string, content: string }
 *
 * Tools format: [{ type: 'function', function: { name, description, parameters } }]
 *
 * Adapter events (via onEvent):
 *   { type: 'text-delta', text }
 *   { type: 'tool-call', toolCall: { id, name, arguments: object } }
 *   { type: 'usage', inputTokens, outputTokens }
 *   { type: 'finish', reason: 'stop' | 'tool_calls' | 'length' }
 */

export class AIError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', status) {
    super(message)
    this.name = 'AIError'
    this.code = code
    this.status = status
  }
}

const DEFAULT_IDLE_TIMEOUT = 120_000
const DEFAULT_TOTAL_TIMEOUT = 600_000

export const API_TYPES = [
  { value: 'openai', label: 'OpenAI Compatible (Chat Completions)' },
  { value: 'anthropic', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'ollama', label: 'Ollama (Native)' },
]

/** Normalize a user supplied base URL: trim spaces, trailing slash and accidental endpoint suffixes. */
export function normalizeBaseUrl(baseUrl) {
  let value = String(baseUrl || '').trim().replace(/\/+$/, '')
  value = value.replace(/\/chat\/completions$/i, '')
  return value
}

function toErrorMessage(payload, fallback) {
  if (typeof payload?.error?.message === 'string')
    return payload.error.message
  if (typeof payload?.message === 'string')
    return payload.message
  if (typeof payload?.error === 'string')
    return payload.error
  return fallback
}

function mapHttpStatus(status, payload) {
  const message = toErrorMessage(payload, `HTTP ${status}`)
  if (status === 401 || status === 403)
    return new AIError(message, 'INVALID_API_KEY', status)
  if (status === 402)
    return new AIError(message, 'INSUFFICIENT_BALANCE', status)
  if (status === 404)
    return new AIError(message, 'INVALID_MODEL', status)
  if (status === 429)
    return new AIError(message, 'RATE_LIMITED', status)
  return new AIError(message, 'SERVER_ERROR', status)
}

/** Fetch wrapper with idle/total timeouts that maps failures to guidance codes. */
async function aiFetch(url, options = {}, signal) {
  const idleTimeout = options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT
  const totalTimeout = options.totalTimeout ?? DEFAULT_TOTAL_TIMEOUT

  const controller = new AbortController()
  const timers = { idle: null, total: null }

  const clearTimers = () => {
    clearTimeout(timers.idle)
    clearTimeout(timers.total)
  }

  timers.total = setTimeout(() => {
    controller.abort(new AIError('Request timed out', 'STREAM_TIMEOUT'))
  }, totalTimeout)

  const resetIdle = () => {
    clearTimeout(timers.idle)
    timers.idle = setTimeout(() => {
      controller.abort(new AIError('Stream idle timeout', 'STREAM_TIMEOUT'))
    }, idleTimeout)
  }
  resetIdle()

  const onExternalAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted)
      onExternalAbort()
    else
      signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    resetIdle()

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let payload = null
      try {
        payload = JSON.parse(text)
      }
      catch {}
      throw mapHttpStatus(response.status, payload)
    }

    // Wrap the body so every read resets the idle timer.
    const reader = response.body?.getReader()
    if (!reader)
      return response

    const timedReader = {
      async read() {
        const result = await reader.read()
        if (!result.done)
          resetIdle()
        return result
      },
      async cancel() {
        return reader.cancel()
      },
      releaseLock() {
        return reader.releaseLock()
      },
    }

    return new Response(
      new ReadableStream({
        async pull(streamController) {
          try {
            const { done, value } = await timedReader.read()
            if (done) {
              clearTimers()
              streamController.close()
            }
            else {
              streamController.enqueue(value)
            }
          }
          catch (error) {
            clearTimers()
            streamController.error(error)
          }
        },
        cancel() {
          clearTimers()
          return timedReader.cancel()
        },
      }),
      { status: response.status, headers: response.headers },
    )
  }
  catch (error) {
    clearTimers()
    if (signal?.aborted && !(error instanceof AIError))
      throw new AIError('Request aborted', 'ABORTED')

    if (error instanceof AIError)
      throw error
    if (error?.name === 'AbortError')
      throw new AIError('Request aborted', 'ABORTED')

    const cause = error?.cause ?? error
    const host = (() => {
      try {
        return new URL(url).host
      }
      catch {
        return 'the server'
      }
    })()
    const message = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(cause?.code)
      ? `Cannot reach ${host}: ${cause?.code ?? cause?.message}`
      : (cause?.message ?? error?.message ?? 'Network error')
    throw new AIError(message, 'NETWORK_ERROR')
  }
  finally {
    if (signal)
      signal.removeEventListener('abort', onExternalAbort)
  }
}

/** Iterate SSE `data:` payloads from a fetch Response. */
async function* iterateSSE(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')

      while (index !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')

        if (!line || line.startsWith(':'))
          continue

        if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (data && data !== '[DONE]')
            yield data
        }
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

/** Iterate newline delimited JSON from a fetch Response. */
async function* iterateNDJSON(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n')

      while (index !== -1) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')

        if (line)
          yield line
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

function textParts(content) {
  if (typeof content === 'string')
    return content
  if (Array.isArray(content))
    return content.filter(p => p?.type === 'text').map(p => p.text).join('')
  return ''
}

/** Extract base64 payloads from image_url parts. */
function imageParts(content) {
  if (!Array.isArray(content))
    return []
  return content
    .filter(p => p?.type === 'image_url' && p?.image_url?.url)
    .map((p) => {
      const url = p.image_url.url
      const match = url.match(/^data:(.+?);base64,(.*)$/s)
      if (match)
        return { mimeType: match[1], data: match[2] }
      return { mimeType: 'image/png', data: url }
    })
}

function safeParseJSON(value, fallback = {}) {
  if (typeof value !== 'string' || !value.trim())
    return typeof value === 'object' && value !== null ? value : fallback
  try {
    return JSON.parse(value)
  }
  catch {
    return fallback
  }
}

// ─────────────────────────────────────────────────────────────
// OpenAI compatible (OpenAI, GLM, DeepSeek, Kimi, Qwen, OpenRouter, SiliconFlow, Groq, Ollama /v1, LM Studio, ...)
// ─────────────────────────────────────────────────────────────
const openaiProvider = {
  id: 'openai',

  buildHeaders(config) {
    return {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    }
  },

  async chat({ config, messages, tools, signal, onEvent }) {
    const baseUrl = normalizeBaseUrl(config.baseUrl)
    const body = {
      model: config.model,
      messages: messages.map(m => m.role === 'tool'
        ? { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
        : m),
      stream: config.streaming !== false,
      ...(config.temperature != null && config.temperature !== ''
        ? { temperature: Number(config.temperature) }
        : {}),
      ...(config.maxOutputTokens ? { max_tokens: Number(config.maxOutputTokens) } : {}),
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    }

    const response = await aiFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(config),
      body: JSON.stringify(body),
    }, signal)

    if (!body.stream) {
      const payload = await response.json()
      const choice = payload.choices?.[0] ?? {}
      const text = choice.message?.content ?? ''
      if (text)
        onEvent({ type: 'text-delta', text })
      for (const call of choice.message?.tool_calls ?? []) {
        onEvent({
          type: 'tool-call',
          toolCall: { id: call.id, name: call.function?.name, arguments: safeParseJSON(call.function?.arguments) },
        })
      }
      if (payload.usage)
        onEvent({ type: 'usage', inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens })
      onEvent({ type: 'finish', reason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'length' ? 'length' : 'stop' })
      return
    }

    const toolAcc = new Map()
    let finishReason = null

    for await (const data of iterateSSE(response)) {
      let payload
      try {
        payload = JSON.parse(data)
      }
      catch {
        continue
      }

      const choice = payload.choices?.[0]
      if (!choice)
        continue

      const delta = choice.delta ?? {}
      if (delta.content)
        onEvent({ type: 'text-delta', text: delta.content })

      for (const part of delta.tool_calls ?? []) {
        const index = part.index ?? 0
        const current = toolAcc.get(index) ?? { id: '', name: '', args: '' }
        if (part.id)
          current.id = part.id
        if (part.function?.name)
          current.name += part.function.name
        if (part.function?.arguments)
          current.args += part.function.arguments
        toolAcc.set(index, current)
      }

      if (choice.finish_reason)
        finishReason = choice.finish_reason

      if (payload.usage)
        onEvent({ type: 'usage', inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens })
    }

    for (const [, call] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      onEvent({ type: 'tool-call', toolCall: { id: call.id, name: call.name, arguments: safeParseJSON(call.args) } })
    }

    onEvent({
      type: 'finish',
      reason: finishReason === 'tool_calls' ? 'tool_calls' : finishReason === 'length' ? 'length' : 'stop',
    })
  },

  async fetchModels(config, signal) {
    const baseUrl = normalizeBaseUrl(config.baseUrl)
    const response = await aiFetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: this.buildHeaders(config),
    }, signal)
    const payload = await response.json()

    const list = Array.isArray(payload?.data) ? payload.data : []
    return list.map(item => item.id).filter(Boolean)
  },
}

// ─────────────────────────────────────────────────────────────
// Anthropic Messages API
// ─────────────────────────────────────────────────────────────
function mapAnthropicErrorType(error) {
  switch (error?.type) {
    case 'authentication_error': return 'INVALID_API_KEY'
    case 'permission_error': return 'INVALID_API_KEY'
    case 'rate_limit_error': return 'RATE_LIMITED'
    case 'overloaded_error': return 'SERVER_ERROR'
    case 'api_error': return 'SERVER_ERROR'
    case 'billing': return 'INSUFFICIENT_BALANCE'
    default: return 'SERVER_ERROR'
  }
}

const anthropicProvider = {
  id: 'anthropic',

  buildHeaders(config) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey || '',
      'anthropic-version': '2023-06-01',
    }
  },

  convertMessages(messages) {
    const result = []
    for (const message of messages) {
      if (message.role === 'system')
        continue

      if (message.role === 'assistant') {
        const content = []
        const text = textParts(message.content)
        if (text)
          content.push({ type: 'text', text })
        for (const call of message.tool_calls ?? []) {
          content.push({
            type: 'tool_use',
            id: call.id,
            name: call.function?.name,
            input: safeParseJSON(call.function?.arguments),
          })
        }
        if (content.length)
          result.push({ role: 'assistant', content })
        continue
      }

      if (message.role === 'tool') {
        result.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: message.tool_call_id,
            content: String(message.content ?? ''),
          }],
        })
        continue
      }

      const images = imageParts(message.content)
      const text = textParts(message.content)
      const content = []
      for (const image of images) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mimeType, data: image.data },
        })
      }
      if (text)
        content.push({ type: 'text', text })
      if (content.length)
        result.push({ role: 'user', content })
    }

    return result
  },

  async chat({ config, messages, tools, signal, onEvent }) {
    const baseUrl = normalizeBaseUrl(config.baseUrl) || 'https://api.anthropic.com'
    const system = messages.filter(m => m.role === 'system').map(m => textParts(m.content)).filter(Boolean).join('\n\n')

    const body = {
      model: config.model,
      max_tokens: Number(config.maxOutputTokens) || 4096,
      messages: this.convertMessages(messages),
      stream: config.streaming !== false,
      ...(config.temperature != null && config.temperature !== '' ? { temperature: Number(config.temperature) } : {}),
      ...(system ? { system } : {}),
      ...(tools?.length
        ? { tools: tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
        : {}),
    }

    const response = await aiFetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.buildHeaders(config),
      body: JSON.stringify(body),
    }, signal)

    const toolAcc = new Map()
    let inputTokens = 0
    let outputTokens = 0

    const handleEvent = (payload) => {
      switch (payload.type) {
        case 'content_block_start': {
          const block = payload.content_block
          if (block?.type === 'tool_use')
            toolAcc.set(payload.index, { id: block.id, name: block.name, args: '' })
          break
        }
        case 'content_block_delta': {
          const delta = payload.delta
          if (delta?.type === 'text_delta' && delta.text)
            onEvent({ type: 'text-delta', text: delta.text })
          if (delta?.type === 'input_json_delta' && delta.partial_json) {
            const current = toolAcc.get(payload.index)
            if (current)
              current.args += delta.partial_json
          }
          break
        }
        case 'message_start': {
          inputTokens = payload.message?.usage?.input_tokens ?? 0
          break
        }
        case 'message_delta': {
          outputTokens = payload.usage?.output_tokens ?? outputTokens
          break
        }
        case 'error': {
          throw new AIError(toErrorMessage(payload, 'Anthropic stream error'), mapAnthropicErrorType(payload.error))
        }
      }
    }

    if (!body.stream) {
      const payload = await response.json()
      if (payload.type === 'error')
        throw new AIError(toErrorMessage(payload, 'Anthropic error'), mapAnthropicErrorType(payload.error))
      for (const block of payload.content ?? []) {
        if (block.type === 'text')
          onEvent({ type: 'text-delta', text: block.text })
        if (block.type === 'tool_use')
          onEvent({ type: 'tool-call', toolCall: { id: block.id, name: block.name, arguments: block.input ?? {} } })
      }
      onEvent({ type: 'usage', inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens })
      onEvent({ type: 'finish', reason: payload.stop_reason === 'tool_use' ? 'tool_calls' : payload.stop_reason === 'max_tokens' ? 'length' : 'stop' })
      return
    }

    for await (const data of iterateSSE(response)) {
      let payload
      try {
        payload = JSON.parse(data)
      }
      catch {
        continue
      }
      handleEvent(payload)
    }

    for (const [, call] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      onEvent({ type: 'tool-call', toolCall: { id: call.id, name: call.name, arguments: safeParseJSON(call.args) } })
    }
    if (inputTokens || outputTokens)
      onEvent({ type: 'usage', inputTokens, outputTokens })
    onEvent({ type: 'finish', reason: toolAcc.size ? 'tool_calls' : 'stop' })
  },

  async fetchModels(config, signal) {
    const baseUrl = normalizeBaseUrl(config.baseUrl) || 'https://api.anthropic.com'
    const response = await aiFetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: this.buildHeaders(config),
    }, signal)
    const payload = await response.json()
    return (payload?.data ?? []).map(item => item.id).filter(Boolean)
  },
}

// ─────────────────────────────────────────────────────────────
// Google Gemini generateContent API
// ─────────────────────────────────────────────────────────────
const geminiProvider = {
  id: 'gemini',

  buildHeaders(config) {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey || '',
    }
  },

  convertMessages(messages) {
    const contents = []
    let systemText = ''

    for (const message of messages) {
      if (message.role === 'system') {
        systemText += `${textParts(message.content)}\n`
        continue
      }

      if (message.role === 'assistant') {
        const parts = []
        const text = textParts(message.content)
        if (text)
          parts.push({ text })
        for (const call of message.tool_calls ?? []) {
          parts.push({
            functionCall: { name: call.function?.name, args: safeParseJSON(call.function?.arguments) },
          })
        }
        if (parts.length)
          contents.push({ role: 'model', parts })
        continue
      }

      if (message.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: message.name || 'tool',
              response: { result: safeParseJSON(message.content, message.content) },
            },
          }],
        })
        continue
      }

      const parts = []
      for (const image of imageParts(message.content))
        parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } })

      const text = textParts(message.content)
      if (text)
        parts.push({ text })
      if (parts.length)
        contents.push({ role: 'user', parts })
    }

    return { contents, systemText }
  },

  async chat({ config, messages, tools, signal, onEvent }) {
    const baseUrl = normalizeBaseUrl(config.baseUrl) || 'https://generativelanguage.googleapis.com'
    const model = config.model
    const { contents, systemText } = this.convertMessages(messages)

    const body = {
      contents,
      generationConfig: {
        ...(config.temperature != null && config.temperature !== '' ? { temperature: Number(config.temperature) } : {}),
        ...(config.maxOutputTokens ? { maxOutputTokens: Number(config.maxOutputTokens) } : {}),
      },
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      ...(tools?.length
        ? {
            tools: [{
              functionDeclarations: tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: t.function.parameters,
              })),
            }],
          }
        : {}),
    }

    const stream = config.streaming !== false
    const endpoint = stream
      ? `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`
      : `${baseUrl}/v1beta/models/${model}:generateContent`

    const response = await aiFetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(config),
      body: JSON.stringify(body),
    }, signal)

    let sawToolCall = false

    const handleChunk = (payload) => {
      if (payload?.error)
        throw new AIError(toErrorMessage(payload, 'Gemini error'), 'SERVER_ERROR')

      const candidate = payload?.candidates?.[0]
      if (!candidate)
        return

      for (const part of candidate.content?.parts ?? []) {
        if (part.text)
          onEvent({ type: 'text-delta', text: part.text })
        if (part.functionCall) {
          sawToolCall = true
          onEvent({
            type: 'tool-call',
            toolCall: { id: `call_${Math.random().toString(36).slice(2, 10)}`, name: part.functionCall.name, arguments: part.functionCall.args ?? {} },
          })
        }
      }

      if (payload.usageMetadata)
        onEvent({ type: 'usage', inputTokens: payload.usageMetadata.promptTokenCount, outputTokens: payload.usageMetadata.candidatesTokenCount })
    }

    if (!stream) {
      const payload = await response.json()
      handleChunk(payload)
      onEvent({ type: 'finish', reason: sawToolCall ? 'tool_calls' : 'stop' })
      return
    }

    for await (const data of iterateSSE(response)) {
      let payload
      try {
        payload = JSON.parse(data)
      }
      catch {
        continue
      }
      handleChunk(payload)
    }

    onEvent({ type: 'finish', reason: sawToolCall ? 'tool_calls' : 'stop' })
  },

  async fetchModels(config, signal) {
    const baseUrl = normalizeBaseUrl(config.baseUrl) || 'https://generativelanguage.googleapis.com'
    const response = await aiFetch(`${baseUrl}/v1beta/models?pageSize=200`, {
      method: 'GET',
      headers: this.buildHeaders(config),
    }, signal)
    const payload = await response.json()
    return (payload?.models ?? [])
      .filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean)
  },
}

// ─────────────────────────────────────────────────────────────
// Ollama native /api/chat
// ─────────────────────────────────────────────────────────────
const ollamaProvider = {
  id: 'ollama',

  buildHeaders() {
    return { 'Content-Type': 'application/json' }
  },

  async chat({ config, messages, tools, signal, onEvent }) {
    const baseUrl = normalizeBaseUrl(config.baseUrl) || 'http://127.0.0.1:11434'
    const body = {
      model: config.model,
      stream: config.streaming !== false,
      messages: messages.map((message) => {
        if (message.role === 'assistant') {
          return {
            role: 'assistant',
            content: textParts(message.content),
            ...(message.tool_calls?.length
              ? {
                  tool_calls: message.tool_calls.map(call => ({
                    function: { name: call.function?.name, arguments: safeParseJSON(call.function?.arguments) },
                  })),
                }
              : {}),
          }
        }
        if (message.role === 'tool')
          return { role: 'tool', content: String(message.content ?? '') }

        if (message.role === 'user') {
          const images = imageParts(message.content)
          return {
            role: 'user',
            content: textParts(message.content),
            ...(images.length ? { images: images.map(image => image.data) } : {}),
          }
        }
        return { role: message.role, content: textParts(message.content) }
      }),
      ...(tools?.length ? { tools } : {}),
      ...(((config.temperature != null && config.temperature !== '') || config.maxOutputTokens)
        ? {
            options: {
              ...(config.temperature != null && config.temperature !== '' ? { temperature: Number(config.temperature) } : {}),
              ...(config.maxOutputTokens ? { num_predict: Number(config.maxOutputTokens) } : {}),
            },
          }
        : {}),
    }

    const response = await aiFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: this.buildHeaders(config),
      body: JSON.stringify(body),
    }, signal)

    const toolCalls = []

    const handleChunk = (payload) => {
      if (payload?.error)
        throw new AIError(payload.error, 'SERVER_ERROR')

      const message = payload?.message
      if (!message)
        return

      if (message.content)
        onEvent({ type: 'text-delta', text: message.content })

      for (const call of message.tool_calls ?? []) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          name: call.function?.name,
          arguments: call.function?.arguments ?? {},
        })
      }
    }

    if (!body.stream) {
      const payload = await response.json()
      handleChunk(payload)
    }
    else {
      for await (const line of iterateNDJSON(response)) {
        let payload
        try {
          payload = JSON.parse(line)
        }
        catch {
          continue
        }
        handleChunk(payload)
      }
    }

    for (const call of toolCalls)
      onEvent({ type: 'tool-call', toolCall: call })

    onEvent({ type: 'finish', reason: toolCalls.length ? 'tool_calls' : 'stop' })
  },

  async fetchModels(config, signal) {
    const baseUrl = normalizeBaseUrl(config.baseUrl) || 'http://127.0.0.1:11434'
    const response = await aiFetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: this.buildHeaders(config),
    }, signal)
    const payload = await response.json()
    return (payload?.models ?? []).map(m => m.name).filter(Boolean)
  },
}

// ─────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────
const providers = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
}

export function getProvider(apiType) {
  return providers[apiType] ?? providers.openai
}

export function chatWithProvider(options) {
  const provider = getProvider(options.config?.apiType)
  return provider.chat(options)
}

export function fetchModelsWithProvider(config, signal) {
  const provider = getProvider(config?.apiType)
  return provider.fetchModels(config, signal)
}

/** Lightweight connectivity probe: prefer the models endpoint, fall back to a 1-token chat request. */
export async function testConnection(config, signal) {
  const startedAt = Date.now()
  const provider = getProvider(config.apiType)

  try {
    const models = await provider.fetchModels(config, signal)
    return {
      success: true,
      latency: Date.now() - startedAt,
      models,
      model: models.includes(config.model) ? config.model : models[0],
    }
  }
  catch (error) {
    // Some providers disable the models endpoint; try a minimal chat round-trip.
    try {
      await provider.chat({
        config: { ...config, streaming: false, maxOutputTokens: 1, temperature: 0 },
        messages: [
          { role: 'system', content: 'You are a connectivity probe. Reply with the single character: 0' },
          { role: 'user', content: 'ping' },
        ],
        tools: [],
        signal,
        onEvent: () => {},
      })

      return { success: true, latency: Date.now() - startedAt, models: [], model: config.model }
    }
    catch (chatError) {
      throw chatError instanceof AIError ? chatError : error
    }
  }
}
