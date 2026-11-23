<template>
  <el-config-provider :locale="locale" :size="size">
    <div class="flex flex-col h-screen">
      <AppHeader :title="headerTitle" :device-name="deviceName" class="px-2">
        <template #right>
          <div class="flex items-center gap-2 !*:ml-0 *:app-region-no-drag">
            <el-select
              v-model="currentDeviceId"
              size="small"
              class="!w-44"
              :placeholder="$t('copilot.device')"
              filterable
            >
              <el-option
                v-for="device in deviceOptions"
                :key="device.id"
                :value="device.id"
                :label="device.label"
                :disabled="!isDeviceUsable(device)"
              />
            </el-select>

            <el-tag v-if="activeVendor" size="small" type="info" class="!m-0 hidden md:inline-flex max-w-40">
              <span class="truncate">{{ activeVendor.name }} · {{ activeVendor.model || $t('copilot.model.unconfigured') }}</span>
            </el-tag>

            <el-tooltip :content="$t('copilot.config.title')" placement="bottom">
              <el-button circle text icon="Setting" @click="configVisible = true" />
            </el-tooltip>

            <el-switch v-model="isDark" class="el-switch--theme">
              <template #active-action>
                <i class="i-solar-moon-bold"></i>
              </template>
              <template #inactive-action>
                <i class="i-solar-sun-bold"></i>
              </template>
            </el-switch>
          </div>
        </template>
      </AppHeader>

      <div class="flex-1 min-h-0 flex gap-0 px-2 py-2">
        <!-- Sessions sidebar -->
        <div v-show="sidebarVisible" class="flex-none w-52 h-full">
          <SessionSidebar
            :sessions="sessions"
            :active-session-id="activeSessionId"
            @create="handleCreateSession"
            @select="activeSessionId = $event"
            @rename="handleRenameSession"
            @delete="handleDeleteSession"
            @clear-all="handleClearAllSessions"
          />
        </div>

        <!-- Chat area -->
        <div class="flex-1 min-w-0 h-full flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
          <el-scrollbar ref="scrollbarRef" class="flex-1">
            <div class="p-3 flex flex-col">
              <!-- Welcome -->
              <div v-if="!activeSession?.messages?.length && !isStreaming" class="flex-1 flex flex-col items-center justify-center py-10 gap-4">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-2xl shadow-lg shadow-blue-500/20">
                  <i class="i-solar-magic-stick-3-bold-duotone" />
                </div>

                <div class="text-center">
                  <div class="text-base font-semibold">
                    {{ $t('copilot.welcome.title') }}
                  </div>
                  <div class="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-md">
                    {{ $t('copilot.welcome.description') }}
                  </div>
                </div>

                <div class="flex flex-wrap gap-2 justify-center max-w-lg">
                  <el-button
                    v-for="preset in quickPresets"
                    :key="preset"
                    size="small"
                    round
                    plain
                    @click="handleSend(preset)"
                  >
                    {{ preset }}
                  </el-button>
                </div>

                <div class="text-xs text-gray-400 dark:text-gray-500">
                  {{ $t('copilot.welcome.hint') }}
                </div>
              </div>

              <!-- Messages -->
              <MessageList
                v-else
                :messages="activeSession?.messages || []"
                :streaming="isStreaming"
                :streaming-text="streamingText"
                :steps="streamingSteps"
                @delete="handleDeleteMessage"
              />

              <!-- Step limit notice -->
              <div
                v-if="stepLimitReached && !isStreaming" class="self-center mt-2 px-3 py-1.5 rounded-full text-xs
                bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300"
              >
                {{ $t('copilot.task.stepLimitReached', { current: streamingSteps, max: settings.maxSteps }) }}
              </div>

              <!-- Auto-reconnect notice -->
              <div
                v-if="isReconnecting" class="self-center mt-2 px-3 py-1.5 rounded-full text-xs
                bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 flex items-center gap-1.5"
              >
                <i class="i-solar-restart-circle-linear animate-spin" />
                {{ $t('copilot.reconnect.banner', { attempt: reconnectAttempt, max: reconnectMax }) }}
              </div>

              <!-- Error notice -->
              <div
                v-if="lastError && !isStreaming" class="self-start mt-2 px-3 py-1.5 rounded-md text-xs
                bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300 max-w-full break-all"
              >
                {{ lastError }}
              </div>
            </div>
          </el-scrollbar>

          <!-- Conversation function toolbar (对话内功能栏) -->
          <div class="flex-none flex items-center gap-2 flex-wrap px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/80">
            <el-select
              v-model="sessionDeviceIds"
              size="small"
              multiple
              collapse-tags
              collapse-tags-tooltip
              filterable
              class="!w-64"
              :placeholder="$t('copilot.toolbar.devices')"
              @change="handleSessionDevicesChange"
            >
              <el-option
                v-for="device in deviceOptions"
                :key="device.id"
                :value="device.id"
                :label="device.label"
                :disabled="!isDeviceUsable(device)"
              />
            </el-select>

            <el-tag v-if="sessionDeviceIds.length > 1" size="small" type="warning" class="!m-0">
              <i class="i-solar-devices-linear mr-1" />
              {{ $t('copilot.toolbar.groupMode', { count: sessionDeviceIds.length }) }}
            </el-tag>

            <span class="flex-1" />

            <el-tooltip :content="$t('copilot.toolbar.screenshot')" placement="top">
              <el-button size="small" text icon="Camera" :disabled="isStreaming" @click="handleQuickScreenshot" />
            </el-tooltip>

            <el-tooltip :content="$t('copilot.toolbar.groupControl')" placement="top">
              <el-button size="small" text @click="openGroupControl">
                <i class="i-solar-devices-bold" />
              </el-button>
            </el-tooltip>
          </div>

          <!-- Input area -->
          <div class="flex-none border-t border-gray-200 dark:border-gray-700 p-2.5 bg-gray-50/50 dark:bg-gray-900/50">
            <div class="flex items-end gap-2">
              <el-input
                v-model="inputText"
                type="textarea"
                :rows="1"
                :autosize="{ minRows: 1, maxRows: 6 }"
                resize="none"
                :placeholder="inputPlaceholder"
                :disabled="isStreaming"
                class="flex-1 copilot-input"
                @keydown.enter.exact.prevent="handleSend()"
              />

              <el-button
                v-if="isStreaming"
                type="danger"
                plain
                circle
                :title="$t('copilot.stop')"
                @click="handleStop"
              >
                <i class="i-solar-stop-circle-linear" />
              </el-button>

              <el-button
                v-else
                type="primary"
                circle
                icon="Promotion"
                :disabled="!canSend"
                :title="$t('copilot.send')"
                @click="handleSend()"
              />
            </div>

            <!-- Context usage indicator: shows how close the conversation is
                 to the compaction threshold, so users trust the auto-compact -->
            <div
              v-if="contextUsage > 0.4"
              class="mt-1.5 text-[10px] leading-none flex items-center gap-1"
              :class="contextUsage > 0.9 ? 'text-red-500' : 'text-gray-400 dark:text-gray-500'"
            >
              <i class="i-solar-database-linear text-[11px]" />
              <span>{{ $t('copilot.context.usage', { percent: Math.round(contextUsage * 100) }) }}</span>
              <span v-if="settings.autoCompact !== false">· {{ $t('copilot.context.autoCompactOn') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Config drawer -->
      <ConfigDrawer v-model:visible="configVisible" :copilot="copilot" />

      <!-- Tool confirm dialog -->
      <ToolConfirmDialog :pending="pendingConfirm" @resolve="copilot.resolveToolConfirm" />
    </div>
  </el-config-provider>
</template>

<script setup>
import AppHeader from '$/components/app-header/index.vue'
import MessageList from './components/message-list.vue'
import SessionSidebar from './components/session-sidebar.vue'
import ConfigDrawer from './components/config-drawer.vue'
import ToolConfirmDialog from './components/tool-confirm-dialog.vue'
import { useCopilot } from './hooks/use-copilot.js'

const { t } = useI18n()

const copilot = useCopilot()
const {
  settings,
  sessions,
  activeSessionId,
  activeSession,
  activeVendor,
  isConfigured,
  isStreaming,
  isReconnecting,
  reconnectAttempt,
  reconnectMax,
  streamingText,
  streamingSteps,
  stepLimitReached,
  lastError,
  pendingConfirm,
  contextUsage,
} = copilot

const deviceStore = useDeviceStore()

const configVisible = ref(false)
const sidebarVisible = ref(true)
const inputText = ref('')
const scrollbarRef = ref(null)

const currentDeviceId = ref('')
const deviceOptions = ref([])

const quickPresets = computed(() => {
  return [
    t('copilot.presets.screenshot'),
    t('copilot.presets.openSettings'),
    t('copilot.presets.battery'),
    t('copilot.presets.back'),
    t('copilot.presets.type'),
    t('copilot.presets.volume'),
  ]
})

const headerTitle = computed(() => {
  const title = window.$preload.payload?.title
  return title ? window.t(title) : t('copilot.welcome.title')
})

const inputPlaceholder = computed(() => {
  if (!isConfigured.value)
    return t('copilot.error.configIncomplete')
  return t('copilot.inputPlaceholder')
})

const canSend = computed(() => {
  return Boolean(inputText.value.trim() && !isStreaming.value && isConfigured.value && currentDeviceId.value)
})

const deviceName = computed(() => {
  const device = deviceOptions.value.find(item => item.id === currentDeviceId.value)
  return device?.label || ''
})

const { locale, size, themeStore } = useWindowStateSync({
  async onQueryMounted(query) {
    await refreshDevices()

    const payloadDevice = window.$preload.payload?.device?.id || query.device?.id
    // Group control opens this window with a multi-device payload (群控 AI):
    // seed the conversation with the whole device set.
    const payloadDeviceIds = Array.isArray(window.$preload.payload?.deviceIds)
      ? window.$preload.payload.deviceIds.filter(Boolean)
      : []
    currentDeviceId.value = payloadDeviceIds[0] || payloadDevice || deviceOptions.value.find(d => isDeviceUsable(d))?.id || deviceOptions.value[0]?.id || ''

    if (!activeSession.value) {
      copilot.createSession(currentDeviceId.value)
      if (payloadDeviceIds.length > 1)
        copilot.updateSessionDevices(activeSession.value?.id || '', payloadDeviceIds)
    }
  },
})

const isDark = computed({
  get: () => themeStore.isDark,
  set: (value) => {
    themeStore.isDark = value
    themeStore.updateHtml(value ? 'dark' : 'light')
  },
})

watch(currentDeviceId, (value) => {
  if (activeSession.value && !activeSession.value.messages.length)
    activeSession.value.deviceId = value
})

async function refreshDevices() {
  await deviceStore.getList()
  const devices = toRaw(deviceStore.list) || []
  deviceOptions.value = devices.map(device => ({
    id: device.id,
    label: deviceStore.getLabel(device.id, 'name'),
    status: device.status,
  }))
}

function isDeviceUsable(device) {
  return device.status === 'device'
}

function scrollToBottom() {
  nextTick(() => {
    const wrap = scrollbarRef.value?.wrapRef
    if (wrap)
      wrap.scrollTop = wrap.scrollHeight
  })
}

watch(() => activeSession.value?.messages?.length, () => scrollToBottom())
watch(streamingText, () => scrollToBottom())
watch(activeSessionId, () => scrollToBottom())

async function handleSend(preset) {
  const text = (preset || inputText.value || '').trim()
  if (!text || isStreaming.value)
    return

  if (!currentDeviceId.value) {
    ElMessage.warning(t('copilot.noDevice'))
    return
  }

  if (!isConfigured.value) {
    configVisible.value = true
    ElMessage.warning(t('copilot.error.configIncomplete'))
    return
  }

  if (!activeSession.value)
    copilot.createSession(currentDeviceId.value)

  inputText.value = ''
  scrollToBottom()
  const deviceArg = sessionDeviceIds.value.length ? [...sessionDeviceIds.value] : currentDeviceId.value
  await copilot.send(text, deviceArg)
}

// ── conversation function toolbar (对话内功能栏) ────
const sessionDeviceIds = computed({
  get() {
    const ids = activeSession.value?.deviceIds
    if (Array.isArray(ids) && ids.length)
      return ids
    return activeSession.value?.deviceId ? [activeSession.value.deviceId] : []
  },
  set(value) {
    if (activeSession.value)
      copilot.updateSessionDevices(activeSession.value.id, value)
  },
})

function handleSessionDevicesChange(value) {
  sessionDeviceIds.value = value
  if (!value.length)
    ElMessage.warning(t('copilot.toolbar.needDevice'))
}

async function handleQuickScreenshot() {
  const target = sessionDeviceIds.value[0] || currentDeviceId.value
  if (!target)
    return
  try {
    await window.$preload.adb.screencap(target, { returnBase64: false })
    ElMessage.success(t('copilot.toolbar.screenshotDone'))
  }
  catch (error) {
    ElMessage.error(error?.message ?? 'screenshot failed')
  }
}

function openGroupControl() {
  window.$preload.win.open('pages/group-control', {
    title: 'groupControl.title',
    type: 'group',
  })
}

async function handleStop() {
  await copilot.stopStreaming()
}

function handleCreateSession() {
  copilot.createSession(currentDeviceId.value)
}

function handleRenameSession(session) {
  ElMessageBox.prompt(t('copilot.session.renamePlaceholder'), t('copilot.session.rename'), {
    inputValue: session.name || '',
  }).then(({ value }) => {
    if (value?.trim())
      copilot.renameSession(session.id, value.trim())
  }).catch(() => {})
}

function handleDeleteSession(id) {
  ElMessageBox.confirm(t('copilot.session.deleteConfirm'), 'Tips', { type: 'warning' })
    .then(() => copilot.deleteSession(id))
    .catch(() => {})
}

function handleClearAllSessions() {
  ElMessageBox.confirm(t('copilot.session.clearAllConfirm'), 'Tips', { type: 'warning' })
    .then(() => copilot.clearAllSessions())
    .catch(() => {})
}

function handleDeleteMessage(messageId) {
  if (!activeSession.value)
    return
  ElMessageBox.confirm(t('copilot.chat.deleteMessageConfirm'), 'Tips', { type: 'warning' })
    .then(() => copilot.deleteMessage(activeSession.value.id, messageId))
    .catch(() => {})
}
</script>

<style lang="postcss" scoped>
:deep(.copilot-input) {
  .el-textarea__inner {
    @apply !rounded-lg !px-3 !py-2 text-sm;
  }
}
</style>
