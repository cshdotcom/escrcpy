/**
 * Renderer bridge for the scheduled tasks page: IPC calls, shared state
 * (tasks, workflows, runs, vendors, devices) and periodic refresh.
 */
import dayjs from 'dayjs'

const ipcx = window.$preload.ipcxRenderer

function unwrap(result, fallback = null) {
  if (result?.success)
    return result
  throw new Error(result?.error?.message || 'Unknown error')
}

export function useTasks() {
  const tasks = ref([])
  const workflows = ref([])
  const runs = ref([])
  const vendors = ref([])
  const devices = ref([])
  const stats = ref(null)
  const loading = ref(false)

  let refreshTimer = null

  // ── data loading ───────────────────────────────────────
  async function refreshTasks() {
    const result = await ipcx.invoke('tasks:list')
    if (result?.success)
      tasks.value = result.tasks || []
    return tasks.value
  }

  async function refreshWorkflows() {
    const result = await ipcx.invoke('workflows:list')
    if (result?.success)
      workflows.value = result.workflows || []
    return workflows.value
  }

  async function refreshRuns(options = {}) {
    const result = await ipcx.invoke('tasks:runs', options)
    if (result?.success)
      runs.value = result.runs || []
    return runs.value
  }

  async function refreshVendors() {
    const result = await ipcx.invoke('tasks:vendors')
    if (result?.success)
      vendors.value = result.vendors || []
    return vendors.value
  }

  async function refreshDevices() {
    try {
      const list = await window.$preload.adb.getDeviceList()
      devices.value = (list || []).map(device => ({
        id: device.id,
        status: device.status,
        label: device.name || device.id,
      }))
    }
    catch {
      devices.value = []
    }
    return devices.value
  }

  async function refreshAll() {
    loading.value = true
    try {
      await Promise.all([refreshTasks(), refreshWorkflows(), refreshVendors(), refreshDevices()])
    }
    finally {
      loading.value = false
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh()
    refreshTimer = setInterval(() => {
      if (document.hidden)
        return
      refreshTasks().catch(() => {})
      refreshRuns({ limit: 100 }).catch(() => {})
    }, 10_000)
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  }

  // ── tasks ──────────────────────────────────────────────
  async function saveTask(task) {
    const result = unwrap(await ipcx.invoke('tasks:save', { task }))
    await refreshTasks()
    return result.task
  }

  async function deleteTask(id) {
    await ipcx.invoke('tasks:delete', { id })
    await refreshTasks()
  }

  async function toggleTask(id, enabled) {
    const result = await ipcx.invoke('tasks:toggle', { id, enabled })
    if (!result?.success)
      throw new Error(result?.error?.message || 'Failed to toggle')
    await refreshTasks()
    return result.task
  }

  async function runTask(id) {
    const result = unwrap(await ipcx.invoke('tasks:run', { id }))
    await Promise.all([refreshTasks(), refreshRuns({ limit: 100 })])
    return result.run
  }

  // ── workflows ──────────────────────────────────────────
  async function saveWorkflow(workflow) {
    const result = unwrap(await ipcx.invoke('workflows:save', { workflow }))
    await refreshWorkflows()
    return result.workflow
  }

  async function deleteWorkflow(id) {
    await ipcx.invoke('workflows:delete', { id })
    await refreshWorkflows()
  }

  async function runWorkflow(id) {
    const result = unwrap(await ipcx.invoke('workflows:run', { id }))
    await Promise.all([refreshRuns({ limit: 100 }), refreshTasks()])
    return result.run
  }

  async function clearRuns(kind) {
    await ipcx.invoke('tasks:clear-runs', { kind })
    await refreshRuns({ limit: 100 })
  }

  async function previewCron(expr) {
    return await ipcx.invoke('tasks:preview-cron', { expr })
  }

  onMounted(() => {
    refreshAll().catch(() => {})
    startAutoRefresh()
  })

  onUnmounted(() => {
    stopAutoRefresh()
  })

  return {
    tasks,
    workflows,
    runs,
    vendors,
    devices,
    stats,
    loading,

    refreshTasks,
    refreshWorkflows,
    refreshRuns,
    refreshVendors,
    refreshDevices,
    refreshAll,

    saveTask,
    deleteTask,
    toggleTask,
    runTask,

    saveWorkflow,
    deleteWorkflow,
    runWorkflow,

    clearRuns,
    previewCron,
  }
}

/** Shared formatting helpers. */
export function formatDateTime(value) {
  if (!value)
    return '—'
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}

export function formatDuration(ms) {
  if (ms == null)
    return '—'
  if (ms < 1000)
    return `${ms}ms`
  if (ms < 60_000)
    return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

export function formatRelative(value) {
  if (!value)
    return '—'
  const target = dayjs(value)
  const diffMinutes = target.diff(dayjs(), 'minute')

  if (Math.abs(diffMinutes) < 1)
    return target.format('HH:mm')

  if (diffMinutes > 0 && diffMinutes < 60)
    return `+${diffMinutes}m`

  if (diffMinutes <= 0 && diffMinutes > -60)
    return `${diffMinutes}m`

  return target.format('MM-DD HH:mm')
}
