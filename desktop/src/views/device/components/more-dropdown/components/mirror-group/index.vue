<template>
  <slot :loading="loading" :trigger="handleClick" />
</template>

<script setup>
defineOptions({
  inheritAttrs: false,
})

const props = defineProps({
  row: {
    type: Object,
    default: () => ({}),
  },
  toggleRowExpansion: {
    type: Function,
    default: () => () => false,
  },
})

const loading = ref(false)

function openMirror(displayId, displayLabel = '', delay = 0) {
  setTimeout(() => {
    window.$preload.win.open('pages/mirror', {
      instanceId: `mirror:${props.row.id}:${displayId}`,
      device: toRaw(props.row),
      query: { displayId, displayLabel },
      title: 'device.control.mirror-group.name',
      type: 'mirror',
    })
  }, delay)
}

/** 多屏协同: open one embedded mirror window per display of the device. */
async function handleClick() {
  props.toggleRowExpansion(props.row, true)
  loading.value = true

  let displays = []
  try {
    const result = await window.$preload.ipcxRenderer.invoke('mirror:displays', { deviceId: props.row.id })
    displays = result?.displays || []
  }
  catch {}

  loading.value = false

  if (!displays.length) {
    openMirror(0, '')
    return
  }

  displays.slice(0, 4).forEach((display, index) => {
    openMirror(display.id, display.resolution || '', index * 250)
  })
}
</script>

<style></style>
