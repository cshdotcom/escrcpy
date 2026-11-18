<template>
  <el-drawer
    v-model="visible"
    :title="$t('copilot.config.title')"
    size="460px"
    :append-to-body="true"
  >
    <el-scrollbar class="h-full">
      <div class="flex flex-col gap-4 px-1 pb-8">
        <!-- Vendor selection -->
        <div class="flex items-center gap-2">
          <el-select
            v-model="activeVendorId"
            filterable
            :placeholder="$t('copilot.config.providerPlaceholder')"
            class="flex-1"
          >
            <el-option
              v-for="(vendor, id) in vendors"
              :key="id"
              :value="id"
              :label="vendor.name"
            />
          </el-select>

          <el-tooltip :content="$t('copilot.config.vendorAdd')" placement="top">
            <el-dropdown trigger="click" @command="handleAddVendor">
              <el-button icon="Plus" />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="preset in presets"
                    :key="preset.id"
                    :command="preset"
                  >
                    {{ preset.name }}
                  </el-dropdown-item>
                  <el-dropdown-item command="__custom__" divided>
                    {{ $t('copilot.config.vendorCustom') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </el-tooltip>

          <el-tooltip :content="$t('copilot.vendor.deleteConfirm')" placement="top">
            <el-button icon="Delete" :disabled="vendorCount <= 1" @click="handleDeleteVendor" />
          </el-tooltip>
        </div>

        <!-- Active vendor form -->
        <template v-if="activeVendor">
          <el-form label-position="top" size="small" @submit.prevent>
            <el-form-item :label="$t('copilot.config.vendorName')">
              <el-input v-model="activeVendor.name" @change="persist" />
            </el-form-item>

            <el-form-item :label="$t('copilot.config.apiType')">
              <el-select v-model="activeVendor.apiType" @change="persist">
                <el-option
                  v-for="item in apiTypeOptions"
                  :key="item.value"
                  :value="item.value"
                  :label="$t(item.label)"
                />
              </el-select>
            </el-form-item>

            <el-form-item :label="$t('copilot.config.baseUrl')" required>
              <el-input
                v-model="activeVendor.baseUrl"
                :placeholder="baseUrlPlaceholder"
                @change="persist"
              />
            </el-form-item>

            <el-form-item :label="$t('copilot.config.apiKey')">
              <el-input
                v-model="activeVendor.apiKey"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="$t('copilot.config.apiKeyPlaceholder')"
                @change="persist"
              />
            </el-form-item>

            <el-form-item :label="$t('copilot.config.model')" required>
              <div class="flex items-center gap-2 w-full">
                <el-select
                  v-model="activeVendor.model"
                  filterable
                  allow-create
                  default-first-option
                  :loading="modelsLoading"
                  :placeholder="$t('copilot.config.modelPlaceholder')"
                  class="flex-1"
                  @change="persist"
                >
                  <el-option
                    v-for="model in modelOptions"
                    :key="model"
                    :value="model"
                    :label="model"
                  />
                </el-select>

                <el-tooltip :content="$t('copilot.config.fetchModels')" placement="top">
                  <el-button icon="Refresh" :loading="modelsLoading" @click="handleFetchModels" />
                </el-tooltip>
              </div>
            </el-form-item>

            <div class="grid grid-cols-2 gap-3">
              <el-form-item :label="$t('copilot.config.temperature')">
                <el-slider
                  v-model="activeVendor.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  class="w-full"
                  @change="persist"
                />
              </el-form-item>

              <el-form-item :label="$t('copilot.config.maxOutputTokens')">
                <el-input-number
                  v-model="activeVendor.maxOutputTokens"
                  :min="256"
                  :max="131072"
                  :step="256"
                  class="!w-full"
                  @change="persist"
                />
              </el-form-item>
            </div>

            <el-form-item :label="$t('copilot.config.vision')">
              <div class="flex items-center gap-2 w-full">
                <el-switch v-model="activeVendor.vision" @change="persist" />
                <span class="text-xs text-gray-400">{{ $t('copilot.config.visionHint') }}</span>
              </div>
            </el-form-item>

            <el-form-item>
              <div class="flex items-center gap-2">
                <el-button :loading="testing" @click="handleTestConnection">
                  {{ $t('copilot.config.testConnection') }}
                </el-button>
                <span v-if="testResult" class="text-xs" :class="testResult.success ? 'text-green-600' : 'text-red-500'">
                  {{ testResult.message }}
                </span>
              </div>
            </el-form-item>
          </el-form>
        </template>

        <el-divider class="!my-2" />

        <!-- Behaviour settings -->
        <el-form label-position="top" size="small" @submit.prevent>
          <el-form-item :label="$t('copilot.config.maxSteps')">
            <div class="flex flex-col gap-1 w-full">
              <el-slider
                v-model="settings.maxSteps"
                :min="1"
                :max="100"
                :step="1"
                show-input
                :show-input-controls="false"
                class="!w-full"
                @change="persist"
              />
              <span class="text-xs text-gray-400">{{ $t('copilot.config.maxStepsHint') }}</span>
            </div>
          </el-form-item>

          <el-form-item :label="$t('copilot.config.systemPrompt')">
            <el-input
              v-model="settings.systemPrompt"
              type="textarea"
              :rows="5"
              :placeholder="$t('copilot.config.systemPromptPlaceholder')"
              @change="persist"
            />
          </el-form-item>

          <el-form-item :label="$t('copilot.config.requireConfirm')">
            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <el-switch v-model="settings.requireConfirm" @change="persist" />
                <span class="text-xs text-gray-400">{{ $t('copilot.config.requireConfirmHint') }}</span>
              </div>
              <div class="flex items-center gap-2">
                <el-switch v-model="settings.allowShell" @change="persist" />
                <span class="text-xs text-gray-400">{{ $t('copilot.config.allowShellHint') }}</span>
              </div>
              <div class="flex items-center gap-2">
                <el-switch v-model="settings.streaming" @change="persist" />
                <span class="text-xs text-gray-400">{{ $t('copilot.config.streamHint') }}</span>
              </div>
            </div>
          </el-form-item>
        </el-form>

        <el-divider class="!my-2" />

        <!-- Import / export -->
        <div class="flex items-center gap-2">
          <el-button size="small" @click="handleExport">
            <i class="i-solar-download-minimalistic-linear mr-1" />
            {{ $t('copilot.model.export') }}
          </el-button>

          <el-upload
            :show-file-list="false"
            :auto-upload="false"
            accept=".json"
            @change="handleImport"
          >
            <el-button size="small">
              <i class="i-solar-upload-minimalistic-linear mr-1" />
              {{ $t('copilot.model.import') }}
            </el-button>
          </el-upload>

          <span class="flex-1" />

          <el-button size="small" text type="danger" @click="handleReset">
            {{ $t('copilot.config.reset') }}
          </el-button>
        </div>
      </div>
    </el-scrollbar>
  </el-drawer>
</template>

<script setup>
import { API_TYPE_OPTIONS, DEFAULT_SYSTEM_PROMPT, VENDOR_PRESETS } from '../configs/index.js'

const props = defineProps({
  copilot: {
    type: Object,
    required: true,
  },
})

const visible = defineModel('visible', { type: Boolean, default: false })

const { t } = useI18n()

const copilot = props.copilot
const settings = copilot.settings

const presets = VENDOR_PRESETS
const apiTypeOptions = API_TYPE_OPTIONS

const activeVendorId = computed({
  get: () => settings.activeVendorId,
  set: (value) => {
    settings.activeVendorId = value
    persist()
  },
})

const vendors = computed(() => settings.vendors)
const activeVendor = computed(() => settings.vendors[settings.activeVendorId] || null)
const vendorCount = computed(() => Object.keys(settings.vendors).length)

const baseUrlPlaceholder = computed(() => {
  return activeVendor.value?.apiType === 'ollama'
    ? 'http://127.0.0.1:11434'
    : 'https://api.example.com/v1'
})

const modelsLoading = ref(false)
const modelOptions = ref([])
const testing = ref(false)
const testResult = ref(null)

watch(() => settings.activeVendorId, () => {
  modelOptions.value = []
  testResult.value = null
})

function persist() {
  copilot.persistSettings()
}

function handleAddVendor(preset) {
  if (preset === '__custom__') {
    copilot.addVendor({ name: t('copilot.config.vendorCustom'), apiType: 'openai', baseUrl: '', model: '' })
    return
  }
  copilot.addVendor(preset)
}

function handleDeleteVendor() {
  ElMessageBox.confirm(t('copilot.vendor.deleteConfirm'), 'Tips', { type: 'warning' })
    .then(() => copilot.deleteVendor(settings.activeVendorId))
    .catch(() => {})
}

async function handleFetchModels() {
  const vendor = activeVendor.value
  if (!vendor?.baseUrl) {
    ElMessage.warning(t('copilot.config.baseUrlRequired'))
    return
  }

  modelsLoading.value = true
  try {
    const result = await copilot.fetchModels({ ...vendor })
    if (result.success) {
      modelOptions.value = result.models || []
      ElMessage.success(t('copilot.config.modelsFetched', { count: String(result.models?.length || 0) }))
    }
    else {
      ElMessage.error(`${t('copilot.config.fetchModelsFailed')}: ${result.error?.message || ''}`)
    }
  }
  finally {
    modelsLoading.value = false
  }
}

async function handleTestConnection() {
  const vendor = activeVendor.value
  if (!vendor?.baseUrl || !vendor?.model) {
    testResult.value = { success: false, message: t('copilot.error.configIncomplete') }
    return
  }

  testing.value = true
  testResult.value = null
  try {
    const result = await copilot.testConnection({ ...vendor })
    if (result.success) {
      testResult.value = {
        success: true,
        message: `${t('copilot.check.api.success', { model: vendor.model })} (${result.latency}ms)`,
      }
    }
    else {
      const guidance = result.error?.code ? t(`copilot.error.guidance.${result.error.code}`) : ''
      testResult.value = {
        success: false,
        message: (guidance && !guidance.startsWith('copilot.')) ? guidance : `${t('copilot.check.api.failure', { message: result.error?.message || '' })}`,
      }
    }
  }
  finally {
    testing.value = false
  }
}

function handleExport() {
  const data = JSON.stringify({
    activeVendorId: settings.activeVendorId,
    vendors: settings.vendors,
    maxSteps: settings.maxSteps,
    systemPrompt: settings.systemPrompt,
  }, null, 2)

  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'escrcpy-copilot-config.json'
  link.click()
  URL.revokeObjectURL(url)
  ElMessage.success(t('copilot.model.exportSuccess'))
}

async function handleImport(file) {
  try {
    const text = await file.raw.text()
    const data = JSON.parse(text)
    const list = Array.isArray(data) ? data : (Array.isArray(data.vendors) ? data.vendors : Object.values(data.vendors || {}))

    const count = copilot.importVendors(list)
    if (data.systemPrompt)
      settings.systemPrompt = data.systemPrompt
    if (data.maxSteps)
      settings.maxSteps = data.maxSteps
    persist()

    if (count > 0) {
      ElMessage.success(t('copilot.model.importSuccess'))
    }
    else {
      ElMessage.warning(t('copilot.model.importFailed'))
    }
  }
  catch {
    ElMessage.error(t('copilot.model.importFailed'))
  }
}

function handleReset() {
  ElMessageBox.confirm(t('copilot.config.resetConfirm'), 'Tips', {
    type: 'warning',
  }).then(() => {
    Object.assign(settings, {
      maxSteps: 30,
      requireConfirm: true,
      streaming: true,
      allowShell: true,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    })
    persist()
  }).catch(() => {})
}
</script>
