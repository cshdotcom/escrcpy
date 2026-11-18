<template>
  <div class="flex flex-col gap-2.5">
    <el-form-item v-if="needsDevice" :label="$t('tasks.fields.device')">
      <el-select v-model="config.deviceId" class="!w-full" :placeholder="$t('tasks.fields.devicePlaceholder')" filterable>
        <el-option
          v-for="device in devices"
          :key="device.id"
          :value="device.id"
          :label="device.label"
          :disabled="!isDeviceUsable(device)"
        />
      </el-select>
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
