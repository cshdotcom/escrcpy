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

  window.$preload.win.open('pages/copilot', {
    title: 'copilot.welcome.title',
    type: 'device',
    device,
    instanceId: device.id,
  })
}
</script>

<style></style>
