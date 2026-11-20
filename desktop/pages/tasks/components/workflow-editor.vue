<template>
  <el-dialog
    v-model="visibleModel"
    :title="isEditing ? $t('tasks.workflow.editTitle') : $t('tasks.workflow.createTitle')"
    width="720px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-scrollbar max-height="62vh">
      <el-form label-position="top" class="pr-3">
        <el-form-item :label="$t('tasks.fields.name')" required>
          <el-input v-model="form.name" :placeholder="$t('tasks.workflow.namePlaceholder')" maxlength="60" show-word-limit />
        </el-form-item>

        <el-form-item :label="$t('tasks.workflow.description')">
          <el-input v-model="form.description" :placeholder="$t('tasks.workflow.descriptionPlaceholder')" maxlength="200" />
        </el-form-item>

        <el-form-item>
          <div class="w-full px-3 py-2 rounded-md bg-blue-500/5 border border-blue-500/20 text-xs text-blue-600 dark:text-blue-300">
            {{ $t('tasks.workflow.variableHint') }}:
            <code v-for="variable in VARIABLE_HINTS" :key="variable" class="mx-0.5 px-1 rounded bg-blue-500/10">{{ variable }}</code>
          </div>
        </el-form-item>

        <!-- Steps -->
        <el-form-item :label="$t('automation.steps')">
          <div class="w-full flex flex-col gap-2">
            <div
              v-for="(step, index) in form.steps"
              :key="step.id"
              class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div class="flex items-center gap-2 px-2.5 py-2 bg-gray-50 dark:bg-gray-800/60">
                <span class="flex-none w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-xs flex items-center justify-center font-medium">
                  {{ index + 1 }}
                </span>

                <el-input v-model="step.name" size="small" class="!w-44" :placeholder="$t('automation.step.name')" />

                <el-tag size="small" :type="stepTypeMeta(step.type).tag" class="!m-0">
                  <i :class="stepTypeMeta(step.type).icon" class="mr-0.5" />
                  {{ $t(`tasks.workflow.step.${step.type}`) }}
                </el-tag>

                <div class="flex-1" />

                <el-button size="small" text icon="Top" :disabled="index === 0" @click="moveStep(index, -1)" />
                <el-button size="small" text icon="Bottom" :disabled="index === form.steps.length - 1" @click="moveStep(index, 1)" />
                <el-button size="small" text type="danger" icon="Delete" @click="removeStep(index)" />
              </div>

              <div class="px-3 py-3">
                <!-- AI step -->
                <template v-if="step.type === 'ai'">
                  <div class="flex flex-col gap-2.5">
                    <div class="flex gap-2">
                      <el-select v-model="step.vendorId" size="small" class="!w-56" :placeholder="$t('tasks.fields.vendorPlaceholder')">
                        <el-option
                          v-for="vendor in vendors"
                          :key="vendor.id"
                          :value="vendor.id"
                          :label="`${vendor.name} · ${vendor.model || '...'}`"
                          :disabled="!vendor.configured"
                        />
                      </el-select>

                      <el-select v-if="step.includeScreenshot !== false" v-model="step.deviceId" size="small" class="!w-48" clearable :placeholder="$t('tasks.fields.devicePlaceholder')">
                        <el-option v-for="device in devices" :key="device.id" :value="device.id" :label="device.label" />
                      </el-select>
                    </div>

                    <el-input
                      v-model="step.prompt"
                      type="textarea"
                      :autosize="{ minRows: 3, maxRows: 8 }"
                      :placeholder="$t('tasks.fields.promptPlaceholder')"
                    />

                    <el-checkbox v-model="step.includeScreenshot" :label="$t('tasks.fields.includeScreenshot')" size="small" />
                  </div>
                </template>

                <!-- Action step -->
                <template v-else-if="step.type === 'action'">
                  <div class="flex flex-col gap-2.5">
                    <el-select v-model="step.action" size="small" class="!w-52" :placeholder="$t('tasks.fields.action')">
                      <el-option
                        v-for="action in AUTOMATION_ACTIONS"
                        :key="action.value"
                        :value="action.value"
                        :label="$t(action.label)"
                      />
                    </el-select>

                    <ActionFields :config="step" :devices="devices" />
                  </div>
                </template>

                <!-- Delay step -->
                <template v-else>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-500">{{ $t('automation.step.wait') }}</span>
                    <el-input-number v-model="step.seconds" :min="1" :max="300" size="small" controls-position="right" />
                    <span class="text-xs text-gray-500">s</span>
                  </div>
                </template>
              </div>
            </div>

            <div class="flex gap-2">
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
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <el-switch v-model="form.notifyOnComplete" :label="$t('tasks.fields.notifyOnComplete')" />
        </el-form-item>
      </el-form>
    </el-scrollbar>

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

const form = ref({
  id: '',
  name: '',
  description: '',
  notifyOnComplete: true,
  steps: [],
})

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
}

function removeStep(index) {
  form.value.steps.splice(index, 1)
}

function moveStep(index, direction) {
  const target = index + direction
  if (target < 0 || target >= form.value.steps.length)
    return

  const steps = form.value.steps
  ;[steps[index], steps[target]] = [steps[target], steps[index]]
}

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
