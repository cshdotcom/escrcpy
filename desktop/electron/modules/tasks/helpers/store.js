/**
 * Persistence for scheduled tasks, workflows and run history.
 * Everything is stored through the shared electron-store singleton so the
 * renderer (via preload) and the main-process scheduler read the same data.
 */
import electronStore from '$electron/helpers/store/index.js'

const KEY_TASKS = 'tasks.list'
const KEY_WORKFLOWS = 'tasks.workflows'
const KEY_RUNS = 'tasks.runs'

const MAX_RUNS = 500

export const TASK_TYPES = ['AI', 'AUTOMATION', 'WORKFLOW']
export const AUTOMATION_ACTIONS = ['shell', 'tap', 'swipe', 'key', 'input_text', 'open_app', 'screenshot', 'http', 'notify', 'match_image', 'wait_image']
export const WORKFLOW_STEP_TYPES = ['ai', 'action', 'delay']

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ── Tasks ────────────────────────────────────────────────
export function getTasks() {
  const value = electronStore.get(KEY_TASKS)
  return Array.isArray(value) ? value : []
}

export function saveTasks(tasks) {
  electronStore.set(KEY_TASKS, tasks)
}

export function findTask(id) {
  return getTasks().find(task => task.id === id) || null
}

/** Insert or update a task; returns the normalized stored task. */
export function upsertTask(task) {
  const tasks = getTasks()
  const index = tasks.findIndex(item => item.id === task.id)

  const now = new Date().toISOString()

  const normalized = {
    ...task,
    name: String(task.name || '').trim() || 'Untitled task',
    type: TASK_TYPES.includes(task.type) ? task.type : 'AI',
    cronExpr: String(task.cronExpr || '').trim(),
    enabled: task.enabled !== false,
    notifyOnComplete: task.notifyOnComplete !== false,
    createdAt: task.createdAt || now,
    updatedAt: now,
  }

  if (index === -1)
    tasks.unshift(normalized)
  else
    tasks[index] = normalized

  saveTasks(tasks)
  return normalized
}

export function patchTask(id, patch) {
  const tasks = getTasks()
  const index = tasks.findIndex(item => item.id === id)

  if (index === -1)
    return null

  tasks[index] = {
    ...tasks[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  saveTasks(tasks)
  return tasks[index]
}

export function deleteTask(id) {
  const tasks = getTasks().filter(task => task.id !== id)
  saveTasks(tasks)
  return true
}

// ── Workflows ────────────────────────────────────────────
export function getWorkflows() {
  const value = electronStore.get(KEY_WORKFLOWS)
  return Array.isArray(value) ? value : []
}

export function saveWorkflows(workflows) {
  electronStore.set(KEY_WORKFLOWS, workflows)
}

export function findWorkflow(id) {
  return getWorkflows().find(workflow => workflow.id === id) || null
}

export function upsertWorkflow(workflow) {
  const workflows = getWorkflows()
  const index = workflows.findIndex(item => item.id === workflow.id)

  const now = new Date().toISOString()

  const normalized = {
    ...workflow,
    name: String(workflow.name || '').trim() || 'Untitled workflow',
    steps: Array.isArray(workflow.steps) ? workflow.steps : [],
    createdAt: workflow.createdAt || now,
    updatedAt: now,
  }

  if (index === -1)
    workflows.unshift(normalized)
  else
    workflows[index] = normalized

  saveWorkflows(workflows)
  return normalized
}

export function deleteWorkflow(id) {
  saveWorkflows(getWorkflows().filter(workflow => workflow.id !== id))
  return true
}

// ── Run history ──────────────────────────────────────────
/** Copilot vendor list (id, name, apiType, model, vision, baseUrl, apiKey) shared with the scheduler. */
export function getCopilotVendors() {
  return electronStore.get('copilot.settings.vendors') || {}
}

export function getRuns() {
  const value = electronStore.get(KEY_RUNS)
  return Array.isArray(value) ? value : []
}

export function addRun(run) {
  const runs = getRuns()

  runs.unshift(run)

  if (runs.length > MAX_RUNS)
    runs.length = MAX_RUNS

  electronStore.set(KEY_RUNS, runs)
  return run
}

export function updateRun(id, patch) {
  const runs = getRuns()
  const index = runs.findIndex(run => run.id === id)

  if (index === -1)
    return null

  runs[index] = { ...runs[index], ...patch }
  electronStore.set(KEY_RUNS, runs)
  return runs[index]
}

export function queryRuns({ kind, refId, limit = 100 } = {}) {
  let runs = getRuns()

  if (kind)
    runs = runs.filter(run => run.kind === kind)

  if (refId)
    runs = runs.filter(run => run.refId === refId)

  return runs.slice(0, Math.max(1, Math.min(limit, MAX_RUNS)))
}

export function clearRuns({ kind } = {}) {
  if (!kind) {
    electronStore.set(KEY_RUNS, [])
    return
  }

  electronStore.set(KEY_RUNS, getRuns().filter(run => run.kind !== kind))
}
