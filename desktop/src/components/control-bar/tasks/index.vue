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
  // silently doing nothing — this is the most common reason users report the
  // "task icon does nothing when clicked".
  if (!device.id) {
    ElMessage.warning(window.$preload.i18n.t('tasks.noDeviceSelected'))
    return
  }

  try {
    const result = window.$preload.win.open('pages/tasks', {
      title: 'tasks.name',
      type: 'device',
      device,
      instanceId: device.id,
    })

    // Some hosts return a thenable; surface failures so the user knows.
    if (result && typeof result.then === 'function') {
      result.catch((error) => {
        console.error('[Tasks] failed to open tasks window:', error)
        ElMessage.error(error?.message || window.$preload.i18n.t('tasks.openFailed'))
      })
    }
  }
  catch (error) {
    console.error('[Tasks] trigger failed:', error)
    ElMessage.error(error?.message || window.$preload.i18n.t('tasks.openFailed'))
  }
}
</script>

<style></style>
