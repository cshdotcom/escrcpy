<template>
  <div
    ref="containerRef"
    class="absolute inset-0 z-10"
    :class="mode === 'edit' ? 'pointer-events-auto' : 'pointer-events-none'"
  />
</template>

<script setup>
import Konva from 'konva'

const props = defineProps({
  mappings: { type: Array, default: () => [] },
  mode: { type: String, default: 'off' },
  selectedId: { type: String, default: null },
  videoWidth: { type: Number, default: 1080 },
  videoHeight: { type: Number, default: 1920 },
})

const emit = defineEmits(['select', 'update', 'add'])

const containerRef = ref(null)

let stage = null
let layer = null
let transformer = null
let observer = null

const kindLabels = {
  tap: 'TAP',
  swipe: 'SWIPE',
  rapidTap: 'RAPID',
  scroll: 'SCROLL',
  joystick: 'STICK',
  viewControl: 'VIEW',
  macro: 'MACRO',
}

function nodeRadius(kind) {
  if (kind === 'joystick')
    return 26
  if (kind === 'scroll')
    return 22
  return 20
}

function nodeFill(kind) {
  switch (kind) {
    case 'tap': return 'rgba(59, 130, 246, 0.55)'
    case 'swipe': return 'rgba(16, 185, 129, 0.55)'
    case 'rapidTap': return 'rgba(245, 158, 11, 0.55)'
    case 'scroll': return 'rgba(139, 92, 246, 0.55)'
    case 'joystick': return 'rgba(236, 72, 153, 0.45)'
    case 'viewControl': return 'rgba(20, 184, 166, 0.5)'
    case 'macro': return 'rgba(249, 115, 22, 0.55)'
    default: return 'rgba(148, 163, 184, 0.5)'
  }
}

function ensureStage() {
  if (!containerRef.value)
    return
  if (stage) {
    const rect = containerRef.value.getBoundingClientRect()
    stage.width(Math.max(1, Math.round(rect.width)))
    stage.height(Math.max(1, Math.round(rect.height)))
    draw()
    return
  }

  const rect = containerRef.value.getBoundingClientRect()
  stage = new Konva.Stage({
    container: containerRef.value,
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  })
  layer = new Konva.Layer()
  stage.add(layer)

  transformer = new Konva.Transformer({
    rotateEnabled: false,
    keepRatio: false,
    enabledAnchors: [],
    borderDash: [4, 4],
    borderStroke: '#3b82f6',
  })
  layer.add(transformer)

  stage.on('click', (event) => {
    if (event.target === stage)
      emit('select', null)
  })

  stage.on('contextmenu', (event) => {
    if (props.mode !== 'edit')
      return
    event.evt.preventDefault()
    const pointer = stage.getPointerPosition()
    if (!pointer)
      return
    emit('add', {
      x: pointer.x / stage.width(),
      y: pointer.y / stage.height(),
    })
  })

  draw()
}

function clearNodes() {
  if (!layer)
    return
  layer.find('.mapping-node').forEach((node) => {
    node.destroy()
  })
  transformer?.nodes([])
}

function draw() {
  if (!stage || !layer)
    return
  clearNodes()

  const width = stage.width()
  const height = stage.height()
  const editing = props.mode === 'edit'

  props.mappings.forEach((mapping) => {
    if (mapping.kind === 'joystick' || mapping.kind === 'viewControl') {
      drawRegion(mapping, width, height, editing)
      return
    }
    const x = (Number(mapping.position?.x) || 0) * width
    const y = (Number(mapping.position?.y) || 0) * height
    const radius = nodeRadius(mapping.kind)
    const group = new Konva.Group({
      id: mapping.id,
      name: 'mapping-node',
      x,
      y,
      draggable: editing,
    })

    const shape = new Konva.Circle({
      radius,
      fill: nodeFill(mapping.kind),
      stroke: props.selectedId === mapping.id ? '#ffffff' : 'rgba(255,255,255,0.55)',
      strokeWidth: props.selectedId === mapping.id ? 3 : 1.5,
      shadowColor: 'black',
      shadowBlur: 8,
      shadowOpacity: 0.5,
    })
    group.add(shape)

    const label = mapping.trigger?.combo || kindLabels[mapping.kind] || mapping.kind
    const text = new Konva.Text({
      text: String(label).slice(0, 10),
      fontSize: 11,
      fontStyle: 'bold',
      fill: '#ffffff',
      align: 'center',
    })
    text.position({ x: -text.width() / 2, y: -text.height() / 2 })
    group.add(text)

    group.on('click', (event) => {
      event.cancelBubble = true
      emit('select', mapping.id)
    })
    group.on('dragend', () => {
      emit('update', {
        id: mapping.id,
        position: {
          x: Math.max(0, Math.min(1, group.x() / width)),
          y: Math.max(0, Math.min(1, group.y() / height)),
        },
      })
    })

    layer.add(group)

    if (props.selectedId === mapping.id)
      transformer.nodes([group])
  })

  layer.draw()
}

function drawRegion(mapping, width, height, editing) {
  const x = (Number(mapping.position?.x) || 0) * width
  const y = (Number(mapping.position?.y) || 0) * height
  const radius = (Number(mapping.action?.radius) || 0.14) * Math.min(width, height)

  const group = new Konva.Group({
    id: mapping.id,
    name: 'mapping-node',
    x,
    y,
    draggable: editing,
  })

  const ring = new Konva.Ring({
    innerRadius: Math.max(4, radius - 3),
    outerRadius: radius,
    fill: nodeFill(mapping.kind),
    stroke: props.selectedId === mapping.id ? '#ffffff' : 'rgba(255,255,255,0.4)',
    strokeWidth: props.selectedId === mapping.id ? 3 : 1,
  })
  group.add(ring)

  const text = new Konva.Text({
    text: kindLabels[mapping.kind] || mapping.kind,
    fontSize: 10,
    fontStyle: 'bold',
    fill: '#ffffff',
    align: 'center',
  })
  text.position({ x: -text.width() / 2, y: -text.height() / 2 })
  group.add(text)

  group.on('click', (event) => {
    event.cancelBubble = true
    emit('select', mapping.id)
  })
  group.on('dragend', () => {
    emit('update', {
      id: mapping.id,
      position: {
        x: Math.max(0, Math.min(1, group.x() / width)),
        y: Math.max(0, Math.min(1, group.y() / height)),
      },
    })
  })

  layer.add(group)

  if (props.selectedId === mapping.id)
    transformer.nodes([group])
}

onMounted(() => {
  ensureStage()
  observer = new ResizeObserver(() => ensureStage())
  observer.observe(containerRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  stage?.destroy()
  stage = null
  layer = null
  transformer = null
})

watch(
  () => [props.mappings, props.selectedId, props.mode],
  () => draw(),
  { deep: true },
)
</script>
