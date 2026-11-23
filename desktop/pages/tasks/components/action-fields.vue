<template>
  <div class="flex flex-col gap-2.5">
    <el-form-item v-if="needsDevice" :label="$t('tasks.fields.deviceIds')">
      <div class="flex flex-col gap-1.5 w-full">
        <el-select
          :model-value="deviceSelection"
          class="!w-full"
          multiple collapse-tags collapse-tags-tooltip filterable
          :placeholder="$t('tasks.fields.devicePlaceholder')"
          @update:model-value="handleDeviceSelection"
        >
          <el-option
            v-for="device in devices"
            :key="device.id"
            :value="device.id"
            :label="device.label"
            :disabled="!isDeviceUsable(device)"
          />
        </el-select>
        <span class="text-xs text-gray-400">{{ $t('tasks.fields.deviceIdsHint') }}</span>
      </div>
    </el-form-item>

    <!-- shell -->
    <template v-if="config.action === 'shell'">
      <el-form-item :label="$t('tasks.action.shell')">
        <el-input
          v-model="config.command"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          :placeholder="$t('tasks.action.shellPlaceholder')"
        />
      </el-form-item>
    </template>

    <!-- tap -->
    <template v-else-if="config.action === 'tap'">
      <el-form-item :label="$t('automation.step.tap')">
        <div class="flex items-center gap-2 w-full">
          <el-input-number v-model="config.x" :placeholder="$t('automation.step.x')" :min="0" controls-position="right" />
          <el-input-number v-model="config.y" :placeholder="$t('automation.step.y')" :min="0" controls-position="right" />
          <el-button size="small" icon="PictureFilled" :disabled="!config.deviceId" @click="openPicker('point')">
            {{ $t('automation.picker.screenshot') }}
          </el-button>
        </div>
      </el-form-item>
    </template>

    <!-- swipe -->
    <template v-else-if="config.action === 'swipe'">
      <el-form-item :label="$t('automation.step.swipe')">
        <div class="flex items-center gap-2 w-full">
          <el-input-number v-model="config.x1" :placeholder="$t('automation.picker.start')" :min="0" controls-position="right" />
          <el-input-number v-model="config.y1" controls-position="right" :min="0" />
          <span class="text-gray-400">→</span>
          <el-input-number v-model="config.x2" :placeholder="$t('automation.picker.end')" :min="0" controls-position="right" />
          <el-input-number v-model="config.y2" controls-position="right" :min="0" />
        </div>
      </el-form-item>

      <el-form-item :label="$t('automation.step.duration')">
        <div class="flex items-center gap-2 w-full">
          <el-input-number v-model="config.duration" :min="0" :max="10000" :step="100" controls-position="right" />
          <el-button size="small" icon="PictureFilled" :disabled="!config.deviceId" @click="openPicker('swipe')">
            {{ $t('automation.picker.screenshot') }}
          </el-button>
        </div>
      </el-form-item>
    </template>

    <!-- key -->
    <template v-else-if="config.action === 'key'">
      <el-form-item :label="$t('automation.step.key')">
        <el-select v-model="config.keyCode" class="!w-full" :placeholder="$t('automation.step.key.select')">
          <el-option
            v-for="option in KEY_OPTIONS"
            :key="option.value"
            :value="option.value"
            :label="$t(option.label)"
          />
        </el-select>
      </el-form-item>
    </template>

    <!-- input_text -->
    <template v-else-if="config.action === 'input_text'">
      <el-form-item :label="$t('tasks.action.input_text')">
        <el-input
          v-model="config.text"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          :placeholder="$t('automation.step.input.placeholder')"
        />
      </el-form-item>
    </template>

    <!-- open_app -->
    <template v-else-if="config.action === 'open_app'">
      <el-form-item :label="$t('automation.step.launch.package')">
        <el-input v-model="config.package" :placeholder="$t('tasks.action.openAppPlaceholder')" />
      </el-form-item>
    </template>

    <!-- screenshot -->
    <template v-else-if="config.action === 'screenshot'">
      <el-form-item :label="$t('tasks.action.screenshot')">
        <span class="text-xs text-gray-400">{{ $t('tasks.action.screenshotHint') }}</span>
      </el-form-item>
    </template>

    <!-- http -->
    <template v-else-if="config.action === 'http'">
      <el-form-item :label="$t('tasks.action.http')">
        <div class="flex gap-2 w-full">
          <el-select v-model="config.method" class="!w-28">
            <el-option v-for="method in HTTP_METHODS" :key="method" :value="method" :label="method" />
          </el-select>
          <el-input v-model="config.url" placeholder="https://example.com/api" />
        </div>
      </el-form-item>

      <el-form-item v-if="config.method !== 'GET'" :label="$t('tasks.action.headers')">
        <el-input v-model="config.headers" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder='{ "Authorization": "Bearer ..." }' />
      </el-form-item>

      <el-form-item v-if="!['GET', 'DELETE'].includes(config.method)" :label="$t('tasks.action.body')">
        <el-input v-model="config.body" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" placeholder='{ "key": "value" }' />
      </el-form-item>
    </template>

    <!-- notify -->
    <template v-else-if="config.action === 'notify'">
      <el-form-item :label="$t('tasks.action.notify')">
        <el-input v-model="config.title" :placeholder="$t('tasks.action.notifyTitlePlaceholder')" />
      </el-form-item>
      <el-form-item :label="$t('tasks.action.notifyContent')">
        <el-input v-model="config.content" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" :placeholder="$t('tasks.action.notifyContentPlaceholder')" />
      </el-form-item>
    </template>

    <PickerDialog
      v-model:visible="pickerVisible"
      :mode="pickerMode"
      :device-id="config.deviceId"
      @confirm="handlePickerConfirm"
    />
  </div>
</template>

<script setup>
import { AUTOMATION_ACTIONS, HTTP_METHODS, KEY_OPTIONS } from '../configs/index.js'
import PickerDialog from './picker-dialog.vue'

const props = defineProps({
  config: { type: Object, required: true },
  devices: { type: Array, default: () => [] },
})

const needsDevice = computed(() => {
  const hit = AUTOMATION_ACTIONS.find(item => item.value === props.config.action)
  return hit?.needsDevice === true
})

const pickerVisible = ref(false)
const pickerMode = ref('point')

function isDeviceUsable(device) {
  return device.status === 'device'
}

function openPicker(mode) {
  pickerMode.value = mode
  pickerVisible.value = true
}

const matchTesting = ref(false)

const deviceSelection = computed(() => {
  if (Array.isArray(props.config.deviceIds) && props.config.deviceIds.length)
    return [...props.config.deviceIds]
  return props.config.deviceId ? [props.config.deviceId] : []
})

/** Multi-select keeps a single-device task single (deviceId) and switches to
 * broadcast (deviceIds) the moment more than one device is selected. */
function handleDeviceSelection(value) {
  const ids = [...(value || [])]
  if (ids.length <= 1) {
    props.config.deviceId = ids[0] || ''
    props.config.deviceIds = []
  }
  else {
    props.config.deviceIds = ids
    props.config.deviceId = ids[0]
  }
}

function toggleImageMatch(value) {
  if (value)
    props.config.imageMatch = { enabled: true, templatePath: '', threshold: 0.8, followMatchPoint: false, optional: false }
  else
    props.config.imageMatch = null
}

function pickTemplateFile(target) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file)
      return
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(file)
    })
    const name = (file.name || 'template').replace(/\.\w+$/, '')
    const result = await window.$preload.ipcxRenderer.invoke('tasks:save-template', { name, imageBase64: base64 })
    if (result?.success) {
      if (target)
        target.templatePath = result.path
      else
        props.config.templatePath = result.path
      ElMessage.success(result.path)
    }
    else {
      ElMessage.error(result?.error?.message || 'save failed')
    }
  }
  input.click()
}

async function testMatch() {
  const deviceId = props.config.deviceIds?.[0] || props.config.deviceId
  const templatePath = props.config.templatePath || props.config.imageMatch?.templatePath
  if (!deviceId || !templatePath) {
    ElMessage.warning('device + template required')
    return
  }
  matchTesting.value = true
  try {
    const result = await window.$preload.ipcxRenderer.invoke('tasks:test-match', {
      deviceId,
      templatePath,
      threshold: props.config.threshold ?? props.config.imageMatch?.threshold,
    })
    if (result?.success)
      ElMessage.success(`${result.match.matched ? 'MATCH' : 'NO MATCH'} · score ${result.match.score} @ ${result.match.x},${result.match.y}`)
    else
      ElMessage.error(result?.error?.message || 'match failed')
  }
  finally {
    matchTesting.value = false
  }
}

function handlePickerConfirm(coords) {
  if (pickerMode.value === 'point') {
    props.config.x = coords.x
    props.config.y = coords.y
  }
  else {
    props.config.x1 = coords.x1
    props.config.y1 = coords.y1
    props.config.x2 = coords.x2
    props.config.y2 = coords.y2
  }
}
</script>
