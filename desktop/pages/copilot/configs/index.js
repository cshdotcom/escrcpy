/** Built-in AI vendor presets. Users can add custom vendors from these templates. */
export const VENDOR_PRESETS = [
  {
    id: 'glm',
    name: 'Zhipu GLM',
    apiType: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiType: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    apiType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    apiType: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: '',
  },
  {
    id: 'qwen',
    name: 'Qwen (DashScope)',
    apiType: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: '',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiType: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    apiType: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: '',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    apiType: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: '',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    apiType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: '',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    apiType: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: '',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    apiType: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: '',
  },
]

export const API_TYPE_OPTIONS = [
  { value: 'openai', label: 'copilot.apiType.openai' },
  { value: 'anthropic', label: 'copilot.apiType.anthropic' },
  { value: 'gemini', label: 'copilot.apiType.gemini' },
  { value: 'ollama', label: 'copilot.apiType.ollama' },
]

export const DEFAULT_SYSTEM_PROMPT = [
  'You are ESCRCpy Copilot, an AI assistant that helps the user control an Android device connected over ADB.',
  'You can see the device screen (via screenshots when a vision model is available), read the UI hierarchy, and perform taps, swipes, text input and key presses.',
  'Guidelines:',
  '1. Inspect before acting: when unsure about the current screen, call the screenshot or get_ui_layout tool first.',
  '2. Act step by step: perform one action at a time, then verify the result before continuing.',
  '3. Be concise: reply in the user\'s language, summarize what you did and what happened.',
  '4. Stay safe: only operate the connected device; never attempt destructive shell commands.',
].join('\n')

export const DEFAULT_SETTINGS = {
  activeVendorId: 'glm',
  maxSteps: 30,
  requireConfirm: true,
  streaming: true,
  allowShell: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
}

/** Android key codes exposed to the model. */
export const KEY_EVENTS = {
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

/** Tool schemas in OpenAI function-calling format. */
export function buildToolSchemas(options = {}) {
  const { allowShell = true } = options
  const tools = [
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
        description: 'Capture the current device screen. The image is attached to the conversation when the model supports vision; otherwise only the image size is reported.',
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

/** Dangerous shell patterns that are always rejected before execution. */
export const DANGEROUS_SHELL_PATTERNS = [
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

export function isDangerousShell(command) {
  return DANGEROUS_SHELL_PATTERNS.some(pattern => pattern.test(String(command || '').trim()))
}
