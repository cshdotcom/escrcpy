/**
 * Keyboard mapping (键盘映射) — the paid feature that lets you bind PC keys to
 * touch positions / gestures on the mirrored screen, with per-device profiles.
 *
 * Kinds: tap, swipe, rapidTap, scroll (wheel → pinch), joystick (WASD),
 * viewControl (mouse look) and macro (run an automation script).
 */
export const MAPPING_KINDS = [
  { value: 'tap', label: 'keyboard.mapping.type.tap', description: 'keyboard.mapping.type.tap.description', requiresTrigger: true },
  { value: 'swipe', label: 'keyboard.mapping.type.swipe', description: 'keyboard.mapping.type.swipe.description', requiresTrigger: true },
  { value: 'rapidTap', label: 'keyboard.mapping.type.rapidTap', description: 'keyboard.mapping.type.rapidTap.description', requiresTrigger: true },
  { value: 'scroll', label: 'keyboard.mapping.type.scroll', description: 'keyboard.mapping.type.scroll.description', requiresTrigger: false },
  { value: 'joystick', label: 'keyboard.mapping.type.joystick', description: 'keyboard.mapping.type.joystick.description', requiresTrigger: false },
  { value: 'viewControl', label: 'keyboard.mapping.type.viewControl', description: 'keyboard.mapping.type.viewControl.description', requiresTrigger: false },
  { value: 'macro', label: 'keyboard.mapping.type.macro', description: 'keyboard.mapping.type.macro.description', requiresTrigger: true },
]

export const DIRECTIONS = ['up', 'down', 'left', 'right']

function uid(prefix = 'map') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export function createMapping(kind = 'tap', position = { x: 0.5, y: 0.5 }) {
  const base = {
    id: uid(),
    kind,
    name: '',
    enabled: true,
    trigger: null,
    shortcut: null,
    position: { x: position.x, y: position.y },
    action: {},
  }
  switch (kind) {
    case 'tap':
      base.action = { type: 'tap' }
      break
    case 'swipe':
      base.action = { type: 'swipe', direction: 'up', distance: 0.12, duration: 160 }
      break
    case 'rapidTap':
      base.action = { type: 'rapidTap', interval: 90 }
      break
    case 'scroll':
      base.action = { type: 'scroll', sensitivity: 1, duration: 120, range: 0.08 }
      break
    case 'joystick':
      base.action = {
        type: 'joystick',
        radius: 0.14,
        duration: 80,
        directions: { up: null, down: null, left: null, right: null },
      }
      break
    case 'viewControl':
      base.action = { type: 'viewControl', sensitivity: 1, duration: 16, range: 0.1, strategy: 'fps' }
      break
    case 'macro':
      base.action = { type: 'macro', automationConfig: { scriptId: '', scriptSteps: [] }, loop: 1 }
      break
    default:
      base.action = { type: 'tap' }
  }
  return base
}

export function createProfile(name = '') {
  return {
    id: uid('profile'),
    name: name || 'New profile',
    mappings: [],
    settings: {
      behaviorLevel: 'medium',
      scrollDirection: 'normal',
    },
    createdAt: Date.now(),
  }
}

export function validateMapping(mapping) {
  const errors = []
  const action = mapping?.action || {}
  const definition = MAPPING_KINDS.find(item => item.value === mapping?.kind)

  if (mapping?.enabled === false)
    return errors

  if (mapping?.kind === 'joystick') {
    const missing = DIRECTIONS.filter(dir => !action.directions?.[dir])
    if (missing.length)
      errors.push('keyboard.mapping.validation.joystickDirections')
    if (Number(action.radius || 0) <= 0)
      errors.push('keyboard.mapping.validation.radius')
    return errors
  }

  if (definition?.requiresTrigger !== false && !mapping?.trigger)
    errors.push('keyboard.mapping.validation.trigger')

  if (mapping?.kind === 'rapidTap' && Number(action.interval || 0) < 30)
    errors.push('keyboard.mapping.validation.interval')

  if (['swipe', 'viewControl', 'scroll'].includes(mapping?.kind) && Number(action.duration || 0) < 16)
    errors.push('keyboard.mapping.validation.duration')

  if (['viewControl', 'scroll'].includes(mapping?.kind) && Number(action.range || 0) <= 0)
    errors.push('keyboard.mapping.validation.range')

  if (mapping?.kind === 'macro') {
    const config = action.automationConfig
    if (!config?.scriptId || !Array.isArray(config.scriptSteps) || !config.scriptSteps.length)
      errors.push('keyboard.mapping.validation.macroScript')
  }

  return errors
}

export function validateProfile(profile) {
  const errors = []
  const triggers = new Map()
  for (const mapping of profile?.mappings || []) {
    if (mapping.enabled === false)
      continue
    const key = mapping.trigger?.combo
    if (key) {
      if (triggers.has(key))
        errors.push('keyboard.mapping.validation.triggerConflict')
      triggers.set(key, mapping)
    }
    errors.push(...validateMapping(mapping))
  }
  return [...new Set(errors)]
}

export function comboFromEvent(event) {
  const parts = []
  if (event.ctrlKey)
    parts.push('Ctrl')
  if (event.altKey)
    parts.push('Alt')
  if (event.shiftKey)
    parts.push('Shift')
  if (event.metaKey)
    parts.push('Meta')
  const code = event.code || ''
  const key = code.startsWith('Key')
    ? code.slice(3)
    : code.startsWith('Digit')
      ? code.slice(5)
      : code === 'Space' ? 'Space' : code
  if (key)
    parts.push(key)
  return {
    combo: parts.join('+'),
    code,
    key: event.key,
  }
}

export function comboLabel(trigger) {
  return trigger?.combo || ''
}

/**
 * Runtime for keyboard mappings. Returns handlers to be bound on the window.
 */
export function useKeyboardMapping({ deviceIdRef, control, getStreamSize }) {
  const profiles = ref([])
  const activeId = ref(null)
  const mode = ref('off') // off | edit | play
  const selectedId = ref(null)
  const capturing = ref(null) // { mappingId, target: 'trigger'|'shortcut'|'direction', direction? }
  const pendingLabel = ref('')
  const settings = ref({ behaviorLevel: 'medium', scrollDirection: 'normal' })

  const activeProfile = computed(() => profiles.value.find(item => item.id === activeId.value) || null)
  const selectedMapping = computed(() => {
    const profile = activeProfile.value
    if (!profile)
      return null
    return profile.mappings.find(item => item.id === selectedId.value) || null
  })

  async function load() {
    const result = await window.$preload.ipcxRenderer.invoke('mirror:keymap:get', {
      deviceId: deviceIdRef.value,
    }).catch(() => null)
    if (result?.profiles?.length) {
      profiles.value = result.profiles
      activeId.value = result.activeId || result.profiles[0]?.id || null
      settings.value = { ...settings.value, ...(result.settings || {}) }
    }
    else {
      profiles.value = []
      activeId.value = null
    }
    return result
  }

  async function save() {
    const result = await window.$preload.ipcxRenderer.invoke('mirror:keymap:save', {
      deviceId: deviceIdRef.value,
      profiles: JSON.parse(JSON.stringify(profiles.value)),
      activeId: activeId.value,
      settings: JSON.parse(JSON.stringify(settings.value)),
    }).catch(() => null)
    return result
  }

  function create(name) {
    const profile = createProfile(name)
    profiles.value.push(profile)
    activeId.value = profile.id
    save()
    return profile
  }

  function duplicate(profileId = activeId.value) {
    const source = profiles.value.find(item => item.id === profileId)
    if (!source) {
      return null
    }
    const copy = JSON.parse(JSON.stringify(source))
    copy.id = uid('profile')
    copy.name = `${source.name} copy`
    copy.createdAt = Date.now()
    profiles.value.push(copy)
    activeId.value = copy.id
    save()
    return copy
  }

  function remove(profileId = activeId.value) {
    const index = profiles.value.findIndex(item => item.id === profileId)
    if (index === -1)
      return
    profiles.value.splice(index, 1)
    if (activeId.value === profileId)
      activeId.value = profiles.value[0]?.id || null
    save()
  }

  function addMapping(kind = 'tap', position = { x: 0.5, y: 0.5 }) {
    if (!activeProfile.value)
      create()
    const mapping = createMapping(kind, position)
    activeProfile.value.mappings.push(mapping)
    selectedId.value = mapping.id
    save()
    return mapping
  }

  function updateMapping(id, patch) {
    const mapping = activeProfile.value?.mappings.find(item => item.id === id)
    if (!mapping)
      return
    if (patch.action)
      mapping.action = { ...mapping.action, ...patch.action }
    Object.assign(mapping, patch)
    save()
  }

  function removeMapping(id) {
    const mappings = activeProfile.value?.mappings
    if (!mappings)
      return
    const index = mappings.findIndex(item => item.id === id)
    if (index !== -1)
      mappings.splice(index, 1)
    if (selectedId.value === id)
      selectedId.value = null
    save()
  }

  function importProfiles(files) {
    const next = [...profiles.value]
    let imported = 0
    for (const file of files) {
      try {
        const data = JSON.parse(file)
        if (Array.isArray(data)) {
          data.forEach((item) => {
            const profile = normalizeProfile(item)
            if (profile) {
              next.push(profile)
              imported += 1
            }
          })
        }
        else {
          const profile = normalizeProfile(data)
          if (profile) {
            next.push(profile)
            imported += 1
          }
        }
      }
      catch {}
    }
    profiles.value = next
    if (!activeId.value && next.length)
      activeId.value = next[0].id
    save()
    return imported
  }

  function exportProfiles() {
    return JSON.stringify(profiles.value, null, 2)
  }

  function normalizeProfile(value) {
    if (!value || typeof value !== 'object')
      return null
    const profile = createProfile(value.name || 'Imported')
    profile.id = value.id || profile.id
    profile.name = value.name || profile.name
    profile.settings = { ...profile.settings, ...(value.settings || {}) }
    profile.mappings = Array.isArray(value.mappings)
      ? value.mappings.map((item) => {
          const mapping = createMapping(item.kind || 'tap', item.position || { x: 0.5, y: 0.5 })
          return {
            ...mapping,
            ...item,
            id: item.id || mapping.id,
            position: item.position || mapping.position,
            action: { ...mapping.action, ...(item.action || {}) },
          }
        })
      : []
    return profile
  }

  // ── runtime execution ────────────────────────────────────────────────────

  const activePointers = new Map()
  let joystickState = null
  let viewState = null
  const rapidTimers = new Map()
  let scrollState = null

  function screenPoint(position) {
    return {
      x: Math.max(0, Math.min(1, Number(position?.x) || 0)),
      y: Math.max(0, Math.min(1, Number(position?.y) || 0)),
    }
  }

  async function touchDown(pointerId, position) {
    const point = screenPoint(position)
    await control('touch', {
      action: 'down',
      pointerId,
      x: point.x,
      y: point.y,
      normalized: true,
      pressure: 1,
    })
  }

  async function touchMove(pointerId, position) {
    const point = screenPoint(position)
    await control('touch', {
      action: 'move',
      pointerId,
      x: point.x,
      y: point.y,
      normalized: true,
      pressure: 1,
    })
  }

  async function touchUp(pointerId, position) {
    const point = screenPoint(position)
    await control('touch', {
      action: 'up',
      pointerId,
      x: point.x,
      y: point.y,
      normalized: true,
      pressure: 0,
    })
  }

  async function tap(position, hold = 40) {
    const id = -1
    await touchDown(id, position)
    await new Promise(resolve => setTimeout(resolve, hold))
    await touchUp(id, position)
  }

  async function swipe(position, direction, distance, duration) {
    const vectors = {
      up: [0, -1],
      down: [0, 1],
      left: [-1, 0],
      right: [1, 0],
    }
    const [dx, dy] = vectors[direction] || [0, -1]
    const start = screenPoint(position)
    const end = {
      x: Math.max(0, Math.min(1, start.x + dx * distance)),
      y: Math.max(0, Math.min(1, start.y + dy * distance)),
    }
    const id = -1
    await touchDown(id, start)
    const steps = Math.max(2, Math.round(duration / 16))
    for (let i = 1; i <= steps; i++) {
      await new Promise(resolve => setTimeout(resolve, duration / steps))
      await touchMove(id, {
        x: start.x + (end.x - start.x) * (i / steps),
        y: start.y + (end.y - start.y) * (i / steps),
      })
    }
    await touchUp(id, end)
  }

  async function pinch(deltaY, sensitivity = 1) {
    const center = { x: 0.5, y: 0.5 }
    const offset = 0.08 * sensitivity * Math.sign(deltaY)
    const idA = -2
    const idB = -3
    await touchDown(idA, { x: center.x - 0.08, y: center.y })
    await touchDown(idB, { x: center.x + 0.08, y: center.y })
    const steps = 6
    for (let i = 1; i <= steps; i++) {
      const ratio = i / steps
      await touchMove(idA, { x: center.x - 0.08 - offset * ratio, y: center.y })
      await touchMove(idB, { x: center.x + 0.08 + offset * ratio, y: center.y })
      await new Promise(resolve => setTimeout(resolve, 16))
    }
    await touchUp(idA, { x: center.x - 0.08 - offset, y: center.y })
    await touchUp(idB, { x: center.x + 0.08 + offset, y: center.y })
  }

  async function executeMacro(mapping) {
    const config = mapping?.action?.automationConfig
    const loop = Math.max(1, Number(mapping?.action?.loop) || 1)

    if (config?.scriptId) {
      for (let i = 0; i < loop; i++) {
        try {
          await window.$preload.ipcxRenderer.invoke('workflows:run', { id: config.scriptId })
        }
        catch {}
      }
      return
    }

    const steps = Array.isArray(config?.scriptSteps) ? config.scriptSteps : []
    for (let i = 0; i < loop; i++) {
      for (const step of steps) {
        try {
          await window.$preload.ipcxRenderer.invoke('group:broadcast', {
            deviceIds: [deviceIdRef.value],
            action: step,
          })
        }
        catch {}
        await new Promise(resolve => setTimeout(resolve, 120))
      }
    }
  }

  async function execute(mapping) {
    if (!mapping || mapping.enabled === false)
      return
    const action = mapping.action || {}
    switch (mapping.kind) {
      case 'tap':
        await tap(mapping.position)
        break
      case 'swipe':
        await swipe(mapping.position, action.direction || 'up', Number(action.distance) || 0.12, Number(action.duration) || 160)
        break
      case 'rapidTap': {
        const interval = Math.max(30, Number(action.interval) || 90)
        const timer = setInterval(() => {
          tap(mapping.position, 20)
        }, interval)
        rapidTimers.set(mapping.id, timer)
        break
      }
      case 'macro':
        await executeMacro(mapping)
        break
      default:
        break
    }
  }

  function stopMapping(mapping) {
    const timer = rapidTimers.get(mapping?.id)
    if (timer) {
      clearInterval(timer)
      rapidTimers.delete(mapping.id)
    }
  }

  function findMappingByCombo(combo) {
    if (!activeProfile.value)
      return null
    return activeProfile.value.mappings.find(
      mapping => mapping.enabled !== false && mapping.trigger?.combo === combo,
    ) || null
  }

  function findDirectionMapping(direction) {
    if (!activeProfile.value)
      return null
    return activeProfile.value.mappings.find(
      mapping => mapping.enabled !== false && mapping.kind === 'joystick' && mapping.action?.directions?.[direction]?.combo,
    ) || null
  }

  function handleKeyDown(event) {
    if (mode.value !== 'play' || !activeProfile.value)
      return false

    // Joystick direction keys
    for (const direction of DIRECTIONS) {
      const mapping = findDirectionMapping(direction)
      if (mapping && event.code === mapping.action.directions[direction].code) {
        event.preventDefault()
        updateJoystick(direction, true, mapping)
        return true
      }
    }

    const combo = comboFromEvent(event).combo
    const mapping = findMappingByCombo(combo)
    if (!mapping)
      return false

    event.preventDefault()
    event.stopPropagation()

    if (event.repeat)
      return true

    if (mapping.kind === 'joystick' || mapping.kind === 'scroll' || mapping.kind === 'viewControl')
      return true

    execute(mapping)
    return true
  }

  function handleKeyUp(event) {
    if (mode.value !== 'play')
      return false

    for (const direction of DIRECTIONS) {
      const mapping = findDirectionMapping(direction)
      if (mapping && event.code === mapping.action.directions[direction].code) {
        event.preventDefault()
        updateJoystick(direction, false, mapping)
        return true
      }
    }

    const combo = comboFromEvent(event).combo
    const mapping = findMappingByCombo(combo)
    if (mapping?.kind === 'rapidTap') {
      event.preventDefault()
      stopMapping(mapping)
      return true
    }
    return false
  }

  function updateJoystick(direction, pressed, mapping) {
    const state = joystickState?.mappingId === mapping.id
      ? joystickState
      : { mappingId: mapping.id, held: new Set(), pointerId: -4 }
    if (pressed)
      state.held.add(direction)
    else
      state.held.delete(direction)

    joystickState = state
    const radius = Number(mapping.action.radius) || 0.14
    const center = mapping.position

    if (!state.held.size) {
      const pointerId = state.pointerId
      joystickState = null
      touchMove(pointerId, center)
        .then(() => touchUp(pointerId, center))
      return
    }

    let dx = 0
    let dy = 0
    if (state.held.has('up'))
      dy -= 1
    if (state.held.has('down'))
      dy += 1
    if (state.held.has('left'))
      dx -= 1
    if (state.held.has('right'))
      dx += 1
    const length = Math.hypot(dx, dy) || 1
    const target = {
      x: center.x + (dx / length) * radius,
      y: center.y + (dy / length) * radius,
    }

    if (!state.started) {
      state.started = true
      touchDown(state.pointerId, center).then(() => touchMove(state.pointerId, target))
    }
    else {
      touchMove(state.pointerId, target)
    }
  }

  /** Mouse wheel → pinch zoom while a scroll mapping is enabled. */
  function handleWheel(event) {
    if (mode.value !== 'play' || !activeProfile.value)
      return false
    const mapping = activeProfile.value.mappings.find(
      item => item.enabled !== false && item.kind === 'scroll',
    )
    if (!mapping)
      return false
    event.preventDefault()
    if (scrollState)
      return true
    scrollState = true
    pinch(event.deltaY, Number(mapping.action.sensitivity) || 1).finally(() => {
      scrollState = false
    })
    return true
  }

  function clearRuntime() {
    for (const timer of rapidTimers.values())
      clearInterval(timer)
    rapidTimers.clear()
    joystickState = null
    viewState = null
    scrollState = null
  }

  watch(mode, (value) => {
    if (value !== 'play')
      clearRuntime()
  })

  return {
    profiles,
    activeId,
    activeProfile,
    selectedId,
    selectedMapping,
    mode,
    capturing,
    pendingLabel,
    settings,
    load,
    save,
    create,
    duplicate,
    remove,
    addMapping,
    updateMapping,
    removeMapping,
    importProfiles,
    exportProfiles,
    validateProfile,
    handleKeyDown,
    handleKeyUp,
    handleWheel,
    clearRuntime,
    comboLabel,
  }
}
