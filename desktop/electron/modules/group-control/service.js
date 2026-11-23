/**
 * Group control (群控) IPC: broadcast device input to every selected device,
 * batch screenshots / APK installs, and open a multi-device AI conversation.
 *
 * Rides the same runAction engine as scheduled tasks — broadcasting is just
 * runAction with `deviceIds` — so every automation action (incl. the new
 * image-recognition ones) works across the group.
 */
import path from 'node:path'
import fs from 'node:fs'
import dayjs from 'dayjs'
import { app, dialog } from 'electron'
import { ipcxMain } from '@escrcpy/electron-ipcx/main'
import { Adb } from '@devicefarmer/adbkit'
import { createAdbx } from '@escrcpy/adbx'
import { setupEnvPath } from '$electron/process/helper.js'
import { yadbPath } from '$electron/configs/index.js'

import { runAction } from '../tasks/helpers/executor.js'

let adbxClient = null

/** Device listing without the renderer middleware (main-process adbkit). */
async function listDevicesSafe() {
  if (!adbxClient) {
    setupEnvPath()
    adbxClient = createAdbx({ adb: Adb.createClient(), yadbPath })
  }
  const devices = await adbxClient.getDevices()
  return (devices || []).map(device => ({ id: device.id, status: device.type }))
}

function ok(data = {}) {
  return { success: true, ...data }
}

function fail(error, code = 'GROUP_ERROR') {
  const message = error?.message ?? String(error ?? 'Unknown error')
  console.warn(`[GroupControl] ${code}: ${message}`)
  return { success: false, error: { code, message } }
}

export default {
  name: 'module:group-control:service',
  apply() {
    ipcxMain.handle('group:devices', async () => {
      try {
        return ok({ devices: await listDevicesSafe() })
      }
      catch (error) {
        return fail(error, 'GROUP_DEVICES')
      }
    })

    ipcxMain.handle('group:broadcast', async (_event, payload) => {
      try {
        const deviceIds = (payload?.deviceIds || []).map(String).filter(Boolean)
        if (!deviceIds.length)
          throw new Error('No devices selected')
        if (!payload?.action?.action)
          throw new Error('No action specified')

        const result = await runAction({ ...payload.action, deviceIds })
        return ok({ output: result.output })
      }
      catch (error) {
        return fail(error, 'GROUP_BROADCAST')
      }
    })

    ipcxMain.handle('group:screenshot-all', async (_event, payload) => {
      try {
        const deviceIds = (payload?.deviceIds || []).map(String).filter(Boolean)
        if (!deviceIds.length)
          throw new Error('No devices selected')

        const dir = path.join(app.getPath('pictures'), 'Escrcpy-GroupControl')
        fs.mkdirSync(dir, { recursive: true })
        const files = []

        for (const deviceId of deviceIds) {
          const single = await runAction({ action: 'screenshot', deviceId, saveDir: dir })
          files.push(String(single.output || '').replace('screenshot saved: ', ''))
        }

        return ok({ files })
      }
      catch (error) {
        return fail(error, 'GROUP_SCREENSHOT')
      }
    })

    ipcxMain.handle('group:pick-apk', async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Android Package', extensions: ['apk'] }],
        })
        return ok({ filePath: result.canceled ? '' : result.filePaths[0] })
      }
      catch (error) {
        return fail(error, 'GROUP_PICK_APK')
      }
    })

    ipcxMain.handle('group:install-apk', async (_event, payload) => {
      try {
        const deviceIds = (payload?.deviceIds || []).map(String).filter(Boolean)
        const filePath = String(payload?.filePath || '')
        if (!deviceIds.length)
          throw new Error('No devices selected')
        if (!filePath || !fs.existsSync(filePath))
          throw new Error('APK file not found')

        const results = []
        for (const deviceId of deviceIds) {
          try {
            const output = await runAction({
              action: 'shell',
              deviceId,
              command: `install -r "${filePath.replace(/"/g, '')}"`,
            })
            results.push({ deviceId, success: true, output: output.output })
          }
          catch (error) {
            results.push({ deviceId, success: false, error: error?.message ?? String(error) })
          }
        }
        return ok({ results })
      }
      catch (error) {
        return fail(error, 'GROUP_INSTALL_APK')
      }
    })

    return () => {
      for (const channel of ['group:devices', 'group:broadcast', 'group:screenshot-all', 'group:pick-apk', 'group:install-apk']) {
        ipcxMain.removeHandler(channel)
      }
    }
  },
}
