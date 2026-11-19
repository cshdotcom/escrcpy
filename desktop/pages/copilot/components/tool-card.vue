<template>
  <div
    class="rounded-lg border text-xs overflow-hidden
      border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60"
  >
    <div class="flex items-center gap-2 px-2.5 py-1.5 select-none">
      <span class="text-base" :class="statusIconClass" />

      <span class="font-medium">{{ toolLabel }}</span>

      <span
        class="px-1.5 py-0.5 rounded text-[0.7rem]"
        :class="statusClass"
      >
        {{ statusLabel }}
      </span>

      <span class="flex-1" />

      <el-button
        v-if="hasDetails"
        text
        size="small"
        class="!px-1"
        @click="expanded = !expanded"
      >
        <i :class="expanded ? 'i-solar-alt-arrow-up-linear' : 'i-solar-alt-arrow-down-linear'" />
      </el-button>
    </div>

    <div v-if="image" class="px-2.5 pb-2">
      <el-image
        :src="image"
        :preview-src-list="[image]"
        fit="cover"
        class="w-20 h-32 rounded border border-gray-200 dark:border-gray-700 object-cover"
      />
    </div>

    <div v-if="expanded" class="border-t border-gray-200 dark:border-gray-700">
      <div v-if="args" class="px-2.5 py-1.5">
        <div class="text-gray-400 dark:text-gray-500 mb-0.5">
          {{ $t('copilot.confirm.args') }}
        </div>
        <pre class="whitespace-pre-wrap break-all text-[0.7rem] leading-normal text-gray-600 dark:text-gray-300">{{ prettyArgs }}</pre>
      </div>

      <div class="px-2.5 py-1.5 border-t border-gray-100 dark:border-gray-700/50">
        <div class="text-gray-400 dark:text-gray-500 mb-0.5">
          {{ $t('copilot.tool.result') }}
        </div>
        <pre class="whitespace-pre-wrap break-all text-[0.7rem] leading-normal text-gray-600 dark:text-gray-300 max-h-60 overflow-auto">{{ resultText }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  message: {
    type: Object,
    required: true,
  },
})

const expanded = ref(false)

const toolLabelMap = {
  get_device_info: 'copilot.tools.get_device_info',
  screenshot: 'copilot.tools.screenshot',
  get_ui_layout: 'copilot.tools.get_ui_layout',
  tap: 'copilot.tools.tap',
  swipe: 'copilot.tools.swipe',
  input_text: 'copilot.tools.input_text',
  key: 'copilot.tools.key',
  shell: 'copilot.tools.shell',
  list_devices: 'copilot.tools.list_devices',
  open_app: 'copilot.tools.open_app',
}

const toolLabel = computed(() => {
  const key = toolLabelMap[props.message.name]
  const value = key ? window.$preload.i18n.t(key) : props.message.name
  return value.startsWith('copilot.') ? props.message.name : value
})

const hasDetails = computed(() => Boolean(props.message.args || props.message.content))
const image = computed(() => props.message.image || null)

const prettyArgs = computed(() => {
  try {
    return JSON.stringify(props.message.args, null, 2)
  }
  catch {
    return String(props.message.args ?? '')
  }
})

const resultText = computed(() => {
  const content = String(props.message.content ?? '')
  if (!content)
    return window.$preload.i18n.t('copilot.tool.noResult')
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  }
  catch {
    return content
  }
})

const statusLabel = computed(() => {
  const map = {
    running: 'copilot.chat.toolRunning',
    awaiting: 'copilot.chat.toolAwaitingConfirmation',
    completed: 'copilot.chat.toolCompleted',
    failed: 'copilot.chat.toolFailed',
    denied: 'copilot.tool.denied',
  }
  const key = map[props.message.status]
  if (!key)
    return props.message.status || ''
  const value = window.$preload.i18n.t(key)
  return value.startsWith('copilot.') ? props.message.status : value
})

const statusClass = computed(() => {
  switch (props.message.status) {
    case 'completed': return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
    case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    case 'running': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 animate-pulse'
    case 'denied': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  }
})

const statusIconClass = computed(() => {
  switch (props.message.name) {
    case 'screenshot': return 'i-solar-camera-minimalistic-linear text-purple-500'
    case 'get_ui_layout': return 'i-solar-widget-5-linear text-cyan-500'
    case 'get_device_info': return 'i-solar-smartphone-linear text-blue-500'
    case 'list_devices': return 'i-solar-devices-linear text-blue-500'
    case 'tap': return 'i-solar-cursor-linear text-green-500'
    case 'swipe': return 'i-solar-hand-stars-linear text-green-500'
    case 'input_text': return 'i-solar-keyboard-linear text-green-500'
    case 'key': return 'i-solar-key-square-linear text-green-500'
    case 'open_app': return 'i-solar-rocket-linear text-orange-500'
    case 'shell': return 'i-bi-terminal text-gray-500'
    default: return 'i-bi-wrench text-gray-500'
  }
})
</script>
