<template>
  <div class="h-full flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
    <!-- Header -->
    <div class="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <i class="i-solar-devices-bold-duotone text-xl text-primary-500" />
      <span class="font-semibold">{{ $t('groupControl.title') }}</span>
      <span class="text-xs text-gray-400">{{ $t('groupControl.subtitle') }}</span>
      <span class="flex-1" />
      <el-button size="small" icon="Refresh" :loading="loadingDevices" @click="refreshDevices">
        {{ $t('common.refresh') }}
      </el-button>
      <el-button size="small" type="primary" :disabled="!selectedDevices.length" @click="openGroupCopilot">
        <i class="i-solar-chat-square-line-linear mr-1" />
        {{ $t('groupControl.openGroupCopilot') }}
      </el-button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- Device picker -->
      <div class="w-72 flex-none border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div class="flex items-center justify-between px-3 py-2 text-xs text-gray-500">
          <span>{{ $t('groupControl.devices') }}</span>
          <el-checkbox v-model="selectAll" size="small" @change="toggleAll">
            {{ $t('groupControl.selectAll') }}
          </el-checkbox>
        </div>
        <el-scrollbar class="flex-1 px-2">
          <div
            v-for="device in devices"
            :key="device.id"
            class="flex items-center gap-2 px-2.5 py-2 mb-1.5 rounded-lg border cursor-pointer transition-colors"
            :class="isSelected(device.id) ? selectedClass : idleClass"
            @click="toggleDevice(device.id)"
          >
            <el-checkbox :model-value="isSelected(device.id)" size="small" @change="() => toggleDevice(device.id)" @click.stop />
            <i class="i-solar-smartphone-linear text-lg" :class="device.status === 'device' ? 'text-green-500' : 'text-gray-300'" />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium truncate">{{ device.id }}</div>
            </div>
            <el-tag size="small" :type="device.status === 'device' ? 'success' : 'info'" class="!m-0">
              {{ device.status === 'device' ? $t('groupControl.online') : device.status }}
            </el-tag>
          </div>
          <div v-if="!devices.length && !loadingDevices" class="py-10 text-center text-xs text-gray-400">
            {{ $t('groupControl.noDevices') }}
          </div>
        </el-scrollbar>
      </div>

      <!-- Control panel -->
      <div class="flex-1 min-w-0 flex flex-col">
        <el-tabs v-model="activeTab" class="flex-1 flex flex-col group-control-tabs">
          <el-tab-pane :label="$t('groupControl.tabBroadcast')" name="broadcast">
            <div class="px-4 py-3 flex flex-col gap-4">
              <el-alert type="info" :closable="false" show-icon>
                <template #title>{{ $t('groupControl.broadcastHint', { count: selectedDevices.length }) }}</template>
              </el-alert>

              <div class="grid grid-cols-2 gap-3">
                <el-card shadow="never" class="!border">
                  <template #header><span class="text-sm font-medium">{{ $t('groupControl.tapCard') }}</span></template>
                  <div class="flex items-center gap-2">
                    <el-input-number v-model="tap.x" :min="0" :max="4000" size="small" :placeholder="$t('groupControl.x')" />
                    <el-input-number v-model="tap.y" :min="0" :max="4000" size="small" :placeholder="$t('groupControl.y')" />
                    <el-button size="small" type="primary" :disabled="!ready" @click="broadcast('tap')">
                      {{ $t('groupControl.send') }}
                    </el-button>
                  </div>
                </el-card>

                <el-card shadow="never" class="!border">
                  <template #header><span class="text-sm font-medium">{{ $t('groupControl.textCard') }}</span></template>
                  <div class="flex items-center gap-2">
                    <el-input v-model="text.value" size="small" :placeholder="$t('groupControl.textPlaceholder')" />
                    <el-button size="small" type="primary" :disabled="!ready" @click="broadcast('input_text')">
                      {{ $t('groupControl.send') }}
                    </el-button>
                  </div>
                </el-card>

                <el-card shadow="never" class="!border">
                  <template #header><span class="text-sm font-medium">{{ $t('groupControl.keyCard') }}</span></template>
                  <div class="flex flex-wrap gap-1.5">
                    <el-button v-for="key in quickKeys" :key="key" size="small" :disabled="!ready" @click="broadcastKey(key)">
                      {{ key }}
                    </el-button>
                  </div>
                </el-card>

                <el-card shadow="never" class="!border">
                  <template #header><span class="text-sm font-medium">{{ $t('groupControl.swipeCard') }}</span></template>
                  <div class="flex items-center gap-2 flex-wrap">
                    <el-input-number v-model="swipe.x1" :min="0" size="small" placeholder="x1" />
                    <el-input-number v-model="swipe.y1" :min="0" size="small" placeholder="y1" />
                    <el-input-number v-model="swipe.x2" :min="0" size="small" placeholder="x2" />
                    <el-input-number v-model="swipe.y2" :min="0" size="small" placeholder="y2" />
                    <el-button size="small" type="primary" :disabled="!ready" @click="broadcast('swipe')">
                      {{ $t('groupControl.send') }}
                    </el-button>
                  </div>
                </el-card>
              </div>

              <div class="flex items-center gap-2">
                <el-button size="small" :disabled="!ready" :loading="batchBusy" @click="screenshotAll">
                  <i class="i-solar-camera-minimalistic-linear mr-1" />
                  {{ $t('groupControl.screenshotAll') }}
                </el-button>
                <el-button size="small" :disabled="!ready" :loading="batchBusy" @click="installApk">
                  <i class="i-solar-download-square-linear mr-1" />
                  {{ $t('groupControl.installApk') }}
                </el-button>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane :label="$t('groupControl.tabLog')" name="log">
            <el-scrollbar class="px-4 py-2 log-pane">
              <div v-for="(entry, index) in logEntries" :key="index" class="text-xs font-mono py-0.5 border-b border-dashed border-gray-100 dark:border-gray-800 whitespace-pre-wrap">
                <span class="text-gray-400 mr-2">{{ formatTime(entry.time) }}</span>
                <span :class="entry.level === 'error' ? 'text-red-500' : entry.level === 'ok' ? 'text-green-600' : 'text-gray-600 dark:text-gray-300'">
                  {{ entry.text }}
                </span>
              </div>
              <div v-if="!logEntries.length" class="py-10 text-center text-xs text-gray-400">
                {{ $t('groupControl.logEmpty') }}
              </div>
            </el-scrollbar>
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>
  </div>
</template>

<script setup>
const { t } = useI18n()

const devices = ref([])
const selectedDevices = ref([])
const loadingDevices = ref(false)
const batchBusy = ref(false)
const activeTab = ref('broadcast')
const logEntries = ref([])
const selectAll = ref(false)

const tap = reactive({ x: 540, y: 1200 })
const text = reactive({ value: '' })
const swipe = reactive({ x1: 540, y1: 1500, x2: 540, y2: 500 })
const quickKeys = ['home', 'back', 'menu', 'enter', 'del', 'app_switch', 'notification', 'volume_up', 'volume_down']

const selectedClass = 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
const idleClass = 'border-gray-200 dark:border-gray-700 hover:border-primary-300'

const ready = computed(() => selectedDevices.value.length > 0 && !batchBusy.value)

function isSelected(id) {
  return selectedDevices.value.includes(id)
}

function toggleDevice(id) {
  const index = selectedDevices.value.indexOf(id)
  if (index === -1)
    selectedDevices.value.push(id)
  else
    selectedDevices.value.splice(index, 1)
}

function toggleAll(value) {
  selectedDevices.value = value ? devices.value.map(d => d.id) : []
}

async function refreshDevices() {
  loadingDevices.value = true
  try {
    const result = await window.$preload.ipcxRenderer.invoke('group:devices')
    devices.value = result?.devices || []
    selectedDevices.value = selectedDevices.value.filter(id => devices.value.some(d => d.id === id))
  }
  catch (error) {
    log('error', `${t('groupControl.refreshFailed')}: ${error?.message ?? error}`)
  }
  finally {
    loadingDevices.value = false
  }
}

function log(level, text) {
  logEntries.value.unshift({ time: Date.now(), level, text })
  if (logEntries.value.length > 300)
    logEntries.value.length = 300
}

function formatTime(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function broadcast(action) {
  const payload = {
    deviceIds: [...selectedDevices.value],
    action: { action },
  }

  if (action === 'tap' || action === 'swipe')
    Object.assign(payload.action, swipePayloadFor(action))
  if (action === 'input_text')
    payload.action.text = text.value

  batchBusy.value = true
  activeTab.value = 'log'
  log('info', `→ ${action} × ${payload.deviceIds.length} ${t('groupControl.devices')}`)
  try {
    const result = await window.$preload.ipcxRenderer.invoke('group:broadcast', payload)
    if (result?.success) {
      log('ok', `✓ ${action}: ${result.output}`)
    }
    else {
      log('error', `✗ ${action}: ${result?.error?.message || 'failed'}`)
    }
  }
  catch (error) {
    log('error', `✗ ${action}: ${error?.message ?? error}`)
  }
  finally {
    batchBusy.value = false
  }
}

function swipePayloadFor(action) {
  if (action === 'tap')
    return { x: tap.x, y: tap.y }
  return { x1: swipe.x1, y1: swipe.y1, x2: swipe.x2, y2: swipe.y2, duration: 300 }
}

function broadcastKey(key) {
  const payload = { deviceIds: [...selectedDevices.value], action: { action: 'key', key } }
  batchBusy.value = true
  window.$preload.ipcxRenderer.invoke('group:broadcast', payload)
    .then(result => log(result?.success ? 'ok' : 'error', `${key}: ${result?.success ? '✓' : result?.error?.message}`))
    .catch(error => log('error', `${key}: ${error?.message ?? error}`))
    .finally(() => { batchBusy.value = false })
}

async function screenshotAll() {
  batchBusy.value = true
  activeTab.value = 'log'
  try {
    const result = await window.$preload.ipcxRenderer.invoke('group:screenshot-all', { deviceIds: [...selectedDevices.value] })
    if (result?.success) {
      for (const file of result.files || [])
        log('ok', `📸 ${file}`)
    }
    else {
      log('error', result?.error?.message || 'screenshot failed')
    }
  }
  catch (error) {
    log('error', error?.message ?? error)
  }
  finally {
    batchBusy.value = false
  }
}

async function installApk() {
  try {
    const result = await window.$preload.ipcxRenderer.invoke('group:pick-apk')
    const filePath = result?.filePath
    if (!filePath)
      return

    batchBusy.value = true
    activeTab.value = 'log'
    log('info', `→ APK ${filePath}`)
    const installResult = await window.$preload.ipcxRenderer.invoke('group:install-apk', { deviceIds: [...selectedDevices.value], filePath })
    for (const entry of installResult?.results || [])
      log(entry.success ? 'ok' : 'error', `[${entry.deviceId}] ${entry.success ? '✓ installed' : entry.error}`)
  }
  catch (error) {
    log('error', error?.message ?? error)
  }
  finally {
    batchBusy.value = false
  }
}

function openGroupCopilot() {
  window.$preload.win.open('pages/copilot', {
    title: 'copilot.welcome.title',
    type: 'group',
    deviceIds: [...selectedDevices.value],
    instanceId: `group:${selectedDevices.value.slice().sort().join(',')}`,
  })
}

onMounted(refreshDevices)
</script>

<style scoped>
:deep(.group-control-tabs > .el-tabs__header) {
  margin: 0;
  padding: 0 1rem;
}

:deep(.group-control-tabs > .el-tabs__content) {
  height: calc(100vh - 100px);
  overflow: hidden;
}

:deep(.group-control-tabs .el-tab-pane) {
  height: 100%;
  overflow: auto;
}

.log-pane {
  height: 100%;
}
</style>
