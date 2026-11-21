#!/usr/bin/env node
/**
 * E2E mock LLM server — an OpenAI-compatible API used to drive the app's
 * Copilot / AI-task pipelines end-to-end without a real provider key.
 *
 * API surface (what the app actually calls):
 *   GET  /v1/models                    → { data: [{ id }, ...] }
 *   POST /v1/chat/completions          → streaming SSE or plain JSON
 *     - honours body.stream
 *     - tool_calls responses supported (OpenAI format)
 *
 * Control API (127.0.0.1:5040) for the test runner:
 *   POST /script  { steps: [ { text }, { tool: {name, arguments} }, { error: {status, type, message} } ] }
 *        queue scripted responses consumed in order; when the queue is empty
 *        the server falls back to echo mode:
 *          - last message is a tool result  → replies "TOOL_DONE:<name>"
 *          - otherwise                       → replies "ECHO:<user text>"
 *   GET  /requests                      → every chat request received
 *        (messages incl. image_url parts, tools, model, stream) so tests can
 *        assert vision round-trips and conversation continuity
 *   GET  /stats                         → counters (requests, toolCalls, sawImage)
 *   POST /reset                         → clear script + requests + stats
 */
import http from 'node:http'

const API_PORT = Number(process.env.MOCK_LLM_PORT || 5039)
const CTRL_PORT = Number(process.env.MOCK_LLM_CTRL_PORT || 5040)

const MODELS = ['mock-gpt-4o', 'mock-gpt-4o-mini', 'mock-glm-4.7']
const script = []
const requests = []
const stats = { requests: 0, toolCalls: 0, sawImage: false, imageCount: 0, modelRequests: 0 }

let callSeq = 0

function sse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function buildChoice(step) {
  // returns { message, finish_reason }
  if (step.tool) {
    callSeq++
    const name = step.tool.name
    const args = step.tool.arguments ?? {}
    return {
      message: {
        role: 'assistant',
        content: step.text ?? null,
        tool_calls: [{
          id: `call_${callSeq}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: 'tool_calls',
    }
  }
  return {
    message: { role: 'assistant', content: step.text ?? '' },
    finish_reason: 'stop',
  }
}

function nextStep(body) {
  if (script.length)
    return script.shift()

  // echo fallback so ad-hoc conversations still work
  const messages = body.messages ?? []
  const last = messages[messages.length - 1]
  if (last?.role === 'tool')
    return { text: `TOOL_DONE:${last.name || last.tool_call_id || 'tool'}` }

  let userText = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user')
      continue
    if (typeof m.content === 'string') {
      userText = m.content
      break
    }
    if (Array.isArray(m.content)) {
      userText = (m.content.find(p => p.type === 'text') || {}).text || ''
      break
    }
  }
  return { text: `ECHO:${userText.slice(0, 200)}` }
}

function recordRequest(body) {
  stats.requests++
  const messages = body.messages ?? []
  for (const m of messages) {
    if (!Array.isArray(m.content))
      continue
    for (const part of m.content) {
      if (part?.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
        stats.sawImage = true
        stats.imageCount++
      }
    }
  }
  if (body.tools?.length && JSON.stringify(body.messages).includes('tool_calls'))
    stats.toolCalls++
  requests.push({
    t: Date.now(),
    model: body.model,
    stream: body.stream,
    tools: body.tools?.map(t => t.function?.name) ?? [],
    messages: body.messages,
  })
}

const api = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`)

  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    stats.modelRequests++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: MODELS.map(id => ({ id, object: 'model', owned_by: 'e2e' })) }))
    return
  }

  if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }
      catch {
        res.writeHead(400).end('bad json')
        return
      }

      recordRequest(body)
      const step = nextStep(body)
      const choice = buildChoice(step)
      const id = `chatcmpl-e2e-${stats.requests}`
      const usage = { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 }

      if (step.error) {
        res.writeHead(step.error.status || 500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: step.error.message || 'mock failure', type: step.error.type || 'server_error' } }))
        return
      }

      const wantsStream = body.stream === true

      if (!wantsStream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, ...choice }],
          usage,
        }))
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })

      const deltaBase = { role: 'assistant' }
      if (choice.message.tool_calls) {
        // single frame carrying the complete tool call — the client's
        // incremental assembler concatenates, so one frame is a valid delta
        sse(res, {
          id,
          object: 'chat.completion.chunk',
          model: body.model,
          choices: [{
            index: 0,
            delta: {
              ...deltaBase,
              content: choice.message.content,
              tool_calls: choice.message.tool_calls.map(tc => ({
                index: 0,
                id: tc.id,
                type: 'function',
                function: { name: tc.function.name, arguments: tc.function.arguments },
              })),
            },
          }],
        })
      }
      else {
        const text = choice.message.content ?? ''
        const mid = Math.ceil(text.length / 2)
        for (const part of [text.slice(0, mid), text.slice(mid)]) {
          if (!part)
            continue
          sse(res, {
            id,
            object: 'chat.completion.chunk',
            model: body.model,
            choices: [{ index: 0, delta: { ...deltaBase, content: part } }],
          })
        }
      }

      sse(res, {
        id,
        object: 'chat.completion.chunk',
        model: body.model,
        choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }],
        usage,
      })
      res.write('data: [DONE]\n\n')
      res.end()
    })
    return
  }

  res.writeHead(404).end('not found')
})

const control = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${CTRL_PORT}`)
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : {}
    let result = { ok: true }

    if (req.method === 'POST' && url.pathname === '/script') {
      script.push(...(body.steps || []))
    }
    else if (req.method === 'GET' && url.pathname === '/requests') {
      result = { requests }
    }
    else if (req.method === 'GET' && url.pathname === '/stats') {
      result = { stats, scriptPending: script.length }
    }
    else if (req.method === 'POST' && url.pathname === '/reset') {
      script.length = 0
      requests.length = 0
      Object.assign(stats, { requests: 0, toolCalls: 0, sawImage: false, imageCount: 0, modelRequests: 0 })
    }
    else {
      res.writeHead(404).end('not found')
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result))
  })
})

api.listen(API_PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] OpenAI-compatible API on 127.0.0.1:${API_PORT} (models: ${MODELS.join(', ')})`)
})

control.listen(CTRL_PORT, '127.0.0.1', () => {
  console.log(`[mock-llm] control API on 127.0.0.1:${CTRL_PORT}`)
})

;['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
  api.close()
  control.close()
  process.exit(0)
}))
