/**
 * DOM keyboard → Android KeyEvent mapping.
 *
 * scrcpy injects Android `KeyEvent`s, so a physical key on the PC has to be
 * translated into an Android key code (+ meta state) rather than a character.
 * Text input (Chinese, emoji, …) is injected as text instead — see injectText.
 */

const CODE_TO_KEYCODE = {
  Backquote: 68,
  Minus: 69,
  Equal: 70,
  Backspace: 67,
  Tab: 61,
  Enter: 66,
  NumpadEnter: 66,
  ShiftLeft: 59,
  ShiftRight: 60,
  ControlLeft: 113,
  ControlRight: 114,
  AltLeft: 57,
  AltRight: 58,
  MetaLeft: 117,
  MetaRight: 118,
  CapsLock: 115,
  Escape: 111,
  Space: 62,
  PageUp: 92,
  PageDown: 93,
  End: 123,
  Home: 122,
  ArrowLeft: 21,
  ArrowUp: 19,
  ArrowRight: 22,
  ArrowDown: 20,
  Delete: 112,
  Insert: 124,
  Digit0: 7,
  Digit1: 8,
  Digit2: 9,
  Digit3: 10,
  Digit4: 11,
  Digit5: 12,
  Digit6: 13,
  Digit7: 14,
  Digit8: 15,
  Digit9: 16,
  KeyA: 29,
  KeyB: 30,
  KeyC: 31,
  KeyD: 32,
  KeyE: 33,
  KeyF: 34,
  KeyG: 35,
  KeyH: 36,
  KeyI: 37,
  KeyJ: 38,
  KeyK: 39,
  KeyL: 40,
  KeyM: 41,
  KeyN: 42,
  KeyO: 43,
  KeyP: 44,
  KeyQ: 45,
  KeyR: 46,
  KeyS: 47,
  KeyT: 48,
  KeyU: 49,
  KeyV: 50,
  KeyW: 51,
  KeyX: 52,
  KeyY: 53,
  KeyZ: 54,
  Comma: 55,
  Period: 56,
  Slash: 76,
  Semicolon: 74,
  Quote: 75,
  BracketLeft: 71,
  BracketRight: 72,
  Backslash: 73,
  Numpad0: 144,
  Numpad1: 145,
  Numpad2: 146,
  Numpad3: 147,
  Numpad4: 148,
  Numpad5: 149,
  Numpad6: 150,
  Numpad7: 151,
  Numpad8: 152,
  Numpad9: 153,
  NumpadAdd: 157,
  NumpadSubtract: 156,
  NumpadMultiply: 155,
  NumpadDivide: 154,
  NumpadDecimal: 158,
  VolumeUp: 24,
  VolumeDown: 25,
  MediaPlayPause: 85,
  MediaStop: 86,
  MediaTrackNext: 87,
  MediaTrackPrevious: 88,
  F1: 131,
  F2: 132,
  F3: 133,
  F4: 134,
  F5: 135,
  F6: 136,
  F7: 137,
  F8: 138,
  F9: 139,
  F10: 140,
  F11: 141,
  F12: 142,
}

export const ANDROID_META = {
  shift: 1,
  alt: 2,
  ctrl: 4096,
  meta: 65536,
  capsLock: 1048576,
}

export function metaStateFromEvent(event) {
  let state = 0
  if (event.shiftKey)
    state |= ANDROID_META.shift
  if (event.altKey)
    state |= ANDROID_META.alt
  if (event.ctrlKey)
    state |= ANDROID_META.ctrl
  if (event.metaKey)
    state |= ANDROID_META.meta
  if (event.getModifierState?.('CapsLock'))
    state |= ANDROID_META.capsLock
  return state
}

export function keyCodeFromEvent(event) {
  const code = event.code || ''
  if (CODE_TO_KEYCODE[code])
    return { keyCode: CODE_TO_KEYCODE[code], metaState: metaStateFromEvent(event) }
  return null
}

/** Keys that must never be captured (window management). */
export function isReservedKey(event) {
  if (event.code === 'F11' || event.code === 'F12')
    return true
  if (event.code === 'Escape')
    return false
  if (event.key === 'F5')
    return true
  return false
}

export function isTextInputEvent(event) {
  if (event.ctrlKey || event.metaKey || event.altKey)
    return false
  return Boolean(event.key && event.key.length === 1)
}

/** Build a stable, human readable id for a key combination. */
export function comboLabel(event) {
  const parts = []
  if (event.ctrlKey)
    parts.push('Ctrl')
  if (event.altKey)
    parts.push('Alt')
  if (event.shiftKey)
    parts.push('Shift')
  if (event.metaKey)
    parts.push('Meta')
  const key = event.code?.startsWith('Key')
    ? event.code.slice(3)
    : event.code?.startsWith('Digit')
      ? event.code.slice(5)
      : event.key === ' ' ? 'Space' : event.code
  if (key)
    parts.push(key)
  return parts.join('+')
}
