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
              :placeholder="$t('tasks.device')"
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

            <el-tooltip :content="$t('tasks.refresh')" placement="bottom">
              <el-button circle text icon="Refresh" :loading="loading" @click="handleRefresh" />
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

      <div class="flex-1 min-h-0 flex flex-col px-2 pb-2 gap-2">
        <el-tabs v-model="activeTab" class="tasks-tabs flex-1 min-h-0 flex flex-col">
          <el-tab-pane name="tasks">
            <template #label>
              <span class="flex items-center gap-1">
                <i class="i-solar-alarm-linear" />
                {{ $t('tasks.tab.tasks') }}
              </span>
            </template>

            <TaskList
              :tasks="tasks"
              :workflows="workflows"
              :devices="deviceOptions"
              :vendors="vendors"
              class="h-full"
              @create="handleCreateTask"
              @edit="handleEditTask"
              @run="handleRunTask"
              @toggle="handleToggleTask"
              @delete="handleDeleteTask"
              @goto-workflows="activeTab = 'workflows'"
            />
          </el-tab-pane>

          <el-tab-pane name="workflows">
            <template #label>
              <span class="flex items-center gap-1">
                <i class="i-solar-route-linear" />
                {{ $t('tasks.tab.workflows') }}
              </span>
            </template>

            <WorkflowList
              :workflows="workflows"
              :vendors="vendors"
              :devices="deviceOptions"
              class="h-full"
              @create="handleCreateWorkflow"
              @edit="handleEditWorkflow"
              @run="handleRunWorkflow"
              @delete="handleDeleteWorkflow"
            />
          </el-tab-pane>

          <el-tab-pane name="history">
            <template #label>
              <span class="flex items-center gap-1">
                <i class="i-solar-history-linear" />
                {{ $t('tasks.tab.history') }}
              </span>
            </template>

            <RunHistory
              :runs="runs"
              class="h-full"
              @refresh="tasksApi.refreshRuns({ limit: 100 })"
              @clear="handleClearRuns"
            />
          </el-tab-pane>
        </el-tabs>
      </div>

      <!-- Task editor -->
      <TaskEditor
        v-model:visible="taskEditorVisible"
        :task="editingTask"
        :workflows="workflows"
        :vendors="vendors"
        :devices="deviceOptions"
        :default-device-id="currentDeviceId"
        :default-vendor-id="activeVendorId"
        @saved="handleTaskSaved"
        @goto-workflows="activeTab = 'workflows'"
      />

      <!-- Workflow editor -->
      <WorkflowEditor
        v-model:visible="workflowEditorVisible"
        :workflow="editingWorkflow"
        :vendors="vendors"
        :devices="deviceOptions"
        :default-device-id="currentDeviceId"
        @saved="handleWorkflowSaved"
      />
    </div>
  </el-config-provider>
</template>

<script setup>
import AppHeader from '$/components/app-header/index.vue'
import TaskList from './components/task-list.vue'
import TaskEditor from './components/task-editor.vue'
import WorkflowList from './components/workflow-list.vue'
import WorkflowEditor from './components/workflow-editor.vue'
import RunHistory from './components/run-history.vue'
import { useTasks } from './hooks/use-tasks.js'

const { t } = useI18n()

const tasksApi = useTasks()
const {
  tasks,
  workflows,
  runs,
  vendors,
  activeVendorId,
  loading,
} = tasksApi

const deviceStore = useDeviceStore()

const activeTab = ref('tasks')
const deviceOptions = ref([])
const currentDeviceId = ref('')

const taskEditorVisible = ref(false)
const editingTask = ref(null)
const workflowEditorVisible = ref(false)
const editingWorkflow = ref(null)

const headerTitle = computed(() => {
  const title = window.$preload.payload?.title
  return title ? window.t(title) : t('tasks.name')
})

const deviceName = computed(() => {
  const device = deviceOptions.value.find(item => item.id === currentDeviceId.value)
  return device?.label || ''
})

const { locale, size, themeStore } = useWindowStateSync({
  async onQueryMounted() {
    await refreshDevices()

    const payloadDevice = window.$preload.payload?.device?.id
    currentDeviceId.value = payloadDevice || deviceOptions.value.find(d => isDeviceUsable(d))?.id || deviceOptions.value[0]?.id || ''
  },
})

const isDark = computed({
  get: () => themeStore.isDark,
  set: (value) => {
    themeStore.isDark = value
    themeStore.updateHtml(value ? 'dark' : 'light')
  },
})

async function refreshDevices() {
  await tasksApi.refreshDevices()

  const devices = tasksApi.devices.value || []
  deviceOptions.value = devices.map(device => ({
    id: device.id,
    label: device.label || device.id,
    status: device.status,
  }))
}

function isDeviceUsable(device) {
  return device.status === 'device'
}

async function handleRefresh() {
  await Promise.all([
    tasksApi.refreshAll(),
    refreshDevices(),
    tasksApi.refreshRuns({ limit: 100 }),
  ])
}

// ── task actions ─────────────────────────────────────────
function handleCreateTask() {
  editingTask.value = null
  taskEditorVisible.value = true
}

function handleEditTask(task) {
  editingTask.value = JSON.parse(JSON.stringify(task))
  taskEditorVisible.value = true
}

async function handleRunTask(task) {
  try {
    ElMessage.info(t('tasks.run.started', { name: task.name }))
    const run = await tasksApi.runTask(task.id)
    if (run?.status === 'SUCCESS')
      ElMessage.success(t('tasks.run.success'))
    else
      ElMessage.warning(`${t('tasks.run.failed')}: ${run?.error || ''}`)
  }
  catch (error) {
    ElMessage.error(error?.message || t('tasks.run.failed'))
  }
}

async function handleToggleTask({ task, enabled }) {
  try {
    await tasksApi.toggleTask(task.id, enabled)
  }
  catch (error) {
    ElMessage.error(error?.message || t('tasks.action.failed'))
  }
}

function handleDeleteTask(task) {
  ElMessageBox.confirm(t('tasks.delete.confirm', { name: task.name }), 'Tips', { type: 'warning' })
    .then(() => tasksApi.deleteTask(task.id))
    .then(() => ElMessage.success(t('tasks.delete.success')))
    .catch(() => {})
}

function handleTaskSaved(task) {
  taskEditorVisible.value = false
  ElMessage.success(t('tasks.save.success'))
}

// ── workflow actions ─────────────────────────────────────
function handleCreateWorkflow() {
  editingWorkflow.value = null
  workflowEditorVisible.value = true
}

function handleEditWorkflow(workflow) {
  editingWorkflow.value = JSON.parse(JSON.stringify(workflow))
  workflowEditorVisible.value = true
}

async function handleRunWorkflow(workflow) {
  try {
    ElMessage.info(t('tasks.run.started', { name: workflow.name }))
    const run = await tasksApi.runWorkflow(workflow.id)
    if (run?.status === 'SUCCESS')
      ElMessage.success(t('tasks.run.success'))
    else
      ElMessage.warning(`${t('tasks.run.failed')}: ${run?.error || ''}`)
  }
  catch (error) {
    ElMessage.error(error?.message || t('tasks.run.failed'))
  }
}

function handleDeleteWorkflow(workflow) {
  ElMessageBox.confirm(t('tasks.workflow.deleteConfirm', { name: workflow.name }), 'Tips', { type: 'warning' })
    .then(() => tasksApi.deleteWorkflow(workflow.id))
    .then(() => ElMessage.success(t('tasks.delete.success')))
    .catch(() => {})
}

function handleWorkflowSaved() {
  workflowEditorVisible.value = false
  ElMessage.success(t('tasks.save.success'))
}

function handleClearRuns(kind) {
  const key = kind ? `tasks.history.clear.${kind}` : 'tasks.history.clear.all'
  ElMessageBox.confirm(t(key), 'Tips', { type: 'warning' })
    .then(() => tasksApi.clearRuns(kind))
    .catch(() => {})
}
</script>

<style lang="postcss" scoped>
.tasks-tabs {
  :deep(.el-tabs__header) {
    @apply !mb-2;
  }

  :deep(.el-tabs__content) {
    @apply flex-1 min-h-0 overflow-hidden;
  }

  :deep(.el-tab-pane) {
    @apply h-full;
  }
}
</style>
