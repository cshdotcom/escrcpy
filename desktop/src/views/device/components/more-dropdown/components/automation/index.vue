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
    default: () => false,
  },
})

const loading = ref(false)

function handleClick() {
  props.toggleRowExpansion(props.row, true)

  window.$preload.win.open('pages/automation', {
    instanceId: `automation:${props.row.id}`,
    device: toRaw(props.row),
    title: 'automation.name',
    type: 'automation',
  })
}
</script>

<style></style>
