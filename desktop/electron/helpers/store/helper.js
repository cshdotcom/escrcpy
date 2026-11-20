import Store from 'electron-store'
import { get, isEqual, set } from 'lodash-es'
import { createProxy } from '$electron/helpers/index.js'

/**
 * Hardened electron-store factory.
 *
 * Users on flaky filesystems (network mounts, FUSE, some SD cards) hit
 * transient EIO errors while reading/writing config.json. Plain electron-store
 * lets those errors escape, which historically crashed the app with a modal
 * dialog and silently dropped configuration changes (the "AI API config does
 * not persist" bug).
 *
 * This wrapper:
 *  - retries the initial store read a few times (transient EIO clears within
 *    seconds on those mounts)
 *  - retries every write on transient fs errors before giving up
 *  - never swallows the final failure silently: the error is re-thrown with a
 *    readable message so callers (and the renderer) can surface it, while the
 *    in-memory value stays intact for the next successful write
 */

const RETRYABLE_FS_CODES = new Set([
  'EIO',
  'EAGAIN',
  'EWOULDBLOCK',
  'EMFILE',
  'ENFILE',
  'ENODEV',
  'ETIMEDOUT',
  'ECONNRESET',
])

const MAX_READ_ATTEMPTS = 8
const MAX_WRITE_ATTEMPTS = 5

function isRetryableFsError(error) {
  if (!error)
    return false
  return RETRYABLE_FS_CODES.has(error.code)
    || (typeof error.code === 'string' && error.code.startsWith('ERR_FS_'))
}

/**
 * Small synchronous sleep — acceptable here because store ops are sync and
 * the whole retry window is bounded to a few hundred ms per attempt.
 */
function syncSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runWithRetry(operation, label, maxAttempts) {
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return operation()
    }
    catch (error) {
      lastError = error

      if (!isRetryableFsError(error))
        throw error

      const delay = Math.min(50 * 2 ** (attempt - 1), 800)
      console.warn(`[Store] ${label} failed with ${error.code || 'fs error'} (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms: ${error.message}`)
      syncSleep(delay)
    }
  }

  throw lastError
}

function createRetryingStore(options = {}) {
  return runWithRetry(() => new Store(options), 'config read', MAX_READ_ATTEMPTS)
}

export function createStore(options = {}) {
  const store = createRetryingStore({
    watch: true,
    ...options,
  })

  if (isEqual(store.store, {})) {
    store.store = {}
  }

  return resolveStore(store)
}

export function resolveStore(store) {
  const writeRetry = (operation, label) => {
    try {
      return runWithRetry(operation, label, MAX_WRITE_ATTEMPTS)
    }
    catch (error) {
      // Surface a readable error (callers show it in the UI) but keep the
      // in-memory state so the next write can still succeed.
      console.error(`[Store] ${label} gave up after ${MAX_WRITE_ATTEMPTS} attempts: ${error.message}`)
      const wrapped = new Error(`Failed to save configuration (${error.code || 'fs error'}): ${error.message}. The change is active for this session and will be retried on the next change.`)
      wrapped.cause = error
      throw wrapped
    }
  }

  return {
    ...createProxy(store, [
      'get',
      'delete',
      'clear',
      'reset',
      'has',
      'onDidChange',
      'onDidAnyChange',
      'openInEditor',
    ]),

    getPath: () => store.path,

    getAll: () => store.store,

    setAll: value => writeRetry(() => {
      store.store = value
    }, 'config write'),

    set(...args) {
      if (Array.isArray(args[0])) {
        const tempStore = { ...store.store }

        set(tempStore, args[0], args[1])

        writeRetry(() => {
          store.set(tempStore)
        }, 'config write')

        return false
      }

      writeRetry(() => {
        store.set(...args)
      }, 'config write')
    },

    get(...args) {
      if (Array.isArray(args[0])) {
        return get(store.store, args[0])
      }

      return store.get(...args)
    },
  }
}
