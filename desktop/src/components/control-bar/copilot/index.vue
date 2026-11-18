<template>
  <slot :trigger="handleTrigger" />
</template>

<script setup>
const props = defineProps({
  device: {
    type: Object,
    default: () => ({}),
  },
  floating: {
    type: Boolean,
    default: false,
  },
})

function handleTrigger() {
  const device = toRaw(props.device ?? {})

  // Defensive: if no device id is available, surface a warning instead of
  // silently doing nothing — same pattern as the Tasks trigger.
  if (!device.id) {
    ElMessage.warning(window.$preload.i18n.t('copilot.noDeviceHint'))
    return
  }

  try {
    const result = window.$preload.win.open('pages/copilot', {
      title: 'copilot.welcome.title',
      type: 'device',
      device,
      instanceId: device.id,
    })

    if (result && typeof result.then === 'function') {
      result.catch((error) => {
        console.error('[Copilot] failed to open copilot window:', error)
        ElMessage.error(error?.message || window.$preload.i18n.t('copilot.openFailed'))
      })
    }
  }
  catch (error) {
    console.error('[Copilot] trigger failed:', error)
    ElMessage.error(error?.message || window.$preload.i18n.t('copilot.openFailed'))
  }
}
</script>

<style></style>
