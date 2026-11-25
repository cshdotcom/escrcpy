/**
 * Step-type metadata for the automation workbench.
 * Field names match the tasks runAction engine payloads exactly, so the
 * step form produces directly executable action configs.
 */
/** Renderer-side id generator (fresh ids are re-normalized on save anyway). */
export function uid(prefix = 'step') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export const STEP_GROUPS = [
  {
    key: 'basic',
    labelKey: 'automation.step.group.basic',
    types: ['tap', 'swipe', 'input_text', 'key', 'wait', 'open_app', 'screenshot', 'shell'],
  },
  {
    key: 'conditional',
    labelKey: 'automation.step.group.conditional',
    types: ['match_image', 'wait_image'],
  },
  {
    key: 'extended',
    labelKey: 'automation.step.group.extended',
    types: ['http', 'notify'],
  },
]

/** Android key codes offered as one-click presets in the key step form. */
export const KEY_PRESETS = [
  { name: 'back', keyCode: 4 },
  { name: 'home', keyCode: 3 },
  { name: 'menu', keyCode: 82 },
  { name: 'enter', keyCode: 66 },
  { name: 'del', keyCode: 67 },
  { name: 'power', keyCode: 26 },
  { name: 'app_switch', keyCode: 187 },
  { name: 'notification', keyCode: 83 },
  { name: 'volume_up', keyCode: 24 },
  { name: 'volume_down', keyCode: 25 },
]

const stepBase = (type, extra = {}) => ({
  id: uid('step'),
  name: '',
  type,
  delayBefore: 0,
  loopCount: 1,
  randomRange: 0,
  ...extra,
})

/** Default step payloads for "添加步骤" / duplicate / template creation. */
export const STEP_META = {
  tap: {
    labelKey: 'automation.step.type.tap',
    icon: 'i-solar-cursor-linear',
    defaults: () => stepBase('tap', { x: 540, y: 1200 }),
    fields: ['x', 'y'],
  },
  swipe: {
    labelKey: 'automation.step.type.swipe',
    icon: 'i-solar-arrow-right-up-linear',
    defaults: () => stepBase('swipe', { x1: 540, y1: 1500, x2: 540, y2: 500, duration: 300 }),
    fields: ['x1', 'y1', 'x2', 'y2', 'duration'],
  },
  input_text: {
    labelKey: 'automation.step.type.input_text',
    icon: 'i-solar-keyboard-linear',
    defaults: () => stepBase('input_text', { text: '' }),
    fields: ['text'],
  },
  key: {
    labelKey: 'automation.step.type.key',
    icon: 'i-solar-key-square-linear',
    defaults: () => stepBase('key', { keyCode: 4 }),
    fields: ['keyCode'],
  },
  wait: {
    labelKey: 'automation.step.type.wait',
    icon: 'i-solar-hourglass-linear',
    defaults: () => stepBase('wait', { waitMs: 1000 }),
    fields: ['waitMs'],
  },
  open_app: {
    labelKey: 'automation.step.type.open_app',
    icon: 'i-solar-rocket-linear',
    defaults: () => stepBase('open_app', { package: '' }),
    fields: ['package'],
  },
  screenshot: {
    labelKey: 'automation.step.type.screenshot',
    icon: 'i-solar-camera-minimalistic-linear',
    defaults: () => stepBase('screenshot', { saveDir: '' }),
    fields: ['saveDir'],
  },
  shell: {
    labelKey: 'automation.step.type.shell',
    icon: 'i-solar-code-linear',
    defaults: () => stepBase('shell', { command: '' }),
    fields: ['command'],
  },
  match_image: {
    labelKey: 'automation.step.type.match_image',
    icon: 'i-solar-gallery-wide-linear',
    defaults: () => stepBase('match_image', { templatePath: '', threshold: 0.8, required: true }),
    fields: ['templatePath', 'threshold', 'required'],
  },
  wait_image: {
    labelKey: 'automation.step.type.wait_image',
    icon: 'i-solar-gallery-minimalistic-linear',
    defaults: () => stepBase('wait_image', { templatePath: '', threshold: 0.8, timeoutMs: 60000, intervalMs: 2000 }),
    fields: ['templatePath', 'threshold', 'timeoutMs', 'intervalMs'],
  },
  http: {
    labelKey: 'automation.step.type.http',
    icon: 'i-solar-global-linear',
    defaults: () => stepBase('http', { url: '', method: 'GET', headers: '', body: '' }),
    fields: ['url', 'method', 'headers', 'body'],
  },
  notify: {
    labelKey: 'automation.step.type.notify',
    icon: 'i-solar-bell-linear',
    defaults: () => stepBase('notify', { title: '', content: '' }),
    fields: ['title', 'content'],
  },
}

/** Official built-in script templates (P1-C ships richer ones). */
export const SCRIPT_TEMPLATES = []

export function stepLabelKey(type) {
  return STEP_META[type]?.labelKey || 'automation.step.type'
}

export function stepIcon(type) {
  return STEP_META[type]?.icon || 'i-solar-document-linear'
}

export function defaultStep(type) {
  return (STEP_META[type] || STEP_META.tap).defaults()
}
