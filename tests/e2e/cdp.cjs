/**
 * Minimal CDP (Chrome DevTools Protocol) client built on Node's native
 * WebSocket (Node >= 22). Enough to drive Electron renderer pages:
 * list targets, attach, evaluate expressions with awaitPromise.
 */

async function listTargets(port = 9222) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok)
    throw new Error(`CDP /json/list failed: HTTP ${res.status}`)
  return res.json()
}

async function waitForVersion(port = 9222, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok)
        return res.json()
    }
    catch {}
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`CDP not ready on port ${port} within ${timeoutMs}ms`)
}

class CdpSession {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error)
          reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`))
        else
          resolve(msg.result)
      }
      else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? [])
          fn(msg.params)
      }
    })
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP ws connect timeout')), 10000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP ws error')) }, { once: true })
    })
    return new CdpSession(ws)
  }

  send(method, params = {}) {
    const id = ++this.seq
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP call timeout: ${method}`))
        }
      }, 60000)
    })
    this.ws.send(JSON.stringify({ id, method, params }))
    return promise
  }

  on(method, fn) {
    if (!this.listeners.has(method))
      this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }

  /**
   * Evaluate an expression in the page. Returns the plain value.
   * Unwraps CDP error details (e.g. uncaught exceptions in the page).
   */
  async evaluate(expression, { awaitPromise = true, timeoutMs = 55000 } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      timeout: timeoutMs,
    })
    if (result.exceptionDetails) {
      const d = result.exceptionDetails
      throw new Error(`page evaluate threw: ${d.text} ${d.exception?.description || ''}`)
    }
    return result.result?.value
  }

  close() {
    try { this.ws.close() }
    catch {}
  }
}

module.exports = { listTargets, waitForVersion, CdpSession }
