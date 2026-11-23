/**
 * Pure scrcpy protocol helpers (no Electron imports) — unit-testable with node.
 */
const PTS_MASK = 0x1FFFFFFFFFFFFFn

export const ANDROID_KEYCODE = {
  BACK: 4,
  HOME: 3,
  APP_SWITCH: 187,
  MENU: 82,
  ENTER: 66,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  CAMERA: 27,
  SPACE: 62,
  DEL: 67,
  TAB: 61,
  ESCAPE: 111,
  SHIFT_LEFT: 59,
  SHIFT_RIGHT: 60,
  ALT_LEFT: 57,
  ALT_RIGHT: 58,
  CTRL_LEFT: 113,
  CTRL_RIGHT: 114,
  META_LEFT: 117,
  META_RIGHT: 118,
  CAPS_LOCK: 115,
  MOVE_HOME: 122,
  MOVE_END: 123,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  INSERT: 124,
  FORWARD_DEL: 112,
}

export const META_STATE = {
  None: 0,
  Shift: 1,
  Alt: 2,
  Ctrl: 4096,
  Meta: 65536,
  CapsLock: 1048576,
  NumLock: 2097152,
  ScrollLock: 4194304,
}

function encodePressure(value) {
  const pressure = Math.max(-1, Math.min(1, Number(value) || 0))
  return pressure === 1 ? 65535 : Math.round(pressure * 65536)
}

function writeInt16BE(buffer, value, offset) {
  buffer.writeInt16BE(Math.max(-32768, Math.min(32767, Math.round(value))), offset)
}

/** Build a scrcpy control message (binary). */
export function encodeControlMessage(message) {
  const type = Number(message.type)
  switch (type) {
    case 0: {
      // InjectKeyCode
      const buffer = Buffer.alloc(14)
      buffer.writeUInt8(0, 0)
      buffer.writeUInt8(message.action === 'up' || message.action === 1 ? 1 : 0, 1)
      buffer.writeInt32BE(Number(message.keyCode) || 0, 2)
      buffer.writeInt32BE(Number(message.repeat) || 0, 6)
      buffer.writeUInt32BE(Number(message.metaState) || 0, 10)
      return buffer
    }
    case 1: {
      // InjectText
      const text = Buffer.from(String(message.text ?? ''), 'utf8')
      const buffer = Buffer.alloc(5 + text.length)
      buffer.writeUInt8(1, 0)
      buffer.writeUInt32BE(text.length, 1)
      text.copy(buffer, 5)
      return buffer
    }
    case 2: {
      // InjectTouchEvent
      const buffer = Buffer.alloc(32)
      buffer.writeUInt8(2, 0)
      buffer.writeUInt8(
        message.action === 'up' || message.action === 1 ? 1 : 0,
        1,
      )
      buffer.writeBigInt64BE(BigInt(message.pointerId ?? -1), 2)
      buffer.writeUInt32BE(Math.max(0, Number(message.x) || 0), 10)
      buffer.writeUInt32BE(Math.max(0, Number(message.y) || 0), 14)
      buffer.writeUInt16BE(Math.max(1, Number(message.videoWidth) || 1), 18)
      buffer.writeUInt16BE(Math.max(1, Number(message.videoHeight) || 1), 20)
      buffer.writeUInt16BE(Math.max(0, Math.min(65535, encodePressure(message.pressure ?? 1))), 22)
      buffer.writeUInt32BE(Number(message.actionButton) || 0, 24)
      buffer.writeUInt32BE(Number(message.buttons) || 0, 28)
      return buffer
    }
    case 3: {
      // InjectScroll
      const buffer = Buffer.alloc(21)
      buffer.writeUInt8(3, 0)
      buffer.writeInt32BE(Math.round(Number(message.x) || 0), 1)
      buffer.writeInt32BE(Math.round(Number(message.y) || 0), 5)
      buffer.writeUInt16BE(Math.max(1, Number(message.videoWidth) || 1), 9)
      buffer.writeUInt16BE(Math.max(1, Number(message.videoHeight) || 1), 11)
      writeInt16BE(buffer, (Number(message.scrollX) || 0) * 32768, 13)
      writeInt16BE(buffer, (Number(message.scrollY) || 0) * 32768, 15)
      buffer.writeUInt32BE(Number(message.buttons) || 0, 17)
      return buffer
    }
    case 4: {
      // BackOrScreenOn
      const buffer = Buffer.alloc(2)
      buffer.writeUInt8(4, 0)
      buffer.writeUInt8(message.action === 'up' ? 1 : 0, 1)
      return buffer
    }
    case 5:
    case 6:
    case 7:
    case 11:
      return Buffer.from([type])
    case 9: {
      // SetClipboard
      const text = Buffer.from(String(message.text ?? ''), 'utf8')
      const buffer = Buffer.alloc(14 + text.length)
      buffer.writeUInt8(9, 0)
      buffer.writeBigInt64BE(BigInt(message.sequence ?? 0), 1)
      buffer.writeUInt8(message.paste ? 1 : 0, 9)
      buffer.writeUInt32BE(text.length, 10)
      text.copy(buffer, 14)
      return buffer
    }
    case 10: {
      // SetDisplayPower
      return Buffer.from([10, message.on === false ? 0 : 1])
    }
    default:
      throw new Error(`Unsupported control message type: ${type}`)
  }
}

/**
 * Incremental parser for the scrcpy frame stream (12-byte headers).
 * Emits "session" / "configuration" / "data" packets.
 */
export class FrameStreamParser {
  constructor(onPacket) {
    this.buffer = Buffer.alloc(0)
    this.onPacket = onPacket
  }

  push(chunk) {
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : Buffer.from(chunk)
    this.drain()
  }

  drain() {
    while (this.buffer.length >= 12) {
      const header = this.buffer
      const flags = header[0]
      const length = header.readUInt32BE(8)

      if (flags & 0x80) {
        const width = header.readUInt32BE(4)
        const height = header.readUInt32BE(8)
        this.buffer = header.subarray(12)
        this.onPacket({ type: 'session', width, height })
        continue
      }

      if (flags & 0x40) {
        if (header.length < 12 + length)
          return
        const data = Buffer.from(header.subarray(12, 12 + length))
        this.buffer = header.subarray(12 + length)
        this.onPacket({ type: 'configuration', data })
        continue
      }

      if (length > 64 * 1024 * 1024)
        throw new Error(`Invalid frame length: ${length}`)

      if (header.length < 12 + length)
        return

      const pts = header.readBigInt64BE(0) & PTS_MASK
      const data = Buffer.from(header.subarray(12, 12 + length))
      this.buffer = header.subarray(12 + length)
      this.onPacket({
        type: 'data',
        keyframe: Boolean(flags & 0x20),
        pts,
        data,
      })
    }
  }
}
