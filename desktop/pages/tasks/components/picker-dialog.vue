<template>
  <el-dialog
    v-model="visibleModel"
    :title="$t(mode === 'point' ? 'automation.picker.instruction.point' : 'automation.picker.instruction.swipe')"
    width="720px"
    destroy-on-close
    @opened="loadScreenshot"
  >
    <div class="flex flex-col gap-2">
      <div v-if="loading" class="flex items-center justify-center py-16 gap-2 text-sm text-gray-400">
        <i class="i-solar-refresh-bold animate-spin" />
        {{ $t('automation.picker.loading') }}
      </div>

      <div v-else-if="error" class="flex flex-col items-center justify-center py-12 gap-2">
        <span class="text-xs text-red-500">{{ error }}</span>
        <el-button size="small" @click="loadScreenshot">
          {{ $t('tasks.refresh') }}
        </el-button>
      </div>

      <div
        v-else-if="screenshot"
        ref="stageRef"
        class="relative mx-auto rounded-md overflow-hidden select-none cursor-crosshair border border-gray-200 dark:border-gray-700"
        style="max-width: 100%; max-height: 60vh"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseUp"
      >
        <img :src="screenshot" alt="screenshot" class="block" style="max-width: 100%; max-height: 60vh" draggable="false">

        <!-- swipe trail -->
        <svg v-if="mode === 'swipe' && dragging" class="absolute inset-0 w-full h-full pointer-events-none">
          <line
            :x1="`${startPercent.x}%`" :y1="`${startPercent.y}%`"
            :x2="`${currentPercent.x}%`" :y2="`${currentPercent.y}%`"
            stroke="#3b82f6" stroke-width="3" stroke-linecap="round"
          />
          <circle :cx="`${startPercent.x}%`" :cy="`${startPercent.y}%`" r="6" fill="#3b82f6" />
          <circle :cx="`${currentPercent.x}%`" :cy="`${currentPercent.y}%`" r="6" fill="#3b82f6" />
        </svg>

        <!-- picked marker -->
        <div
          v-if="picked"
          class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          :style="{ left: `${picked.percent.x}%`, top: `${picked.percent.y}%` }"
        >
          <span class="block w-3.5 h-3.5 rounded-full bg-blue-500 ring-2 ring-white shadow" />
        </div>

        <div
          v-if="picked"
          class="absolute px-1.5 py-0.5 rounded bg-black/70 text-white text-xs pointer-events-none"
          :style="{ left: `${Math.min(picked.percent.x + 1.5, 88)}%`, top: `${Math.min(picked.percent.y + 1.5, 88)}%` }"
        >
          ({{ picked.px.x }}, {{ picked.px.y }})
        </div>
      </div>

      <div v-else class="py-12 text-center text-xs text-gray-400">
        {{ $t('automation.picker.noSelection') }}
      </div>
    </div>

    <template #footer>
      <div class="flex items-center gap-2">
        <span v-if="picked" class="flex-1 text-xs text-gray-500">
          {{ mode === 'point'
            ? `(${picked.px.x}, ${picked.px.y})`
            : `(${picked.px.x1}, ${picked.px.y1}) → (${picked.px.x2}, ${picked.px.y2})` }}
        </span>
        <span v-else class="flex-1 text-xs text-gray-400">{{ $t('automation.picker.noSelection') }}</span>

        <el-button size="small" :disabled="!screenshot" @click="loadScreenshot">
          {{ $t('tasks.refresh') }}
        </el-button>
        <el-button size="small" type="primary" :disabled="!picked" @click="handleConfirm">
          {{ $t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
const props = defineProps({
  visible: { type: Boolean, default: false },
  mode: { type: String, default: 'point' }, // point | swipe
  deviceId: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'confirm'])

const visibleModel = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value),
})

const loading = ref(false)
const error = ref('')
const screenshot = ref('')
const stageRef = ref(null)

const naturalSize = ref({ width: 0, height: 0 })

const dragging = ref(false)
const startPercent = ref({ x: 0, y: 0 })
const currentPercent = ref({ x: 0, y: 0 })
const picked = ref(null)

async function loadScreenshot() {
  if (!props.deviceId) {
    error.value = 'No device selected'
    return
  }

  loading.value = true
  error.value = ''
  screenshot.value = ''
  picked.value = null

  try {
    const base64 = await window.$preload.adb.screencap(props.deviceId, { returnBase64: true })
    if (!base64)
      throw new Error('Empty screenshot')

    screenshot.value = `data:image/png;base64,${base64}`

    const image = new Image()
    image.onload = () => {
      naturalSize.value = { width: image.naturalWidth, height: image.naturalHeight }
    }
    image.src = screenshot.value
  }
  catch (err) {
    error.value = err?.message || String(err)
  }
  finally {
    loading.value = false
  }
}

function toPercent(event) {
  const stage = stageRef.value
  if (!stage)
    return { x: 0, y: 0 }

  const rect = stage.getBoundingClientRect()
  const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
  const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
  return { x: x * 100, y: y * 100 }
}

function toPx(percent) {
  return {
    x: Math.round((percent.x / 100) * naturalSize.value.width),
    y: Math.round((percent.y / 100) * naturalSize.value.height),
  }
}

function handleMouseDown(event) {
  if (!screenshot.value)
    return

  const percent = toPercent(event)

  if (props.mode === 'point') {
    const px = toPx(percent)
    picked.value = { percent, px }
    return
  }

  dragging.value = true
  startPercent.value = percent
  currentPercent.value = percent
  picked.value = null
}

function handleMouseMove(event) {
  if (!dragging.value)
    return
  currentPercent.value = toPercent(event)
}

function handleMouseUp(event) {
  if (!dragging.value)
    return

  dragging.value = false
  const end = toPercent(event)

  const p1 = toPx(startPercent.value)
  const p2 = toPx(end)

  picked.value = {
    percent: { x: end.x, y: end.y },
    px: { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
  }
}

function handleConfirm() {
  if (!picked.value)
    return

  if (props.mode === 'point') {
    emit('confirm', { x: picked.value.px.x, y: picked.value.px.y })
  }
  else {
    const { x1, y1, x2, y2 } = picked.value.px
    emit('confirm', { x1, y1, x2, y2 })
  }

  visibleModel.value = false
}
</script>
