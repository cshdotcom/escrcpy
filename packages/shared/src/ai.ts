/**
 * Shared AI Copilot primitives used by BOTH the renderer (Copilot page) and
 * the main process (scheduled-task agent executor):
 *
 *  - tool schemas (OpenAI function-calling format)
 *  - dangerous-shell guard
 *  - Android key events
 *  - conversation → API message conversion (incl. vision image bridge)
 *  - token estimation and automatic context compaction
 *
 * Keep this file dependency-free (no Electron, no Vue) so it can be bundled
 * into the renderer and imported by the notBundle'd main process alike.
 */

export interface AiToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AiToolCall {
  id: string
  type?: 'function'
  function: { name: string, arguments: string }
}

/** OpenAI-flavoured unified message shape (see providers.js). */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<{ type: string, text?: string, image_url?: { url: string } }> | null
  tool_calls?: AiToolCall[]
  tool_call_id?: string
  name?: string
}

/** Session message as persisted in `copilot.sessions` (superset of AiMessage). */
export interface SessionMessage {
  id?: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: AiToolCall[]
  tool_call_id?: string
  name?: string
  args?: Record<string, unknown>
  status?: string
  images?: string[]
  image?: string
  /** informational in-chat note (e.g. compaction notice) — never sent to the API */
  systemNote?: boolean
  createdAt?: string
  usage?: { inputTokens?: number, outputTokens?: number } | null
}

/** Android key codes exposed to the model. */
export const AI_KEY_EVENTS: Record<string, number> = {
  home: 3,
  back: 4,
  menu: 82,
  power: 26,
  volume_up: 24,
  volume_down: 25,
  volume_mute: 164,
  enter: 66,
  del: 67,
  tab: 61,
  app_switch: 187,
  notification: 83,
  camera: 27,
  media_play_pause: 85,
  media_next: 87,
  media_previous: 88,
}

/** Dangerous shell patterns that are always rejected before execution. */
export const AI_DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bformat\b/i,
  /(^|\s)su(\s|$)/,
  /\brm\s+-rf?\s+\//i,
  /factory\s*reset/i,
  /\bflash_image\b/i,
  /\bwipe\s+data\b/i,
  /\bmkfs\b/i,
]

export function isDangerousShell(command: unknown): boolean {
  return AI_DANGEROUS_SHELL_PATTERNS.some(pattern =>
    pattern.test(String(command ?? '').trim()),
  )
}

export const AI_DEFAULT_SYSTEM_PROMPT = [
  'You are ESCRCpy Copilot, an AI assistant that helps the user control an Android device connected over ADB.',
  'You can see the device screen (via screenshots when a vision model is available), read the UI hierarchy, and perform taps, swipes, text input and key presses.',
  'Guidelines:',
  '1. Inspect before acting: when unsure about the current screen, call the screenshot or get_ui_layout tool first.',
  '2. Act step by step: perform one action at a time, then verify the result before continuing.',
  '3. Be concise: reply in the user\'s language, summarize what you did and what happened.',
  '4. Stay safe: only operate the connected device; never attempt destructive shell commands.',
].join('\n')

/** Tool schemas in OpenAI function-calling format. */
export function buildAiToolSchemas(options: { allowShell?: boolean } = {}): AiToolSchema[] {
  const { allowShell = true } = options
  const tools: AiToolSchema[] = [
    {
      type: 'function',
      function: {
        name: 'get_device_info',
        description: 'Get connected Android device info: model, brand, Android version, screen size, battery level and the current focused app.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'screenshot',
        description: 'Capture the current device screen. The image is attached to the conversation when the model supports vision; otherwise only the image size is reported. After every mutating action (tap, swipe, key, input_text, open_app, shell) the system also auto-attaches a fresh screenshot and UI dump, so you usually do NOT need to call this manually right after an action.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_ui_layout',
        description: 'Dump the current screen UI hierarchy as XML. Use it to locate clickable elements and their bounds when you cannot see the screen.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'tap',
        description: 'Tap the screen at the given pixel coordinates.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate in pixels' },
            y: { type: 'number', description: 'Y coordinate in pixels' },
          },
          required: ['x', 'y'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'swipe',
        description: 'Swipe from one point to another.',
        parameters: {
          type: 'object',
          properties: {
            x1: { type: 'number', description: 'Start X' },
            y1: { type: 'number', description: 'Start Y' },
            x2: { type: 'number', description: 'End X' },
            y2: { type: 'number', description: 'End Y' },
            duration: { type: 'number', description: 'Duration in milliseconds, default 300' },
          },
          required: ['x1', 'y1', 'x2', 'y2'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'input_text',
        description: 'Type text into the currently focused input field. Supports unicode (Chinese etc.). Focus a text field first with tap.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to type' },
          },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'key',
        description: 'Press a device key, e.g. home, back, menu, power, volume_up, volume_down, enter, del, app_switch, notification.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'One of: home, back, menu, power, volume_up, volume_down, volume_mute, enter, del, tab, app_switch, notification, camera, media_play_pause, media_next, media_previous' },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'open_app',
        description: 'Open an app by its package name, e.g. com.android.settings for Settings.',
        parameters: {
          type: 'object',
          properties: {
            package: { type: 'string', description: 'Android package name' },
          },
          required: ['package'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_devices',
        description: 'List all Android devices currently connected.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ]

  if (allowShell) {
    tools.push({
      type: 'function',
      function: {
        name: 'shell',
        description: 'Run an adb shell command on the device and return its output. Read-only commands such as getprop, dumpsys, pm list, settings get, ls, cat are preferred. Dangerous commands (reboot, shutdown, format, su, rm -rf, factory reset) are blocked.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
          },
          required: ['command'],
        },
      },
    })
  }

  return tools
}

// ── token estimation & context compaction ────────────────────

/** Rough token estimate: CJK chars ≈ 1 token each, everything else ≈ 1/4 token. */
export function estimateTokens(input: string | AiMessage[] | SessionMessage[]): number {
  if (typeof input === 'string')
    return estimateTextTokens(input)

  let total = 0
  for (const message of input as Array<Record<string, unknown>>) {
    total += 4 // role + framing overhead

    const content = message.content
    if (typeof content === 'string')
      total += estimateTextTokens(content)
    else if (Array.isArray(content))
      total += estimateTextTokens(JSON.stringify(content))

    if (message.tool_calls)
      total += estimateTextTokens(JSON.stringify(message.tool_calls))

    for (const image of [...(message.images as string[] | undefined || []), message.image as string | undefined].filter(Boolean) as string[]) {
      // vision encoders resample screenshots to a fixed budget; a 1px ≈ 0.33 token
      // heuristic on base64 length would wildly overestimate, use a fixed cost.
      total += 1100
    }
  }
  return total
}

function estimateTextTokens(text: string): number {
  const value = String(text ?? '')
  let cjk = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xFF00 && c <= 0xFFEF))
      cjk++
  }
  return Math.ceil(cjk + (value.length - cjk) / 4)
}

export interface CompactContextOptions {
  /** estimated model context window in tokens */
  budgetTokens: number
  /** compact when usage exceeds budget × threshold (default 0.75) */
  threshold?: number
  /** optional LLM summarizer; receives the messages to summarize, returns a summary string (or null on failure) */
  summarize?: (messages: SessionMessage[]) => Promise<string | null>
  /** max messages kept verbatim after compaction (default 12, always keeps the tail) */
  keepTail?: number
  /** locale for the in-conversation note (unused, note text supplied by caller) */
  noteText?: string
}

export interface CompactContextResult {
  messages: SessionMessage[]
  compacted: boolean
  strategy: 'none' | 'summarize' | 'truncate'
  note?: string
}

/**
 * Automatically compact a session when the estimated context approaches the
 * model budget. Strategy:
 *
 *  1. under threshold → no-op
 *  2. over threshold & summarizer provided → replace all but the tail with an
 *     LLM summary (falls through to 3 when the summarize call fails)
 *  3. truncate: drop oldest images and tool payloads first, then drop oldest
 *     messages entirely, until the estimate fits under 60% of the budget
 *
 * A `systemNote` message is prepended so the user sees what happened in the
 * chat history; systemNote messages are excluded from API payloads.
 */
export async function compactSessionContext(
  messages: SessionMessage[],
  options: CompactContextOptions,
): Promise<CompactContextResult> {
  const { budgetTokens, threshold = 0.75, keepTail = 12 } = options
  const list = Array.isArray(messages) ? messages.filter(m => !m?.systemNote) : []

  if (estimateTokens(list) <= budgetTokens * threshold)
    return { messages, compacted: false, strategy: 'none' }

  const tail = list.slice(-keepTail)
  const head = list.slice(0, -keepTail)

  // ── strategy 2: LLM summary of the head ───────────────────
  if (options.summarize && head.length) {
    try {
      const summary = await options.summarize(head)
      if (summary && summary.trim()) {
        const note: SessionMessage = {
          role: 'assistant',
          content: options.noteText || '[context compacted]',
          systemNote: true,
          summary: summary.trim(),
        }
        return {
          messages: [note, ...tail],
          compacted: true,
          strategy: 'summarize',
          note: summary.trim(),
        }
      }
    }
    catch {
      // fall through to truncation
    }
  }

  // ── strategy 3: aggressive truncation ─────────────────────
  const kept: SessionMessage[] = []
  let budget = Math.floor(budgetTokens * 0.6)

  // Walk from the newest message backwards, keeping as much as fits.
  for (let i = list.length - 1; i >= 0; i--) {
    const message = list[i]
    const slimmed: SessionMessage = {
      ...message,
      // drop vision payloads first — they dominate the estimate
      images: undefined,
      image: undefined,
    }
    if (estimateTokens([...kept, slimmed]) <= budget || kept.length === 0) {
      kept.unshift(slimmed)
      continue
    }
    break
  }

  // If still over budget, replace old tool contents with placeholders.
  while (estimateTokens(kept) > budget && kept.some(m => m.role === 'tool' && String(m.content || '').length > 200)) {
    const index = kept.findIndex(m => m.role === 'tool' && String(m.content || '').length > 200)
    kept[index] = { ...kept[index], content: '[tool output omitted to save context]' }
  }

  // Last resort: drop oldest kept messages.
  while (estimateTokens(kept) > budget && kept.length > 1)
    kept.shift()

  const note: SessionMessage = {
    role: 'assistant',
    content: options.noteText || '[context compacted]',
    systemNote: true,
  }

  return { messages: [note, ...kept], compacted: true, strategy: 'truncate', note }
}

// ── session → API message conversion ─────────────────────────

export interface BuildApiMessagesOptions {
  systemPrompt?: string
  /** attach images (user attachments + tool screenshots) for vision models */
  vision?: boolean
  /** hard cap on messages sent to the API (default 60) */
  maxMessages?: number
}

/**
 * Convert persisted session messages into the unified API payload.
 *
 * Vision bridge: screenshots captured by tool calls are stored on the tool
 * message (`image`). OpenAI-compatible tool messages cannot carry images, so
 * for vision vendors the most recent screenshot is re-attached as a follow-up
 * user message right after the tool batch — every provider accepts images in
 * user messages.
 */
export function buildApiMessages(
  sessionMessages: SessionMessage[],
  options: BuildApiMessagesOptions = {},
): AiMessage[] {
  const { systemPrompt, vision, maxMessages = 60 } = options
  const source = (sessionMessages || []).slice(-maxMessages)
  const messages: AiMessage[] = []

  if (systemPrompt?.trim())
    messages.push({ role: 'system', content: systemPrompt.trim() })

  let pendingImage: string | null = null

  for (let index = 0; index < source.length; index++) {
    const message = source[index]

    // Compaction notes are informational in the chat UI; when they carry an
    // LLM summary, inject it as a system message so the model keeps the
    // memory of the compacted history.
    if (message.systemNote) {
      const summary = (message as SessionMessage & { summary?: string }).summary
      if (summary && summary.trim())
        messages.push({ role: 'system', content: `Conversation history summary (automatically compacted):\n${summary.trim()}` })
      continue
    }
    if (message.role === 'user') {
      const parts: Array<{ type: string, text?: string, image_url?: { url: string } }> = []
      const text = typeof message.content === 'string' ? message.content : ''
      if (text)
        parts.push({ type: 'text', text })

      if (vision) {
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

      if (vision && message.image)
        pendingImage = message.image

      // Flush the vision bridge as a user message AFTER the complete tool
      // batch of the current assistant turn — never between an assistant
      // tool_calls message and its tool results (that would break the API
      // call/response pairing contract).
      const next = source[index + 1]
      if (pendingImage && (!next || next.role !== 'tool')) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: '[device screen after the preceding tool calls]' },
            { type: 'image_url', image_url: { url: pendingImage } },
          ],
        })
        pendingImage = null
      }
    }
  }

  // A trailing pending image (session ended right after a tool call) is
  // attached to nothing — the next user turn will carry fresh state anyway.
  return messages
}
