/**
 * Global main-process exception guard.
 *
 * Motivation: users on flaky filesystems (network mounts, FUSE, some SD cards)
 * hit transient `EIO: i/o error` failures while electron-store reads/writes
 * config.json. Any of those escaping to the event loop crashed the app with
 * the "A JavaScript error occurred in the main process" dialog, killing
 * scheduled tasks and wiping unsaved state.
 *
 * Policy:
 *  - every uncaughtException / unhandledRejection is logged with a timestamp
 *  - filesystem-transient errors (EIO, EAGAIN, EMFILE, …) are swallowed —
 *    the store layer retries them, so the app just keeps running
 *  - any other error is logged as well and the process stays alive: for a
 *    desktop app that owns scheduled background work, degrading beats dying.
 *    The error is NOT rethrown (rethrowing re-triggers the dialog loop).
 *
 * This file must be imported FIRST in main.js, before any module that might
 * touch the filesystem.
 */

const TRANSIENT_FS_CODES = new Set([
  'EIO',
  'EAGAIN',
  'EWOULDBLOCK',
  'EMFILE',
  'ENFILE',
  'ENODEV',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTCONN',
  'ERR_FS_*',
])

let transientCount = 0

function isTransientFsError(error) {
  if (!error)
    return false
  if (TRANSIENT_FS_CODES.has(error.code))
    return true
  return typeof error.code === 'string' && error.code.startsWith('ERR_FS_')
}

function describe(error) {
  if (!error)
    return 'unknown'
  const parts = [error.name, error.code, error.message].filter(Boolean)
  return parts.join(': ')
}

function handle(error, kind) {
  const now = new Date().toISOString()

  if (isTransientFsError(error)) {
    // Filesystem hiccup — the store layer retries; keep this process alive.
    transientCount++
    console.warn(`[Guard] ${now} transient fs error (${kind}, #${transientCount}) — ignored: ${describe(error)}`)
    return
  }

  // Real bugs are logged loudly but do not take the app down: killing the
  // process would also kill the scheduler, tray and every open window.
  console.error(`[Guard] ${now} unhandled ${kind} (process kept alive):`, error)
}

let installed = false

export function setupProcessGuard() {
  if (installed)
    return
  installed = true

  process.on('uncaughtException', (error) => {
    handle(error, 'uncaughtException')
  })

  process.on('unhandledRejection', (reason) => {
    handle(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection')
  })

  console.log('[Guard] main-process exception guard installed')
}

// Install immediately on import — main.js imports this module as its very
// first statement. Without this self-install the bundler tree-shakes the
// (otherwise unused) module away and the guard silently never registers.
setupProcessGuard()
