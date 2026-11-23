/**
 * Copilot page configuration.
 *
 * Tool schemas, key events, the dangerous-shell guard and the default system
 * prompt live in @escrcpy/shared so the main-process task executor uses the
 * exact same definitions (it cannot import renderer page files).
 */
import {
  AI_DANGEROUS_SHELL_PATTERNS,
  AI_DEFAULT_SYSTEM_PROMPT,
  AI_KEY_EVENTS,
  buildAiToolSchemas,
  isDangerousShell,
} from '@escrcpy/shared'

// Re-export under the names this page (and its consumers) historically use.
export const DANGEROUS_SHELL_PATTERNS = AI_DANGEROUS_SHELL_PATTERNS
export const DEFAULT_SYSTEM_PROMPT = AI_DEFAULT_SYSTEM_PROMPT
export const KEY_EVENTS = AI_KEY_EVENTS
export { AI_KEY_EVENTS, buildAiToolSchemas, isDangerousShell }
export { buildAiToolSchemas as buildToolSchemas }

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

export const DEFAULT_SETTINGS = {
  activeVendorId: 'glm',
  // 0 means unlimited — the agent loop runs until the model stops calling tools
  maxSteps: 0,
  // Disabled by default: high-risk tool confirmation interrupts the autonomous
  // agent loop and was reported as the main friction when running long tasks.
  requireConfirm: false,
  streaming: true,
  allowShell: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  // Auto-feed device state back to the model after every mutating action
  // (tap/swipe/key/input_text/open_app/shell) so the agent can "think for itself"
  // without manually calling screenshot/get_ui_layout each turn.
  autoScreenshotAfterAction: true,
  autoUiDumpAfterAction: true,
  // Retry AI calls on transient failures so scheduled tasks run to completion.
  retryOnFailure: true,
  maxRetries: 3,
  // Auto-reconnect the interactive chat on transient errors (network drop,
  // stream timeout, 5xx, rate-limit): the turn is retried with exponential
  // backoff and a visible "reconnecting" banner instead of dying on the
  // first hiccup.
  autoReconnect: true,
  reconnectMaxRetries: 5,
  // Automatically compact the conversation when the estimated context usage
  // approaches the model budget: older turns are summarized (LLM) or trimmed,
  // so long autonomous runs keep working instead of dying on context overflow.
  autoCompact: true,
  // Estimated context window (tokens) used for the compaction threshold.
  contextWindow: 32000,
  // Auto-launch Escrcpy on OS startup so scheduled tasks fire even if the user
  // has not opened the app manually. Toggled from the Copilot config drawer.
  launchOnBoot: false,
  // When a scheduled task fires and no window is visible, restore the main
  // window so the user can see what happened.
  revealWindowOnTaskFire: true,
  // Embedded Web UI ("网页版"): chat + scheduled tasks from any browser on
  // the LAN. Without a password the server only accepts loopback connections.
  webServer: {
    enabled: false,
    port: 38080,
    password: '',
  },
}
