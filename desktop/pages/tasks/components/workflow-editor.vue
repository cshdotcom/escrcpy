<template>
  <el-dialog
    v-model="visibleModel"
    :title="isEditing ? $t('tasks.workflow.editTitle') : $t('tasks.workflow.createTitle')"
    width="min(1180px, 96vw)"
    top="3vh"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <div class="flex gap-3 h-[66vh]">
      <!-- canvas column -->
      <div class="flex-1 min-w-0 flex flex-col gap-2">
        <div class="flex-none flex items-center gap-2">
          <el-input
            v-model="form.name"
            :placeholder="$t('tasks.workflow.namePlaceholder')"
            maxlength="60"
            show-word-limit
            class="flex-1"
          />
          <el-switch v-model="form.notifyOnComplete" :label="$t('tasks.fields.notifyOnComplete')" />
        </div>

        <div class="flex-1 min-h-0">
          <WorkflowCanvas
            :steps="form.steps"
            :selected-id="selectedId"
            @select="selectedId = $event"
            @update-layout="applyLayout"
            @reorder="handleReorder"
          />
        </div>

        <div class="flex-none flex items-center gap-2 flex-wrap">
          <span class="text-xs text-gray-400">{{ $t('tasks.workflow.canvas.addStep') }}</span>
          <el-button
            v-for="type in WORKFLOW_STEP_TYPES"
            :key="type.value"
            size="small"
            plain
            @click="addStep(type.value)"
          >
            <i :class="type.icon" class="mr-1" />
            {{ $t(type.label) }}
          </el-button>

          <span class="flex-1" />

          <span class="text-[11px] text-gray-400">
            {{ $t('tasks.workflow.variableHint') }}:
            <code v-for="variable in VARIABLE_HINTS" :key="variable" class="mx-0.5 px-1 rounded bg-blue-500/10">{{ variable }}</code>
          </span>
        </div>
      </div>

      <!-- inspector -->
      <div class="w-[340px] flex-none flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 overflow-hidden">
        <div class="flex-none px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <span class="text-xs font-semibold">{{ $t('tasks.workflow.canvas.inspector') }}</span>
          <el-tag v-if="selectedStep" size="small" :type="stepTypeMeta(selectedStep.type).tag" class="!m-0">
            {{ $t(`tasks.workflow.step.${selectedStep.type}`) }}
          </el-tag>
          <span class="flex-1" />
          <template v-if="selectedStep">
            <el-button size="small" text icon="Top" :disabled="selectedIndex <= 0" @click="moveStep(selectedIndex, -1)" />
            <el-button size="small" text icon="Bottom" :disabled="selectedIndex < 0 || selectedIndex >= form.steps.length - 1" @click="moveStep(selectedIndex, 1)" />
            <el-button size="small" text icon="CopyDocument" @click="duplicateStep" />
            <el-button size="small" text icon="Delete" type="danger" @click="removeStep(selectedIndex)" />
          </template>
        </div>

        <el-scrollbar class="flex-1">
          <div v-if="selectedStep" class="p-3 flex flex-col gap-3">
            <el-input v-model="selectedStep.name" size="small" :placeholder="$t('automation.step.name')" />

            <!-- AI step -->
            <template v-if="selectedStep.type === 'ai'">
              <el-select v-model="selectedStep.vendorId" size="small" :placeholder="$t('tasks.fields.vendorPlaceholder')">
                <el-option
                  v-for="vendor in vendors"
                  :key="vendor.id"
                  :value="vendor.id"
                  :label="`${vendor.name} · ${vendor.model || '...'}`"
                  :disabled="!vendor.configured"
                />
              </el-select>

              <el-input
                v-model="selectedStep.prompt"
                type="textarea"
                :autosize="{ minRows: 5, maxRows: 12 }"
                :placeholder="$t('tasks.fields.promptPlaceholder')"
              />

              <div class="flex items-center gap-2">
                <el-checkbox v-model="selectedStep.includeScreenshot" :label="$t('tasks.fields.includeScreenshot')" size="small" />
                <el-select
                  v-if="selectedStep.includeScreenshot !== false"
                  v-model="selectedStep.deviceId"
                  size="small"
                  class="flex-1"
                  clearable
                  :placeholder="$t('tasks.fields.devicePlaceholder')"
                >
                  <el-option v-for="device in devices" :key="device.id" :value="device.id" :label="device.label" />
                </el-select>
              </div>
            </template>

            <!-- Action step -->
            <template v-else-if="selectedStep.type === 'action'">
              <el-select v-model="selectedStep.action" size="small" :placeholder="$t('tasks.fields.action')">
                <el-option
                  v-for="action in AUTOMATION_ACTIONS"
                  :key="action.value"
                  :value="action.value"
                  :label="$t(action.label)"
                />
              </el-select>
              <ActionFields :config="selectedStep" :devices="devices" />
            </template>

            <!-- Delay step -->
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-500">{{ $t('automation.step.wait') }}</span>
                <el-input-number v-model="selectedStep.seconds" :min="1" :max="300" size="small" controls-position="right" />
                <span class="text-xs text-gray-500">s</span>
              </div>
            </template>
          </div>

          <div v-else class="p-3 flex flex-col gap-3">
            <el-input
              v-model="form.description"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 6 }"
              :placeholder="$t('tasks.workflow.descriptionPlaceholder')"
              maxlength="200"
            />
            <div class="text-[11px] leading-5 text-gray-400">
              {{ $t('tasks.workflow.canvas.hint') }}
            </div>
          </div>
        </el-scrollbar>
      </div>
    </div>

    <template #footer>
      <el-button @click="visibleModel = false">
        {{ $t('common.cancel') }}
      </el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">
        {{ $t('common.save') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { AUTOMATION_ACTIONS, createDefaultStep, VARIABLE_HINTS, WORKFLOW_STEP_TYPES } from '../configs/index.js'
import ActionFields from './action-fields.vue'
import WorkflowCanvas from './workflow-canvas.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  workflow: { type: Object, default: null },
  vendors: { type: Array, default: () => [] },
  devices: { type: Array, default: () => [] },
  defaultDeviceId: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()

const visibleModel = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value),
})

const isEditing = computed(() => Boolean(props.workflow?.id))

const saving = ref(false)
const selectedId = ref(null)

const form = ref({
  id: '',
  name: '',
  description: '',
  notifyOnComplete: true,
  steps: [],
})

const selectedIndex = computed(() => form.value.steps.findIndex(step => step.id === selectedId.value))
const selectedStep = computed(() => form.value.steps[selectedIndex.value] || null)

watch(() => props.visible, (value) => {
  if (!value)
    return

  if (props.workflow) {
    form.value = {
      ...props.workflow,
      steps: JSON.parse(JSON.stringify(props.workflow.steps || [])),
    }
  }
  else {
    form.value = {
      id: '',
      name: '',
      description: '',
      notifyOnComplete: true,
      steps: [],
    }
  }
  selectedId.value = form.value.steps[0]?.id || null
})

function stepTypeMeta(type) {
  const hit = WORKFLOW_STEP_TYPES.find(item => item.value === type)
  const tagMap = { ai: 'primary', action: 'warning', delay: 'info' }
  return { icon: hit?.icon || '', tag: tagMap[type] || 'info' }
}

function addStep(type) {
  const step = createDefaultStep(type)

  if (props.defaultDeviceId && type !== 'delay')
    step.deviceId = props.defaultDeviceId

  if (type === 'ai' && props.vendors.length) {
    const configured = props.vendors.find(vendor => vendor.configured)
    if (configured)
      step.vendorId = configured.id
  }

  form.value.steps.push(step)
  selectedId.value = step.id
}

function removeStep(index) {
  if (index < 0 || index >= form.value.steps.length)
    return
  form.value.steps.splice(index, 1)
  selectedId.value = form.value.steps[Math.min(index, form.value.steps.length - 1)]?.id || null
}

function duplicateStep() {
  if (!selectedStep.value)
    return
  const copy = JSON.parse(JSON.stringify(selectedStep.value))
  copy.id = `${copy.type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  copy.name = `${copy.name || copy.type} copy`
  copy.layout = copy.layout ? { x: copy.layout.x + 40, y: copy.layout.y + 60 } : undefined
  form.value.steps.splice(selectedIndex.value + 1, 0, copy)
  selectedId.value = copy.id
}

function moveStep(index, direction) {
  const target = index + direction
  if (index < 0 || target < 0 || target >= form.value.steps.length)
    return

  const steps = form.value.steps
  ;[steps[index], steps[target]] = [steps[target], steps[index]]
}

/** Canvas drop: `to` is a step id, '__start' (insert first) or '__end'. */
function handleReorder({ from, to }) {
  if (from < 0 || from >= form.value.steps.length)
    return

  const steps = form.value.steps
  const [moved] = steps.splice(from, 1)
  let target = steps.length

  if (to === '__start')
    target = 0
  else if (to !== '__end')
    target = steps.findIndex(step => step.id === to)

  if (target < 0)
    target = steps.length

  steps.splice(target, 0, moved)
  selectedId.value = moved.id
}

function applyLayout(payload) {
  if (payload?.batch) {
    for (const item of payload.batch) {
      const step = form.value.steps.find(entry => entry.id === item.id)
      if (step)
        step.layout = item.layout
    }
    return
  }
  const step = form.value.steps.find(entry => entry.id === payload?.id)
  if (step)
    step.layout = payload.layout
}

function onKeyDown(event) {
  if (!props.visible)
    return
  const target = event.target
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    return

  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyD') {
    if (selectedStep.value) {
      event.preventDefault()
      duplicateStep()
    }
    return
  }

  if (event.code === 'Delete' || event.code === 'Backspace') {
    if (selectedStep.value) {
      event.preventDefault()
      removeStep(selectedIndex.value)
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

async function handleSave() {
  if (!String(form.value.name || '').trim())
    return ElMessage.warning(t('tasks.validation.name'))

  if (!form.value.steps.length)
    return ElMessage.warning(t('tasks.validation.steps'))

  for (const step of form.value.steps) {
    if (step.type === 'ai' && !String(step.prompt || '').trim())
      return ElMessage.warning(t('tasks.validation.stepPrompt', { name: step.name || t('tasks.workflow.step.ai') }))
  }

  // Deep-clone through JSON before the IPC hop — see the note in task-editor:
  // nested Vue reactive proxies cannot cross ipcRenderer.invoke (structured
  // clone), which used to break saving workflows from this dialog.
  const payload = JSON.parse(JSON.stringify({
    ...form.value,
    name: String(form.value.name).trim(),
    steps: form.value.steps.map((step) => {
      const snapshot = { ...step }

      if (step.type === 'ai') {
        const vendor = props.vendors.find(item => item.id === step.vendorId)
        snapshot.vendorSnapshot = vendor ? { id: vendor.id, name: vendor.name, vision: vendor.vision } : null
      }

      return snapshot
    }),
  }))

  saving.value = true

  try {
    const result = await window.$preload.ipcxRenderer.invoke('workflows:save', { workflow: payload })

    if (!result?.success)
      throw new Error(result?.error?.message || 'Save failed')

    emit('saved', result.workflow)
  }
  catch (error) {
    ElMessage.error(error?.message || 'Save failed')
  }
  finally {
    saving.value = false
  }
}
</script>
