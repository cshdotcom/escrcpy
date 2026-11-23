/**
 * Unit tests for the embedded mirror protocol + keyboard mapping engine.
 * Run: node --test tests/unit/mirror.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { ANDROID_KEYCODE, FrameStreamParser, encodeControlMessage } from '../../desktop/electron/modules/mirror/protocol.js'
import { comboFromEvent, createMapping, createProfile, validateMapping, validateProfile } from '../../desktop/pages/mirror/composables/use-keyboard-mapping.js'

function makeHeader(flags, pts, length) {
  const buffer = Buffer.alloc(12)
  buffer.writeUInt8(flags, 0)
  buffer.writeBigInt64BE(BigInt(pts), 0)
  buffer[0] = flags
  buffer.writeUInt32BE(length, 8)
  return buffer
}

test('FrameStreamParser: data packet with keyframe flag', () => {
  const packets = []
  const parser = new FrameStreamParser(packet => packets.push(packet))
  const payload = Buffer.from([1, 2, 3, 4])
  const header = makeHeader(0x20, 1234, payload.length)
  parser.push(Buffer.concat([header, payload]))

  assert.equal(packets.length, 1)
  assert.equal(packets[0].type, 'data')
  assert.equal(packets[0].keyframe, true)
  assert.equal(packets[0].pts, 1234n)
  assert.deepEqual([...packets[0].data], [1, 2, 3, 4])
})

test('FrameStreamParser: session packet carries width/height', () => {
  const packets = []
  const parser = new FrameStreamParser(packet => packets.push(packet))
  const header = Buffer.alloc(12)
  header[0] = 0x80
  header.writeUInt32BE(720, 4)
  header.writeUInt32BE(1280, 8)
  parser.push(header)

  assert.equal(packets.length, 1)
  assert.equal(packets[0].type, 'session')
  assert.equal(packets[0].width, 720)
  assert.equal(packets[0].height, 1280)
})

test('FrameStreamParser: configuration packet payload', () => {
  const packets = []
  const parser = new FrameStreamParser(packet => packets.push(packet))
  const config = Buffer.from([9, 8, 7])
  const header = makeHeader(0x40, 0, config.length)
  parser.push(Buffer.concat([header, config]))

  assert.equal(packets[0].type, 'configuration')
  assert.deepEqual([...packets[0].data], [9, 8, 7])
})

test('FrameStreamParser: handles chunked delivery and multiple packets', () => {
  const packets = []
  const parser = new FrameStreamParser(packet => packets.push(packet))
  const first = Buffer.concat([makeHeader(0, 10, 2), Buffer.from([1, 1])])
  const second = Buffer.concat([makeHeader(0x20, 20, 3), Buffer.from([2, 2, 2])])
  const stream = Buffer.concat([first, second])

  parser.push(stream.subarray(0, 5))
  assert.equal(packets.length, 0)
  parser.push(stream.subarray(5, 17))
  assert.equal(packets.length, 1)
  parser.push(stream.subarray(17))
  assert.equal(packets.length, 2)
  assert.equal(packets[1].keyframe, true)
})

test('FrameStreamParser: rejects absurd frame length', () => {
  const parser = new FrameStreamParser(() => {})
  const header = makeHeader(0, 0, 100 * 1024 * 1024)
  assert.throws(() => parser.push(header), /Invalid frame length/)
})

test('encodeControlMessage: touch event is 32 bytes with big-endian fields', () => {
  const buffer = encodeControlMessage({
    type: 2,
    action: 'down',
    pointerId: -1,
    x: 100,
    y: 200,
    videoWidth: 720,
    videoHeight: 1280,
    pressure: 1,
  })
  assert.equal(buffer.length, 32)
  assert.equal(buffer.readUInt8(0), 2)
  assert.equal(buffer.readUInt8(1), 0)
  assert.equal(buffer.readBigInt64BE(2), -1n)
  assert.equal(buffer.readUInt32BE(10), 100)
  assert.equal(buffer.readUInt32BE(14), 200)
  assert.equal(buffer.readUInt16BE(18), 720)
  assert.equal(buffer.readUInt16BE(20), 1280)
  assert.equal(buffer.readUInt16BE(22), 65535)
})

test('encodeControlMessage: key event is 14 bytes', () => {
  const buffer = encodeControlMessage({ type: 0, action: 'up', keyCode: 4, metaState: 0 })
  assert.equal(buffer.length, 14)
  assert.equal(buffer.readUInt8(0), 0)
  assert.equal(buffer.readUInt8(1), 1)
  assert.equal(buffer.readInt32BE(2), ANDROID_KEYCODE.BACK)
})

test('encodeControlMessage: text uses utf8 bytes', () => {
  const buffer = encodeControlMessage({ type: 1, text: '你好' })
  assert.equal(buffer.readUInt8(0), 1)
  assert.equal(buffer.readUInt32BE(1), Buffer.byteLength('你好'))
  assert.equal(buffer.subarray(5).toString('utf8'), '你好')
})

test('encodeControlMessage: scroll and panel commands', () => {
  const scroll = encodeControlMessage({ type: 3, x: 1, y: 2, videoWidth: 720, videoHeight: 1280, scrollX: 0.5, scrollY: -0.5 })
  assert.equal(scroll.length, 21)
  assert.equal(scroll.readUInt8(0), 3)

  assert.deepEqual([...encodeControlMessage({ type: 5 })], [5])
  assert.deepEqual([...encodeControlMessage({ type: 7 })], [7])
  assert.deepEqual([...encodeControlMessage({ type: 10, on: false })], [10, 0])
})

test('keyboard mapping: defaults are valid', () => {
  const mapping = createMapping('tap', { x: 0.5, y: 0.5 })
  mapping.trigger = comboFromEvent({ code: 'KeyA', key: 'a', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })
  assert.equal(mapping.kind, 'tap')
  assert.deepEqual(validateMapping(mapping), [])
})

test('keyboard mapping: missing trigger is reported', () => {
  const mapping = createMapping('tap')
  assert.ok(validateMapping(mapping).includes('keyboard.mapping.validation.trigger'))
})

test('keyboard mapping: joystick needs four directions', () => {
  const mapping = createMapping('joystick')
  const errors = validateMapping(mapping)
  assert.ok(errors.includes('keyboard.mapping.validation.joystickDirections'))
})

test('keyboard mapping: duplicate triggers conflict at profile level', () => {
  const profile = createProfile('test')
  const a = createMapping('tap')
  const b = createMapping('swipe')
  a.trigger = { combo: 'KeyA' }
  b.trigger = { combo: 'KeyA' }
  profile.mappings.push(a, b)
  assert.ok(validateProfile(profile).includes('keyboard.mapping.validation.triggerConflict'))
})

test('keyboard mapping: comboFromEvent builds modifiers + key', () => {
  const combo = comboFromEvent({ code: 'Digit1', key: '1', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })
  assert.equal(combo.combo, 'Ctrl+1')
})
