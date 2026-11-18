/** Task types, automation actions, cron presets and shared option models. */

export const TASK_TYPES = [
  { value: 'AI', label: 'tasks.type.AI', icon: 'i-solar-magic-stick-3-bold-duotone' },
  { value: 'AUTOMATION', label: 'tasks.type.AUTOMATION', icon: 'i-solar-bolt-circle-bold-duotone' },
  { value: 'WORKFLOW', label: 'tasks.type.WORKFLOW', icon: 'i-solar-route-bold-duotone' },
]

export const TASK_TYPE_TAG = {
  AI: { type: 'primary', label: 'tasks.type.AI' },
  AUTOMATION: { type: 'warning', label: 'tasks.type.AUTOMATION' },
  WORKFLOW: { type: 'success', label: 'tasks.type.WORKFLOW' },
}

export const AUTOMATION_ACTIONS = [
  { value: 'shell', label: 'tasks.action.shell', needsDevice: true },
  { value: 'tap', label: 'tasks.action.tap', needsDevice: true },
  { value: 'swipe', label: 'tasks.action.swipe', needsDevice: true },
  { value: 'key', label: 'tasks.action.key', needsDevice: true },
  { value: 'input_text', label: 'tasks.action.input_text', needsDevice: true },
  { value: 'open_app', label: 'tasks.action.open_app', needsDevice: true },
  { value: 'screenshot', label: 'tasks.action.screenshot', needsDevice: true },
  { value: 'http', label: 'tasks.action.http', needsDevice: false },
  { value: 'notify', label: 'tasks.action.notify', needsDevice: false },
]

export const DEVICE_ACTIONS = AUTOMATION_ACTIONS.filter(action => action.needsDevice).map(action => action.value)

export const KEY_OPTIONS = [
  { value: 3, label: 'automation.keys.home' },
  { value: 4, label: 'automation.keys.back' },
  { value: 82, label: 'automation.keys.menu' },
  { value: 26, label: 'automation.keys.power' },
  { value: 187, label: 'automation.keys.recentApps' },
  { value: 24, label: 'automation.keys.volumeUp' },
  { value: 25, label: 'automation.keys.volumeDown' },
  { value: 67, label: 'automation.keys.delete' },
  { value: 66, label: 'automation.keys.enter' },
]

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE']

export const CRON_PRESETS = [
  { value: '* * * * *', label: 'tasks.cron.presets.everyMinute' },
  { value: '*/5 * * * *', label: 'tasks.cron.presets.every5Minutes' },
  { value: '*/30 * * * *', label: 'tasks.cron.presets.every30Minutes' },
  { value: '0 * * * *', label: 'tasks.cron.presets.hourly' },
  { value: '0 8 * * *', label: 'tasks.cron.presets.daily8' },
  { value: '30 9 * * 1-5', label: 'tasks.cron.presets.weekday930' },
  { value: '0 9 * * 1', label: 'tasks.cron.presets.monday9' },
  { value: '0 0 1 * *', label: 'tasks.cron.presets.monthly1' },
  { value: 'custom', label: 'tasks.cron.presets.custom' },
]

export const WORKFLOW_STEP_TYPES = [
  { value: 'ai', label: 'tasks.workflow.step.ai', icon: 'i-solar-magic-stick-3-linear' },
  { value: 'action', label: 'tasks.workflow.step.action', icon: 'i-solar-bolt-circle-linear' },
  { value: 'delay', label: 'tasks.workflow.step.delay', icon: 'i-solar-hourglass-linear' },
]

export const WORKFLOW_STEP_ICON = {
  ai: 'i-solar-magic-stick-3-bold-duotone',
  action: 'i-solar-bolt-circle-bold-duotone',
  delay: 'i-solar-hourglass-bold-duotone',
}

export const VARIABLE_HINTS = [
  '{input}', '{prev}', '{date}', '{time}', '{timestamp}', '{deviceId}',
]

/** Default config object per task type. */
export function createDefaultConfig(type = 'AI') {
  if (type === 'AI') {
    return {
      vendorId: '',
      systemPrompt: '',
      prompt: '',
      deviceId: '',
      includeDeviceInfo: false,
      includeScreenshot: false,
      vendorSnapshot: null,
    }
  }

  if (type === 'AUTOMATION') {
    return {
      action: 'shell',
      deviceId: '',
      // shell
      command: '',
      // tap / swipe
      x: 0,
      y: 0,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      duration: 300,
      // key
      keyCode: 3,
      // input_text
      text: '',
      // open_app
      package: '',
      // http
      method: 'GET',
      url: '',
      headers: '',
      body: '',
      // notify
      title: '',
      content: '',
    }
  }

  return { workflowId: '' }
}

/** Default step object per workflow step type. */
export function createDefaultStep(type = 'ai') {
  const base = {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    name: '',
  }

  if (type === 'ai') {
    return {
      ...base,
      vendorId: '',
      vendorSnapshot: null,
      systemPrompt: '',
      prompt: '',
      deviceId: '',
      includeScreenshot: false,
    }
  }

  if (type === 'action') {
    return {
      ...base,
      action: 'shell',
      deviceId: '',
      command: '',
      x: 0,
      y: 0,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      duration: 300,
      keyCode: 3,
      text: '',
      package: '',
      method: 'GET',
      url: '',
      headers: '',
      body: '',
      title: '',
      content: '',
    }
  }

  return { ...base, seconds: 5 }
}

/** One-line summary of a task config for list cards. */
export function describeTaskConfig(task, t) {
  const config = task.config || {}

  if (task.type === 'AI')
    return String(config.prompt || '').replace(/\s+/g, ' ').slice(0, 80)

  if (task.type === 'WORKFLOW')
    return ''

  const action = config.action

  switch (action) {
    case 'shell': return String(config.command || '').slice(0, 80)
    case 'tap': return `tap (${config.x}, ${config.y})`
    case 'swipe': return `swipe (${config.x1}, ${config.y1}) → (${config.x2}, ${config.y2})`
    case 'key': {
      const hit = KEY_OPTIONS.find(option => option.value === Number(config.keyCode))
      return hit ? t(`automation.keys.${{
        3: 'home', 4: 'back', 82: 'menu', 26: 'power', 187: 'recentApps', 24: 'volumeUp', 25: 'volumeDown', 67: 'delete', 66: 'enter',
      }[hit.value]}`) : `keyevent ${config.keyCode}`
    }
    case 'input_text': return String(config.text || '').slice(0, 40)
    case 'open_app': return String(config.package || '')
    case 'screenshot': return t('tasks.action.screenshot')
    case 'http': return `${config.method || 'GET'} ${String(config.url || '').slice(0, 60)}`
    case 'notify': return String(config.title || '').slice(0, 40)
    default: return ''
  }
}
