import { ipcxMain } from '@escrcpy/electron-ipcx/main'
import { app } from 'electron'
import { platform } from '@electron-toolkit/utils'
import electronStore from '$electron/helpers/store/index.js'
import { setBootPersistence } from '$electron/services/launch/index.js'

import {
  AUTOMATION_ACTIONS,
  clearRuns,
  deleteTask,
  deleteWorkflow,
  findTask,
  findWorkflow,
  getCopilotVendors,
  getRuns,
  getTasks,
  getWorkflows,
  patchTask,
  queryRuns,
  TASK_TYPES,
  uid,
  upsertTask,
  upsertWorkflow,
} from './helpers/store.js'
import { executeTaskById, runWorkflow, listSessionsForPicker } from './helpers/executor.js'
import { computeNextRunAt, previewCron } from './helpers/schedule-helper.js'
import { isValidCron } from './helpers/cron.js'

function ok(data = {}) {
  return { success: true, ...data }
}

function fail(error, code = 'TASK_ERROR') {
  const message = error?.message ?? String(error ?? 'Unknown error')
  console.warn(`[Tasks] ${code}: ${message}`)
  return { success: false, error: { code, message } }
}

/** Normalize a task payload coming from the renderer. */
function normalizeTaskPayload(payload = {}) {
  const task = { ...payload }

  if (!task.id)
    task.id = uid('task')

  if (!TASK_TYPES.includes(task.type))
    throw new Error(`Invalid task type: ${task.type}`)

  task.cronExpr = String(task.cronExpr || '').trim()
  if (!task.cronExpr)
    throw new Error('Cron expression is required')
  if (!isValidCron(task.cronExpr))
    throw new Error(`Invalid cron expression: ${task.cronExpr}`)

  if (task.type === 'AI') {
    if (!String(task.config?.prompt || '').trim())
      throw new Error('AI prompt is required')

    // sessionMode 'existing' binds the task to a user-selected conversation.
    if (task.config?.sessionMode === 'existing' && !task.config?.sessionId)
      throw new Error('A conversation must be selected for the "existing conversation" context mode')
  }
  else if (task.type === 'AUTOMATION') {
    if (!AUTOMATION_ACTIONS.includes(task.config?.action))
      throw new Error(`Invalid automation action: ${task.config?.action}`)
  }
  else if (task.type === 'WORKFLOW') {
    if (!task.config?.workflowId || !findWorkflow(task.config.workflowId))
      throw new Error('A valid workflow must be selected')
  }

  return task
}

function serializeTask(task) {
  return {
    ...task,
    cronValid: true,
    nextRunAt: task.enabled !== false ? (task.nextRunAt || computeNextRunAt(task)) : null,
  }
}

export default {
  name: 'module:tasks:service',
  apply() {
    // ── Tasks ────────────────────────────────────────────
    ipcxMain.handle('tasks:list', async () => {
      try {
        const tasks = getTasks().map(serializeTask)
        return ok({ tasks })
      }
      catch (error) {
        return fail(error, 'TASKS_LIST')
      }
    })

    ipcxMain.handle('tasks:save', async (_event, payload) => {
      try {
        const task = normalizeTaskPayload(payload?.task || payload)
        const saved = upsertTask(task)
        const withNext = patchTask(saved.id, { nextRunAt: computeNextRunAt(saved) })
        return ok({ task: serializeTask(withNext) })
      }
      catch (error) {
        return fail(error, 'TASKS_SAVE')
      }
    })

    ipcxMain.handle('tasks:delete', async (_event, payload) => {
      try {
        deleteTask(payload?.id)
        return ok()
      }
      catch (error) {
        return fail(error, 'TASKS_DELETE')
      }
    })

    ipcxMain.handle('tasks:toggle', async (_event, payload) => {
      try {
        const task = findTask(payload?.id)
        if (!task)
          throw new Error('Task not found')

        const enabled = payload?.enabled !== false
        const updated = patchTask(task.id, {
          enabled,
          nextRunAt: enabled ? computeNextRunAt(task) : null,
        })

        return ok({ task: serializeTask(updated) })
      }
      catch (error) {
        return fail(error, 'TASKS_TOGGLE')
      }
    })

    ipcxMain.handle('tasks:run', async (_event, payload) => {
      try {
        const run = await executeTaskById(payload?.id, 'manual')
        return ok({ run })
      }
      catch (error) {
        return fail(error, 'TASKS_RUN')
      }
    })

    // ── Workflows ────────────────────────────────────────
    ipcxMain.handle('workflows:list', async () => {
      try {
        return ok({ workflows: getWorkflows() })
      }
      catch (error) {
        return fail(error, 'WORKFLOWS_LIST')
      }
    })

    ipcxMain.handle('workflows:save', async (_event, payload) => {
      try {
        const workflow = { ...(payload?.workflow || payload) }

        if (!workflow.id)
          workflow.id = uid('workflow')

        if (!Array.isArray(workflow.steps) || !workflow.steps.length)
          throw new Error('Workflow needs at least one step')

        for (const step of workflow.steps) {
          if (step.type === 'ai' && !String(step.prompt || '').trim())
            throw new Error(`AI step "${step.name || step.id}" is missing a prompt`)
          if (step.type === 'action' && !AUTOMATION_ACTIONS.includes(step.action))
            throw new Error(`Action step "${step.name || step.id}" has an invalid action`)
          if (step.type === 'delay' && !(Number(step.seconds) > 0))
            throw new Error(`Delay step "${step.name || step.id}" must wait at least 1 second`)
        }

        const saved = upsertWorkflow(workflow)
        return ok({ workflow: saved })
      }
      catch (error) {
        return fail(error, 'WORKFLOWS_SAVE')
      }
    })

    ipcxMain.handle('workflows:delete', async (_event, payload) => {
      try {
        deleteWorkflow(payload?.id)
        return ok()
      }
      catch (error) {
        return fail(error, 'WORKFLOWS_DELETE')
      }
    })

    ipcxMain.handle('workflows:run', async (_event, payload) => {
      try {
        const run = await runWorkflow(payload?.id, 'manual')
        return ok({ run })
      }
      catch (error) {
        return fail(error, 'WORKFLOWS_RUN')
      }
    })

    // ── Shared helpers ───────────────────────────────────
    /** Conversation list for the task editor's "use existing conversation" picker. */
    ipcxMain.handle('tasks:sessions', async () => {
      try {
        return ok({ sessions: listSessionsForPicker() })
      }
      catch (error) {
        return fail(error, 'TASKS_SESSIONS')
      }
    })

    ipcxMain.handle('tasks:preview-cron', async (_event, payload) => {
      try {
        const expr = String(payload?.expr || '').trim()
        return ok({ valid: isValidCron(expr), next: previewCron(expr, 5) })
      }
      catch (error) {
        return fail(error, 'TASKS_PREVIEW_CRON')
      }
    })

    ipcxMain.handle('tasks:vendors', async () => {
      try {
        const vendors = getCopilotVendors()

        const list = Object.values(vendors).map(vendor => ({
          id: vendor.id,
          name: vendor.name || vendor.id,
          apiType: vendor.apiType,
          model: vendor.model || '',
          vision: vendor.vision === true,
          baseUrl: vendor.baseUrl || '',
          configured: Boolean(vendor.baseUrl && vendor.model && vendor.apiKey),
        }))

        // The task editor uses this to pre-select a working vendor so the
        // picker never opens on "not configured".
        const activeVendorId = electronStore.get('copilot.settings.activeVendorId') || ''

        return ok({ vendors: list, activeVendorId })
      }
      catch (error) {
        return fail(error, 'TASKS_VENDORS')
      }
    })

    ipcxMain.handle('tasks:runs', async (_event, payload) => {
      try {
        const { kind, refId, limit } = payload || {}
        return ok({ runs: queryRuns({ kind, refId, limit }) })
      }
      catch (error) {
        return fail(error, 'TASKS_RUNS')
      }
    })

    ipcxMain.handle('tasks:clear-runs', async (_event, payload) => {
      try {
        clearRuns({ kind: payload?.kind })
        return ok()
      }
      catch (error) {
        return fail(error, 'TASKS_CLEAR_RUNS')
      }
    })

    /**
     * Register/unregister Escrcpy as a system login item so scheduled tasks
     * fire even when the user has not opened the app after boot. Rides the
     * launch service so Linux (.desktop autostart) and the self-healing
     * re-assert loop behave identically to the preferences switch.
     */
    ipcxMain.handle('tasks:set-launch-on-boot', async (_event, payload) => {
      try {
        const enabled = Boolean(payload?.enabled)
        await setBootPersistence(enabled)
        console.log(`[Tasks] launch-on-boot ${enabled ? 'enabled' : 'disabled'}`)
        return ok({ enabled })
      }
      catch (error) {
        return fail(error, 'TASKS_SET_LAUNCH_ON_BOOT')
      }
    })

    /**
     * Read back the current system login-item registration so the config
     * drawer can show the real state, not just the stored preference.
     */
    ipcxMain.handle('tasks:get-launch-on-boot', async () => {
      try {
        if (platform.isLinux) {
          const AutoLaunch = (await import('auto-launch')).default
          const autoLaunch = new AutoLaunch({ name: 'Escrcpy', isHidden: true })
          return ok({ enabled: await autoLaunch.isEnabled().catch(() => false) })
        }

        const settings = app.getLoginItemSettings()
        return ok({ enabled: settings.openAtLogin })
      }
      catch (error) {
        return fail(error, 'TASKS_GET_LAUNCH_ON_BOOT')
      }
    })

    ipcxMain.handle('tasks:stats', async () => {
      try {
        const tasks = getTasks()
        const runs = getRuns()

        return ok({
          stats: {
            total: tasks.length,
            enabled: tasks.filter(task => task.enabled !== false).length,
            ai: tasks.filter(task => task.type === 'AI').length,
            automation: tasks.filter(task => task.type === 'AUTOMATION').length,
            workflow: tasks.filter(task => task.type === 'WORKFLOW').length,
            workflows: getWorkflows().length,
            runs: runs.length,
          },
        })
      }
      catch (error) {
        return fail(error, 'TASKS_STATS')
      }
    })

    return () => {
      for (const channel of [
        'tasks:list',
        'tasks:save',
        'tasks:delete',
        'tasks:toggle',
        'tasks:run',
        'tasks:preview-cron',
        'tasks:vendors',
        'tasks:runs',
        'tasks:clear-runs',
        'tasks:stats',
        'tasks:set-launch-on-boot',
        'tasks:get-launch-on-boot',
        'workflows:list',
        'workflows:save',
        'workflows:delete',
        'workflows:run',
      ]) {
        ipcxMain.removeHandler(channel)
      }
    }
  },
}
