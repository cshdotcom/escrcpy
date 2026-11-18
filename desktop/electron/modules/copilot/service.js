import { ipcxMain } from '@escrcpy/electron-ipcx/main'
import { AIError, chatWithProvider, fetchModelsWithProvider, testConnection } from './helpers/providers.js'

/** Running chat requests keyed by requestId, used by copilot:abort. */
const runningChats = new Map()

function toErrorPayload(error) {
  return {
    code: error instanceof AIError ? error.code : 'UNKNOWN_ERROR',
    message: error?.message ?? 'Unknown error',
  }
}

export default {
  name: 'module:copilot:service',
  apply() {
    ipcxMain.handle('copilot:chat', async (_event, payload) => {
      const { requestId, config, messages, tools, onData } = payload || {}

      if (!config?.baseUrl || !config?.model) {
        return { success: false, error: { code: 'CONFIG_INCOMPLETE', message: 'Base URL and model are required' } }
      }

      const controller = new AbortController()
      if (requestId)
        runningChats.set(requestId, controller)

      // The final assistant message, assembled from provider events.
      let text = ''
      const toolCalls = []
      let usage = null
      let finishReason = null

      try {
        await chatWithProvider({
          config,
          messages,
          tools,
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case 'text-delta': {
                text += event.text
                onData?.({ type: 'text-delta', text: event.text })
                break
              }
              case 'tool-call': {
                toolCalls.push({
                  id: event.toolCall.id,
                  type: 'function',
                  function: {
                    name: event.toolCall.name,
                    arguments: JSON.stringify(event.toolCall.arguments ?? {}),
                  },
                })
                onData?.({ type: 'tool-call', toolCall: event.toolCall })
                break
              }
              case 'usage': {
                usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
                break
              }
              case 'finish': {
                finishReason = event.reason
                break
              }
            }
          },
        })

        const message = toolCalls.length
          ? { role: 'assistant', content: text || null, tool_calls: toolCalls }
          : { role: 'assistant', content: text }

        return { success: true, message, usage, finishReason }
      }
      catch (error) {
        console.warn('[Copilot] chat failed:', error?.message)
        return { success: false, error: toErrorPayload(error), partial: text || null }
      }
      finally {
        if (requestId)
          runningChats.delete(requestId)
      }
    })

    ipcxMain.handle('copilot:abort', async (_event, payload) => {
      const controller = runningChats.get(payload?.requestId)
      if (controller) {
        controller.abort(new Error('Aborted by user'))
        return { success: true }
      }
      return { success: false, error: { code: 'NOT_FOUND', message: 'No running request for this id' } }
    })

    ipcxMain.handle('copilot:fetch-models', async (_event, payload) => {
      const { config } = payload || {}
      if (!config?.baseUrl)
        return { success: false, error: { code: 'CONFIG_INCOMPLETE', message: 'Base URL is required' } }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('timeout')), 30_000)

      try {
        const models = await fetchModelsWithProvider(config, controller.signal)
        return { success: true, models }
      }
      catch (error) {
        console.warn('[Copilot] fetch models failed:', error?.message)
        return { success: false, error: toErrorPayload(error) }
      }
      finally {
        clearTimeout(timeout)
      }
    })

    ipcxMain.handle('copilot:test-connection', async (_event, payload) => {
      const { config } = payload || {}
      if (!config?.baseUrl)
        return { success: false, error: { code: 'CONFIG_INCOMPLETE', message: 'Base URL is required' } }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('timeout')), 45_000)

      try {
        const result = await testConnection(config, controller.signal)
        return { success: true, ...result }
      }
      catch (error) {
        console.warn('[Copilot] connection test failed:', error?.message)
        return { success: false, error: toErrorPayload(error) }
      }
      finally {
        clearTimeout(timeout)
      }
    })

    return () => {
      for (const [, controller] of runningChats)
        controller.abort(new Error('Module disposed'))
      runningChats.clear()

      ipcxMain.removeHandler('copilot:chat')
      ipcxMain.removeHandler('copilot:abort')
      ipcxMain.removeHandler('copilot:fetch-models')
      ipcxMain.removeHandler('copilot:test-connection')
    }
  },
}
