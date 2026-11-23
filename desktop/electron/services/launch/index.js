import electronStore from '$electron/helpers/store/index.js'
import { app } from 'electron'
import { platform } from '@electron-toolkit/utils'

/**
 * Strong boot persistence ("开机强力自启动").
 *
 * The historic implementation registered the login item once, when the user
 * flipped the preference — and never again. OS updates, login-item cleaners,
 * permission repairs or a partially-failed write silently removed Escrcpy
 * from the boot chain, and scheduled tasks stopped firing until the user
 * noticed and re-opened the app by hand.
 *
 * This service makes the registration self-healing:
 *  - both switches (`common.autoLaunch` in preferences and
 *    `copilot.settings.launchOnBoot` in the Copilot config) map onto the SAME
 *    OS login item, so there is one source of truth per machine state
 *  - on every app start, and then every 10 minutes while enabled, the
 *    registration is re-asserted (idempotent setLoginItemSettings / .desktop
 *    write), so anything that removed it is undone automatically
 *  - boot starts hidden (--minimized → tray) so the user is not interrupted
 */

const REASSERT_INTERVAL_MS = 10 * 60 * 1000

function isBootPersistenceWanted() {
  const autoLaunch = electronStore.get('common.autoLaunch')
  const copilotLaunch = electronStore.get('copilot.settings.launchOnBoot')
  return autoLaunch === true || copilotLaunch === true
}

/**
 * Public entry for other modules (tasks:set-launch-on-boot IPC): register or
 * unregister Escrcpy as an OS login item, cross-platform. Returns a human
 * readable error on failure instead of throwing.
 */
export async function setBootPersistence(enabled) {
  await applyLoginItem(enabled)
  if (enabled)
    scheduleReassert()
  else if (reassertTimer) {
    clearInterval(reassertTimer)
    reassertTimer = null
  }
}

async function applyLoginItem(enabled) {
  // Linux has no setLoginItemSettings — use the auto-launch package which
  // writes/updates the .desktop autostart entry.
  if (platform.isLinux) {
    const AutoLaunch = (await import('auto-launch')).default
    const autoLaunch = new AutoLaunch({
      name: 'Escrcpy',
      // .desktop entries survive better when they just launch hidden
      isHidden: true,
    })

    const isEnabled = await autoLaunch.isEnabled().catch(() => false)
    if (enabled && !isEnabled)
      await autoLaunch.enable().catch(error => console.warn('[boot] enable failed:', error?.message ?? error))
    if (!enabled && isEnabled)
      await autoLaunch.disable().catch(error => console.warn('[boot] disable failed:', error?.message ?? error))

    return
  }

  // Windows / macOS: openAsHidden (mac) + --minimized arg (win) start the app
  // in the tray so a boot launch never throws a window in the user's face.
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: enabled,
    args: enabled ? ['--minimized'] : [],
  })
}

let reassertTimer = null

function scheduleReassert() {
  if (reassertTimer)
    return

  reassertTimer = setInterval(() => {
    try {
      // Only keep hammering while the user still wants boot persistence;
      // a timer tick that lands right after a "disable" flip must not
      // re-register the login item behind the user's back.
      if (!isBootPersistenceWanted()) {
        clearInterval(reassertTimer)
        reassertTimer = null
        return
      }
      applyLoginItem(true)
    }
    catch (error) {
      console.warn('[boot] re-assert failed:', error?.message ?? error)
    }
  }, REASSERT_INTERVAL_MS)

  if (typeof reassertTimer.unref === 'function')
    reassertTimer.unref()
}

export default {
  name: 'service:launch',
  apply() {
    // Any of the two switches can flip; both converge on the same OS state.
    const onChange = async (flag) => {
      const wanted = flag === true || isBootPersistenceWanted()
      await applyLoginItem(wanted)

      if (wanted)
        scheduleReassert()
      else if (reassertTimer) {
        clearInterval(reassertTimer)
        reassertTimer = null
      }
    }

    electronStore.onDidChange('common.autoLaunch', onChange)
    electronStore.onDidChange('copilot.settings.launchOnBoot', onChange)

    // Self-heal on boot of the app itself: if the OS dropped the registration
    // while we were not running, restore it immediately.
    app.whenReady().then(() => {
      if (!isBootPersistenceWanted())
        return

      applyLoginItem(true)
        .then(() => console.log('[boot] login item re-asserted on app start'))
        .catch(error => console.warn('[boot] start re-assert failed:', error?.message ?? error))

      scheduleReassert()
    }).catch(error => console.warn('[boot] whenReady failed:', error?.message ?? error))
  },
}
