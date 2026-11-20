<template>
  <el-dialog
    v-model="visibleModel"
    :title="isEditing ? $t('tasks.editor.editTitle') : $t('tasks.editor.createTitle')"
    width="640px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-scrollbar max-height="62vh">
      <el-form label-position="top" class="pr-3">
        <!-- Basics -->
        <el-form-item :label="$t('tasks.fields.name')" required>
          <el-input v-model="form.name" :placeholder="$t('tasks.fields.namePlaceholder')" maxlength="60" show-word-limit />
        </el-form-item>

        <!-- Type -->
        <el-form-item :label="$t('tasks.fields.type')" required>
          <div class="grid grid-cols-3 gap-2 w-full">
            <div
              v-for="item in TASK_TYPES"
              :key="item.value"
              class="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border cursor-pointer transition-colors"
              :class="form.type === item.value
                ? 'border-blue-500 bg-blue-500/5 text-blue-600 dark:text-blue-300'
                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'"
              @click="handleTypeChange(item.value)"
            >
              <i :class="item.icon" class="text-xl" />
              <span class="text-xs">{{ $t(item.label) }}</span>
            </div>
          </div>
        </el-form-item>

        <!-- Schedule -->
        <el-form-item :label="$t('tasks.fields.schedule')" required>
          <div class="flex gap-2 w-full">
            <el-select v-model="schedulePreset" class="!w-44" @change="handlePresetChange">
              <el-option
                v-for="preset in CRON_PRESETS"
                :key="preset.value"
                :value="preset.value"
                :label="$t(preset.label)"
              />
            </el-select>

            <el-input
              v-if="schedulePreset === 'custom'"
              v-model="form.cronExpr"
              class="flex-1"
              placeholder="*/10 * * * *"
              @input="handleCronInput"
            />
            <el-input v-else v-model="form.cronExpr" class="flex-1" disabled />
          </div>

          <div v-if="cronPreview.valid && cronPreview.next.length" class="w-full mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            <div class="flex items-center gap-1 flex-wrap">
              <i class="i-solar-clock-circle-linear shrink-0" />
              <span class="shrink-0">{{ $t('tasks.cron.nextRuns') }}:</span>
              <span class="text-gray-500 dark:text-gray-400 min-w-0">
                {{ cronPreview.next.map(time => formatDateTime(time)).join('  ·  ') }}
              </span>
            </div>
          </div>
          <div v-else-if="form.cronExpr" class="w-full mt-1.5 text-xs text-red-500">
            {{ $t('tasks.cron.invalid') }}
          </div>
        </el-form-item>

        <!-- Type-specific config -->
        <template v-if="form.type === 'AI'">
          <el-divider content-position="left">{{ $t('tasks.editor.aiConfig') }}</el-divider>

          <el-form-item :label="$t('tasks.fields.vendor')" required>
            <el-select v-model="form.config.vendorId" class="!w-full" :placeholder="$t('tasks.fields.vendorPlaceholder')">
              <el-option
                v-for="vendor in vendors"
                :key="vendor.id"
                :value="vendor.id"
                :label="`${vendor.name} · ${vendor.model || '...'}`"
                :disabled="!vendor.configured"
              >
                <div class="flex items-center justify-between gap-3 w-full">
                  <span>{{ vendor.name }} · {{ vendor.model || '...' }}</span>
                  <el-tag size="small" :type="vendor.configured ? 'success' : 'info'" class="!m-0">
                    {{ vendor.configured ? $t('tasks.vendor.configured') : $t('tasks.vendor.unconfigured') }}
                  </el-tag>
                </div>
              </el-option>
            </el-select>
            <div v-if="!vendors.length" class="w-full mt-1 text-xs text-gray-400">
              {{ $t('tasks.vendor.emptyHint') }}
            </div>
          </el-form-item>

          <el-form-item :label="$t('tasks.fields.systemPrompt')">
            <el-input
              v-model="form.config.systemPrompt"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 5 }"
              :placeholder="$t('tasks.fields.systemPromptPlaceholder')"
            />
          </el-form-item>

          <el-form-item :label="$t('tasks.fields.prompt')" required>
            <el-input
              v-model="form.config.prompt"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 10 }"
              :placeholder="$t('tasks.fields.promptPlaceholder')"
            />
          </el-form-item>

          <el-form-item :label="$t('tasks.fields.deviceContext')">
            <div class="flex flex-col gap-2 w-full">
              <el-select v-model="form.config.deviceId" size="small" class="!w-64" clearable :placeholder="$t('tasks.fields.devicePlaceholder')">
                <el-option
                  v-for="device in devices"
                  :key="device.id"
                  :value="device.id"
                  :label="device.label"
                  :disabled="!isDeviceUsable(device)"
                />
              </el-select>

              <div class="flex gap-4">
                <el-checkbox v-model="form.config.includeDeviceInfo" :label="$t('tasks.fields.includeDeviceInfo')" />
                <el-checkbox v-model="form.config.includeScreenshot" :label="$t('tasks.fields.includeScreenshot')" />
              </div>
            </div>
          </el-form-item>
        </template>

        <template v-else-if="form.type === 'AUTOMATION'">
          <el-divider content-position="left">{{ $t('tasks.editor.automationConfig') }}</el-divider>

          <el-form-item :label="$t('tasks.fields.action')" required>
            <el-select v-model="form.config.action" class="!w-full" @change="handleActionChange">
              <el-option
                v-for="action in AUTOMATION_ACTIONS"
                :key="action.value"
                :value="action.value"
                :label="$t(action.label)"
              />
            </el-select>
          </el-form-item>

          <ActionFields :config="form.config" :devices="devices" />
        </template>

        <template v-else>
          <el-divider content-position="left">{{ $t('tasks.editor.workflowConfig') }}</el-divider>

          <el-form-item :label="$t('tasks.fields.workflow')" required>
            <div class="flex gap-2 w-full">
              <el-select v-model="form.config.workflowId" class="flex-1" :placeholder="$t('tasks.fields.workflowPlaceholder')">
                <el-option
                  v-for="workflow in workflows"
                  :key="workflow.id"
                  :value="workflow.id"
                  :label="workflow.name"
                />
              </el-select>
              <el-button @click="emit('goto-workflows')">
                {{ $t('tasks.workflow.manage') }}
              </el-button>
            </div>
          </el-form-item>

          <div v-if="selectedWorkflow" class="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
            {{ selectedWorkflow.steps.length }} {{ $t('tasks.workflow.stepsCount') }}
            <span class="mx-1">·</span>
            {{ selectedWorkflow.steps.map(step => step.name || $t(`tasks.workflow.step.${step.type}`)).join(' → ') }}
          </div>
        </template>

        <!-- Notification -->
        <el-divider content-position="left">{{ $t('tasks.editor.options') }}</el-divider>

        <el-form-item>
          <el-switch v-model="form.notifyOnComplete" :label="$t('tasks.fields.notifyOnComplete')" />
          <span class="ml-2 text-xs text-gray-400">{{ $t('tasks.fields.notifyHint') }}</span>
        </el-form-item>
      </el-form>
    </el-scrollbar>

    <template #footer>
      <el-button @click="visibleModel = false">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">{{ $t('common.save') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { AUTOMATION_ACTIONS, CRON_PRESETS, TASK_TYPES, createDefaultConfig } from '../configs/index.js'
import ActionFields from './action-fields.vue'
import { formatDateTime } from '../hooks/use-tasks.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  task: { type: Object, default: null },
  workflows: { type: Array, default: () => [] },
  vendors: { type: Array, default: () => [] },
  devices: { type: Array, default: () => [] },
  defaultDeviceId: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'saved', 'goto-workflows'])

const { t } = useI18n()

const visibleModel = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value),
})

const isEditing = computed(() => Boolean(props.task?.id))

const saving = ref(false)

const form = ref({
  id: '',
  name: '',
  type: 'AI',
  cronExpr: '0 8 * * *',
  enabled: true,
  notifyOnComplete: true,
  config: createDefaultConfig('AI'),
})

const schedulePreset = ref('0 8 * * *')
const cronPreview = ref({ valid: true, next: [] })

const selectedWorkflow = computed(() => {
  return props.workflows.find(workflow => workflow.id === form.value.config.workflowId) || null
})

watch(() => props.visible, (value) => {
  if (!value)
    return

  const task = props.task

  if (task) {
    form.value = {
      ...task,
      config: JSON.parse(JSON.stringify(task.config || {})),
    }
  }
  else {
    form.value = {
      id: '',
      name: '',
      type: 'AI',
      cronExpr: '0 8 * * *',
      enabled: true,
      notifyOnComplete: true,
      config: createDefaultConfig('AI'),
    }

    if (props.defaultDeviceId)
      form.value.config.deviceId = props.defaultDeviceId
  }

  const preset = CRON_PRESETS.find(item => item.value === form.value.cronExpr)
  schedulePreset.value = preset?.value || 'custom'

  refreshCronPreview()
})

watch(() => form.value.cronExpr, () => refreshCronPreview())

function isDeviceUsable(device) {
  return device.status === 'device'
}

function handleTypeChange(type) {
  form.value.type = type
  form.value.config = createDefaultConfig(type)

  if (type !== 'AUTOMATION' && props.defaultDeviceId)
    form.value.config.deviceId = props.defaultDeviceId
}

function handlePresetChange(value) {
  if (value !== 'custom')
    form.value.cronExpr = value
}

function handleCronInput() {
  // preview refreshes via watcher
}

function handleActionChange() {
  // keep field values; executor reads only the fields of the active action
}

let previewToken = 0

async function refreshCronPreview() {
  const expr = String(form.value.cronExpr || '').trim()
  if (!expr) {
    cronPreview.value = { valid: false, next: [] }
    return
  }

  const token = ++previewToken

  try {
    const result = await window.$preload.ipcxRenderer.invoke('tasks:preview-cron', { expr })
    if (token === previewToken && result?.success)
      cronPreview.value = { valid: result.valid, next: result.next || [] }
  }
  catch {
    if (token === previewToken)
      cronPreview.value = { valid: false, next: [] }
  }
}

function buildVendorSnapshot() {
  if (form.value.type !== 'AI')
    return null

  const vendor = props.vendors.find(item => item.id === form.value.config.vendorId)
  return vendor ? { id: vendor.id, name: vendor.name, vision: vendor.vision } : null
}

async function handleSave() {
  const config = form.value.config || {}

  if (!String(form.value.name || '').trim())
    return ElMessage.warning(t('tasks.validation.name'))

  if (!form.value.cronExpr || !cronPreview.value.valid)
    return ElMessage.warning(t('tasks.cron.invalid'))

  if (form.value.type === 'AI' && !String(config.prompt || '').trim())
    return ElMessage.warning(t('tasks.validation.prompt'))

  if (form.value.type === 'WORKFLOW' && !config.workflowId)
    return ElMessage.warning(t('tasks.validation.workflow'))

  if (form.value.type === 'AUTOMATION' && config.action === 'http' && !/^https?:\/\//i.test(String(config.url || '')))
    return ElMessage.warning(t('tasks.validation.url'))

  const payload = {
    ...form.value,
    name: String(form.value.name).trim(),
  }

  if (form.value.type === 'AI')
    payload.config.vendorSnapshot = buildVendorSnapshot()

  saving.value = true

  try {
    const result = await window.$preload.ipcxRenderer.invoke('tasks:save', { task: payload })

    if (!result?.success)
      throw new Error(result?.error?.message || 'Save failed')

    emit('saved', result.task)
  }
  catch (error) {
    ElMessage.error(error?.message || 'Save failed')
  }
  finally {
    saving.value = false
  }
}
</script>
