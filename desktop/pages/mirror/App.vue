<template>
  <div class="relative w-full h-full bg-black overflow-hidden select-none">
    <!-- Header -->
    <div class="absolute top-0 inset-x-0 z-30 flex items-center gap-1 px-2 h-8 app-region-drag bg-gradient-to-b from-black/80 to-transparent">
      <span class="text-xs text-white/85 truncate max-w-40">{{ deviceName }}</span>
      <span class="text-[10px] text-white/40 truncate">{{ size.width }}×{{ size.height }}</span>
      <span v-if="status === 'connected'" class="text-[10px] text-white/40">{{ stats.fps }} fps</span>
      <span v-if="audioEnabled" class="text-[10px] text-white/30">audio</span>

      <div class="flex-1" />

      <el-tooltip :content="$t('keyboard.mapping.name')" placement="bottom">
        <el-button text size="small" class="!px-1.5" :class="panelVisible ? 'text-primary-400' : 'text-white/70'" @click="panelVisible = !panelVisible">
          <el-icon><ElIconGrid /></el-icon>
        </el-button>
      </el-tooltip>

      <el-tooltip :content="$t('mirror.header.alwaysOnTop')" placement="bottom">
        <el-button text size="small" class="!px-1.5" :class="alwaysOnTop ? 'text-primary-400' : 'text-white/70'" @click="toggleAlwaysOnTop">
          <el-icon><ElIconTop /></el-icon>
        </el-button>
      </el-tooltip>

      <el-tooltip :content="audioEnabled ? '关闭声音' : '开启声音'" placement="bottom">
        <el-button text size="small" class="!px-1.5" :class="audioEnabled ? 'text-primary-400' : 'text-white/70'" @click="toggleAudio">
          <el-icon><ElIconMicrophone /></el-icon>
        </el-button>
      </el-tooltip>

      <el-tooltip :content="$t('mirror.header.fullscreen')" placement="bottom">
        <el-button text size="small" class="!px-1.5 text-white/70" @click="toggleFullscreen">
          <el-icon><ElIconFullScreen /></el-icon>
        </el-button>
      </el-tooltip>

      <el-button text size="small" class="!px-1.5 text-white/70" @click="closeWindow">
        <el-icon><ElIconClose /></el-icon>
      </el-button>
    </div>

    <!-- Stage -->
    <div ref="stageRef" class="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        ref="videoWrapRef"
        class="relative bg-black"
        :style="stageStyle"
        @pointerdown="handlePointerDown"
        @pointermove="handlePointerMove"
        @pointerup="handlePointerUp"
        @pointercancel="handlePointerUp"
        @wheel.prevent="handleWheel"
        @contextmenu.prevent="handleContextMenu"
      >
        <video
          v-show="stream.mode.value === 'video'"
          ref="videoEl"
          autoplay
          muted
          playsinline
          class="absolute inset-0 w-full h-full object-contain"
        />
        <canvas
          v-show="stream.mode.value === 'canvas'"
          ref="canvasEl"
          class="absolute inset-0 w-full h-full object-contain"
        />

        <KeymapOverlay
          :mappings="activeMappings"
          :mode="mapping.mode.value"
          :selected-id="mapping.selectedId.value"
          @select="handleSelectMapping"
          @update="handleUpdateMappingPosition"
          @add="handleAddMapping"
        />

        <!-- touch feedback -->
        <div
          v-for="point in touchPoints"
          :key="point.id"
          class="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border border-white/70 bg-white/20 pointer-events-none"
          :style="{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }"
        />
      </div>
    </div>

    <!-- Keymap panel -->
    <div v-if="panelVisible" class="absolute right-2 top-10 z-40 max-h-[calc(100%-3rem)]">
      <KeymapPanel
        :profiles="mapping.profiles.value"
        :active-id="mapping.activeId.value"
        :selected-id="mapping.selectedId.value"
        :selected-mapping="mapping.selectedMapping.value"
        :mode="mapping.mode.value"
        :capturing="mapping.capturing.value"
        :workflows="workflows"
        @update:active-id="value => mapping.activeId.value = value"
        @update:mode="value => mapping.mode.value = value"
        @select="handleSelectMapping"
        @close="panelVisible = false"
        @start-capture="startCapture"
        @update-mapping="handleUpdateMapping"
        @remove-mapping="handleRemoveMapping"
        @create-profile="handleCreateProfile"
        @duplicate-profile="handleDuplicateProfile"
        @delete-profile="handleDeleteProfile"
        @import-profile="handleImportProfile"
        @export-profile="handleExportProfile"
      />
    </div>

    <!-- Status overlay -->
    <div
      v-if="status !== 'connected'"
      class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 text-white"
    >
      <template v-if="status === 'connecting'">
        <el-icon class="is-loading text-3xl">
          <ElIconLoading />
        </el-icon>
        <span class="text-xs text-white/70">{{ $t('mirror.stream.connecting') }}</span>
      </template>

      <template v-else-if="status === 'error'">
        <el-icon class="text-3xl text-red-400">
          <ElIconWarningFilled />
        </el-icon>
        <span class="text-xs text-white/70 max-w-xs text-center px-4">{{ error }}</span>
        <el-button size="small" type="primary" @click="reconnect">
          {{ $t('mirror.stream.reconnect') }}
        </el-button>
      </template>

      <template v-else-if="status === 'disconnected'">
        <span class="text-xs text-white/60">{{ $t('mirror.stream.disconnected') }}</span>
        <el-button size="small" type="primary" @click="reconnect">
          {{ $t('mirror.stream.reconnect') }}
        </el-button>
      </template>
    </div>
  </div>
</template>

<script setup>
import KeymapOverlay from './components/keymap-overlay.vue'
import KeymapPanel from './components/keymap-panel.vue'
import { useMirrorStream } from './composables/use-mirror-stream.js'
import { comboFromEvent, useKeyboardMapping } from './composables/use-keyboard-mapping.js'
import { isReservedKey, isTextInputEvent, keyCodeFromEvent } from './utils/keys.js'

const { t } = useI18n()
const deviceStore = useDeviceStore()

const { currentDevice } = useWindowStateSync({ deviceSync: true })

const deviceId = computed(() => currentDevice.value?.id || window.$preload?.payload?.device?.id || '')
const deviceName = computed(() => deviceStore.getLabel(currentDevice.value, ({ deviceName }) => deviceName))

const audioEnabled = ref(true)
const alwaysOnTop = ref(false)
const panelVisible = ref(false)
const workflows = ref([])

const stream = useMirrorStream(deviceId, ref({
  maxSize: 1080,
  maxFps: 60,
  audio: true,
  audioCodec: 'opus',
}))

const {
  status,
  error,
  size,
  stats,
  videoRef,
  canvasRef,
  mode: streamMode,
  start,
  stop,
  reconnect: reconnectStream,
  setVolume,
} = stream

const videoEl = videoRef
const canvasEl = canvasRef

const mapping = useKeyboardMapping({
  deviceIdRef: deviceId,
  control: sendControl,
})

const activeMappings = computed(() => mapping.activeProfile.value?.mappings || [])

const stageRef = ref(null)
const videoWrapRef = ref(null)
const stageSize = reactive({ width: 320, height: 568 })

const stageStyle = computed(() => ({
  width: `${stageSize.width}px`,
  height: `${stageSize.height}px`,
}))

let resizeObserver = null

function layout() {
  const container = stageRef.value
  if (!container)
    return
  const rect = container.getBoundingClientRect()
  const width = size.width || 1080
  const height = size.height || 1920
  const ratio = width / height
  let width2 = rect.width
  let height2 = width2 / ratio
  if (height2 > rect.height) {
    height2 = rect.height
    width2 = height2 * ratio
  }
  stageSize.width = Math.max(1, Math.round(width2))
  stageSize.height = Math.max(1, Math.round(height2))
}

watch(() => [size.width, size.height], layout)

// ── touch input ────────────────────────────────────────────────────────────

const touchPoints = ref([])
const pointerMap = new Map()

function normalizedPoint(event) {
  const rect = videoWrapRef.value?.getBoundingClientRect()
  if (!rect)
    return { x: 0, y: 0 }
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  }
}

function nextPointerId() {
  let index = 1
  const used = new Set(pointerMap.values())
  while (used.has(-index))
    index += 1
  return -index
}

async function sendControl(kind, payload) {
  return window.$preload.ipcxRenderer.invoke('mirror:control', {
    deviceId: deviceId.value,
    message: { kind, ...payload },
  })
}

function handlePointerDown(event) {
  if (status.value !== 'connected')
    return
  if (mapping.mode.value === 'edit')
    return
  event.preventDefault()
  event.currentTarget.setPointerCapture?.(event.pointerId)
  const point = normalizedPoint(event)
  const pointerId = nextPointerId()
  pointerMap.set(event.pointerId, pointerId)
  touchPoints.value.push({ id: event.pointerId, ...point })
  sendControl('touch', { action: 'down', pointerId, x: point.x, y: point.y, normalized: true })
}

function handlePointerMove(event) {
  if (mapping.mode.value === 'edit')
    return
  const pointerId = pointerMap.get(event.pointerId)
  if (!pointerId)
    return
  event.preventDefault()
  const point = normalizedPoint(event)
  const index = touchPoints.value.findIndex(item => item.id === event.pointerId)
  if (index !== -1)
    touchPoints.value.splice(index, 1, { id: event.pointerId, ...point })
  sendControl('touch', { action: 'move', pointerId, x: point.x, y: point.y, normalized: true })
}

function handlePointerUp(event) {
  const pointerId = pointerMap.get(event.pointerId)
  if (!pointerId)
    return
  pointerMap.delete(event.pointerId)
  touchPoints.value = touchPoints.value.filter(item => item.id !== event.pointerId)
  const point = normalizedPoint(event)
  sendControl('touch', { action: 'up', pointerId, x: point.x, y: point.y, normalized: true, pressure: 0 })
}

async function handleWheel(event) {
  if (mapping.mode.value === 'play' && mapping.handleWheel(event))
    return
  if (status.value !== 'connected')
    return
  const rect = videoWrapRef.value?.getBoundingClientRect()
  const point = normalizedPoint(event)
  const factor = 0.01
  await sendControl('scroll', {
    x: point.x,
    y: point.y,
    normalized: true,
    scrollX: (event.deltaX / (rect?.width || 1)) * factor * 10,
    scrollY: (event.deltaY / (rect?.height || 1)) * factor * 10,
  })
}

function handleContextMenu(event) {
  if (mapping.mode.value === 'edit')
    return
  if (status.value !== 'connected')
    return
  sendControl('command', { command: 'back' })
}

// ── keyboard input ─────────────────────────────────────────────────────────

function onKeyDown(event) {
  // capture mode for keyboard mappings
  if (mapping.capturing.value) {
    const capture = mapping.capturing.value
    if (event.code === 'Escape') {
      event.preventDefault()
      mapping.capturing.value = null
      return
    }
    event.preventDefault()
    event.stopPropagation()

    const mappingId = capture.mappingId
    if (capture.target === 'direction') {
      const profile = mapping.activeProfile.value
      const target = profile?.mappings.find(item => item.id === mappingId)
      if (target) {
        mapping.updateMapping(mappingId, {
          action: {
            directions: {
              ...(target.action.directions || {}),
              [capture.direction]: comboFromEvent(event),
            },
          },
        })
      }
    }
    else {
      mapping.updateMapping(mappingId, { trigger: comboFromEvent(event) })
    }
    mapping.capturing.value = null
    return
  }

  if (isReservedKey(event))
    return

  if (mapping.mode.value === 'play' && mapping.handleKeyDown(event))
    return

  if (status.value !== 'connected')
    return

  // Escape behaves like "back" on the device, matching scrcpy.
  if (event.code === 'Escape') {
    event.preventDefault()
    sendControl('command', { command: 'back' })
    return
  }

  const mapped = keyCodeFromEvent(event)
  if (!mapped)
    return

  event.preventDefault()

  if (isTextInputEvent(event) && !event.repeat) {
    sendControl('text', { text: event.key })
    return
  }

  sendControl('key', {
    action: 'down',
    keyCode: mapped.keyCode,
    metaState: mapped.metaState,
    repeat: event.repeat ? 1 : 0,
  })
}

function onKeyUp(event) {
  if (mapping.capturing.value)
    return

  if (mapping.mode.value === 'play' && mapping.handleKeyUp(event))
    return

  if (isReservedKey(event))
    return

  const mapped = keyCodeFromEvent(event)
  if (!mapped)
    return
  event.preventDefault()
  sendControl('key', {
    action: 'up',
    keyCode: mapped.keyCode,
    metaState: mapped.metaState,
  })
}

// ── keymap panel actions ───────────────────────────────────────────────────

function handleSelectMapping(id) {
  mapping.selectedId.value = id
}

function handleUpdateMappingPosition({ id, position }) {
  mapping.updateMapping(id, { position })
}

function handleAddMapping(position) {
  if (mapping.mode.value !== 'edit')
    return
  const item = mapping.addMapping('tap', position)
  mapping.selectedId.value = item.id
}

function startCapture({ target, direction }) {
  if (!mapping.selectedMapping.value)
    return
  mapping.capturing.value = {
    mappingId: mapping.selectedMapping.value.id,
    target,
    direction,
    pendingLabel: '',
  }
}

function handleUpdateMapping(id, patch) {
  mapping.updateMapping(id, patch)
}

function handleRemoveMapping(id) {
  mapping.removeMapping(id)
}

async function handleCreateProfile() {
  const profile = mapping.create(t('keyboard.mapping.profile.new'))
  mapping.mode.value = 'edit'
  return profile
}

function handleDuplicateProfile() {
  mapping.duplicate()
}

function handleDeleteProfile() {
  if (!mapping.activeProfile.value)
    return
  ElMessageBox.confirm(
    t('keyboard.mapping.profile.deleteConfirm'),
    t('keyboard.mapping.profile.deleteTitle'),
    { type: 'warning' },
  ).then(() => {
    mapping.remove()
  }).catch(() => {})
}

function handleImportProfile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.multiple = true
  input.onchange = async () => {
    const files = await Promise.all([...input.files].map(file => file.text()))
    const count = mapping.importProfiles(files)
    ElMessage.success(t('keyboard.mapping.profile.importSuccess', { count }))
  }
  input.click()
}

async function handleExportProfile() {
  const content = mapping.exportProfiles()
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `escrcpy-keymap-${deviceId.value}.json`
  link.click()
  URL.revokeObjectURL(url)
}

// ── window controls ────────────────────────────────────────────────────────

function toggleAlwaysOnTop() {
  window.$preload.ipcxRenderer.invoke('mirror:window', { action: 'always-on-top' }).then((result) => {
    alwaysOnTop.value = Boolean(result?.value)
  })
}

async function toggleAudio() {
  audioEnabled.value = !audioEnabled.value
  await start({ audio: audioEnabled.value })
}

function toggleFullscreen() {
  window.$preload.ipcxRenderer.invoke('mirror:window', { action: 'fullscreen' })
}

function closeWindow() {
  window.$preload.ipcxRenderer.invoke('mirror:window', { action: 'close' })
}

async function syncClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text)
      await sendControl('clipboard', { text, paste: false })
  }
  catch {}
}

// ── lifecycle ──────────────────────────────────────────────────────────────

async function reconnect() {
  await start()
}

async function loadWorkflows() {
  try {
    const result = await window.$preload.ipcxRenderer.invoke('workflows:list')
    workflows.value = result?.workflows || []
  }
  catch {
    workflows.value = []
  }
}

onMounted(async () => {
  layout()
  resizeObserver = new ResizeObserver(layout)
  resizeObserver.observe(stageRef.value)

  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('focus', syncClipboard)

  await mapping.load()
  await loadWorkflows()
  await start()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('keyup', onKeyUp, true)
  window.removeEventListener('focus', syncClipboard)
  mapping.clearRuntime()
  stop()
})

watch(deviceId, (value, previous) => {
  if (value && value !== previous)
    start()
})
</script>

<style lang="postcss">
html,
body {
  background-color: #000000;
  overflow: hidden;
}

.app-region-drag {
  -webkit-app-region: drag;
}

.app-region-drag button {
  -webkit-app-region: no-drag;
}
</style>
