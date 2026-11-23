/**
 * WebCodecs video + audio pipeline for the embedded mirror window.
 *
 * The main process streams raw scrcpy packets (H.264/H.265/AV1 + Opus); this
 * composable decodes them with WebCodecs and renders to a <video> element via
 * MediaStreamTrackGenerator (falling back to a <canvas> when unavailable).
 */
const CODEC_STRINGS = {
  h264: 'avc1.4d001f',
  h265: 'hev1.1.6.L93.B0',
  av01: 'av01.0.01M.08',
}

const AUDIO_CODECS = {
  opus: 'opus',
  aac: 'mp4a.40.2',
  raw: 'pcm-s16',
}

export function useMirrorStream(deviceIdRef, optionsRef = ref({})) {
  const videoRef = ref(null)
  const canvasRef = ref(null)
  const status = ref('idle')
  const error = ref('')
  const codec = ref('h264')
  const audioCodec = ref('')
  const mode = ref('video')
  const size = reactive({ width: 1080, height: 1920 })
  const stats = reactive({
    fps: 0,
    packets: 0,
    keyframes: 0,
    dropped: 0,
    bitrate: 0,
    audioPackets: 0,
  })

  let decoder = null
  let writer = null
  let track = null
  let configBuffer = null
  let awaitingKeyframe = true
  let frameCount = 0
  let lastFpsAt = 0
  let bytesInWindow = 0
  let fpsTimer = null
  let unsubscribe = null
  let stopped = false

  // audio
  let audioDecoder = null
  let audioContext = null
  let audioGain = null
  let nextAudioTime = 0
  let audioConfig = null

  const invoke = (channel, payload) => window.$preload.ipcxRenderer.invoke(channel, payload)

  function resetDecoder() {
    try {
      decoder?.close()
    }
    catch {}
    decoder = null
    configBuffer = null
    awaitingKeyframe = true
  }

  function resetAudio() {
    try {
      audioDecoder?.close()
    }
    catch {}
    audioDecoder = null
    audioConfig = null
    if (audioContext) {
      audioContext.close().catch(() => {})
      audioContext = null
      audioGain = null
    }
  }

  function createWriter() {
    const Generator = globalThis.MediaStreamTrackGenerator
    if (!Generator || !(videoRef.value instanceof HTMLVideoElement))
      return null
    const newTrack = new Generator({ kind: 'video' })
    videoRef.value.srcObject = new MediaStream([newTrack])
    return newTrack.writable.getWriter()
  }

  function configureDecoder(codecName) {
    const codecString = CODEC_STRINGS[codecName] || CODEC_STRINGS.h264
    decoder?.close()
    decoder = new VideoDecoder({
      output: (frame) => {
        if (writer) {
          writer.write(frame).catch(() => {
            try {
              frame.close()
            }
            catch {}
          })
        }
        else if (canvasRef.value) {
          const ctx = canvasRef.value.getContext('2d')
          if (ctx) {
            canvasRef.value.width = frame.displayWidth
            canvasRef.value.height = frame.displayHeight
            ctx.drawImage(frame, 0, 0)
          }
          frame.close()
        }
        else {
          frame.close()
        }
        frameCount += 1
      },
      error: (decoderError) => {
        console.error('[Mirror] VideoDecoder error:', decoderError)
        error.value = decoderError?.message || 'Video decoder error'
        resetDecoder()
        requestKeyframe()
      },
    })
    decoder.configure({ codec: codecString, optimizeForLatency: true })
    awaitingKeyframe = true
  }

  function requestKeyframe() {
    invoke('mirror:reset-video', { deviceId: deviceIdRef.value }).catch(() => {})
  }

  function handleVideoEvent(event) {
    if (event.type === 'session') {
      size.width = event.width || size.width
      size.height = event.height || size.height
      resetDecoder()
      configureDecoder(codec.value)
      return
    }
    if (event.type === 'configuration') {
      configBuffer = event.data ? new Uint8Array(event.data) : null
      return
    }
    if (event.type !== 'data')
      return

    if (!decoder)
      return

    if (awaitingKeyframe && !event.keyframe) {
      stats.dropped += 1
      if (stats.dropped === 1)
        requestKeyframe()
      return
    }

    if (decoder.decodeQueueSize > 8) {
      stats.dropped += 1
      awaitingKeyframe = true
      requestKeyframe()
      return
    }

    let data = new Uint8Array(event.data)
    if (event.keyframe && configBuffer?.length) {
      const merged = new Uint8Array(configBuffer.length + data.length)
      merged.set(configBuffer, 0)
      merged.set(data, configBuffer.length)
      data = merged
      configBuffer = null
    }

    try {
      decoder.decode(new EncodedVideoChunk({
        type: event.keyframe ? 'key' : 'delta',
        timestamp: Number(event.pts || 0),
        data,
      }))
      awaitingKeyframe = false
      stats.packets += 1
      if (event.keyframe)
        stats.keyframes += 1
      bytesInWindow += data.byteLength
    }
    catch (decodeError) {
      console.warn('[Mirror] decode failed:', decodeError?.message ?? decodeError)
      stats.dropped += 1
      awaitingKeyframe = true
    }
  }

  function ensureAudio() {
    if (audioContext)
      return true
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Ctx)
      return false
    audioContext = new Ctx({ latencyHint: 'interactive' })
    audioGain = audioContext.createGain()
    audioGain.connect(audioContext.destination)
    return true
  }

  function handleAudioEvent(event) {
    if (!ensureAudio()) {
      if (event.type === 'configuration' || event.type === 'data')
        return
    }

    if (event.type === 'configuration') {
      audioConfig = event.data ? new Uint8Array(event.data) : null
      try {
        audioDecoder?.close()
      }
      catch {}
      audioDecoder = new AudioDecoder({
        output: (buffer) => {
          if (!audioContext || !audioGain)
            return
          const source = audioContext.createBufferSource()
          source.buffer = buffer
          source.connect(audioGain)
          const startAt = Math.max(audioContext.currentTime + 0.02, nextAudioTime)
          source.start(startAt)
          nextAudioTime = startAt + buffer.duration
          stats.audioPackets += 1
        },
        error: (audioError) => {
          console.warn('[Mirror] AudioDecoder error:', audioError?.message ?? audioError)
          try {
            audioDecoder?.close()
          }
          catch {}
          audioDecoder = null
        },
      })
      const name = audioCodec.value || 'opus'
      audioDecoder.configure({
        codec: AUDIO_CODECS[name] || 'opus',
        sampleRate: 48000,
        numberOfChannels: 2,
        description: audioConfig || new Uint8Array(),
      })
      return
    }

    if (event.type !== 'data' || !audioDecoder)
      return

    try {
      audioDecoder.decode(new EncodedAudioChunk({
        type: event.keyframe ? 'key' : 'delta',
        timestamp: Number(event.pts || 0),
        data: new Uint8Array(event.data),
      }))
    }
    catch {}
  }

  function handleEvent(_event, payload) {
    if (!payload || payload.deviceId !== deviceIdRef.value)
      return

    switch (payload.type) {
      case 'metadata':
        size.width = payload.width || size.width
        size.height = payload.height || size.height
        if (payload.codec)
          codec.value = payload.codec
        break
      case 'audio-disabled':
        resetAudio()
        break
      case 'close':
        status.value = 'disconnected'
        resetDecoder()
        resetAudio()
        break
      case 'error':
        error.value = payload.message || 'Mirror error'
        status.value = 'error'
        break
      case 'device-clipboard':
        if (payload.text && navigator.clipboard?.writeText)
          navigator.clipboard.writeText(payload.text).catch(() => {})
        break
      default:
        break
    }

    if (payload.stream === 'video')
      handleVideoEvent(payload)
    else if (payload.stream === 'audio')
      handleAudioEvent(payload)
  }

  function startStats() {
    stopStats()
    lastFpsAt = performance.now()
    bytesInWindow = 0
    fpsTimer = setInterval(() => {
      const now = performance.now()
      const elapsed = Math.max(1, now - lastFpsAt) / 1000
      stats.fps = Math.round((frameCount - (stats._lastFrames || 0)) / elapsed)
      stats._lastFrames = frameCount
      stats.bitrate = Math.round((bytesInWindow * 8) / elapsed / 1000)
      bytesInWindow = 0
      lastFpsAt = now
    }, 1000)
  }

  function stopStats() {
    if (fpsTimer) {
      clearInterval(fpsTimer)
      fpsTimer = null
    }
  }

  async function start(extraOptions = {}) {
    const deviceId = deviceIdRef.value
    if (!deviceId)
      return { success: false, error: { message: 'No device' } }

    await stop()
    stopped = false
    status.value = 'connecting'
    error.value = ''

    const Generator = globalThis.MediaStreamTrackGenerator
    mode.value = Generator ? 'video' : 'canvas'

    const result = await invoke('mirror:start', {
      deviceId,
      options: { ...toValue(optionsRef), ...extraOptions },
    })

    if (!result?.success) {
      status.value = 'error'
      error.value = result?.error?.message || 'Failed to start mirror'
      return result
    }

    size.width = result.width || size.width
    size.height = result.height || size.height
    codec.value = result.codec || codec.value
    audioCodec.value = extraOptions.audioCodec || toValue(optionsRef).audioCodec || 'opus'

    await nextTick()

    if (mode.value === 'video')
      writer = createWriter()
    if (!writer)
      mode.value = 'canvas'

    configureDecoder(codec.value)
    unsubscribe?.()
    unsubscribe = window.$preload.ipcRenderer.on('mirror:event', handleEvent)
    status.value = 'connected'
    startStats()
    requestKeyframe()
    return result
  }

  async function stop() {
    stopped = true
    unsubscribe?.()
    unsubscribe = null
    resetDecoder()
    resetAudio()
    stopStats()
    if (writer) {
      try {
        await writer.close()
      }
      catch {}
      writer = null
    }
    if (videoRef.value)
      videoRef.value.srcObject = null
    if (track) {
      try {
        track.stop()
      }
      catch {}
      track = null
    }
    await invoke('mirror:stop', { deviceId: deviceIdRef.value }).catch(() => {})
    status.value = 'idle'
  }

  async function reconnect(options) {
    return start(options)
  }

  function setVolume(value) {
    if (audioGain)
      audioGain.gain.value = Math.max(0, Math.min(1, Number(value) || 0))
  }

  onBeforeUnmount(() => {
    stop()
  })

  return {
    videoRef,
    canvasRef,
    status,
    error,
    codec,
    audioCodec,
    mode,
    size,
    stats,
    start,
    stop,
    reconnect,
    setVolume,
  }
}
