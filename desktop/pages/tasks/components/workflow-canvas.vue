<template>
  <div class="relative w-full h-full bg-gray-50 dark:bg-gray-900/60 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
    <div ref="containerRef" class="absolute inset-0" />

    <!-- toolbar -->
    <div class="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90 px-1 py-1 shadow-sm backdrop-blur">
      <el-button-group size="small">
        <el-button size="small" text :title="$t('tasks.workflow.canvas.zoomOut')" @click="zoomBy(-0.15)">
          −
        </el-button>
        <el-button size="small" text class="!w-14" @click="resetView">
          {{ Math.round(scale * 100) }}%
        </el-button>
        <el-button size="small" text :title="$t('tasks.workflow.canvas.zoomIn')" @click="zoomBy(0.15)">
          +
        </el-button>
      </el-button-group>

      <el-button size="small" text :title="$t('tasks.workflow.canvas.fit')" @click="fitView">
        <el-icon><ElIconFullScreen /></el-icon>
      </el-button>

      <el-button size="small" text :title="$t('tasks.workflow.canvas.autoLayout')" @click="autoLayout">
        <el-icon><ElIconSort /></el-icon>
      </el-button>
    </div>

    <!-- legend / hint -->
    <div class="absolute bottom-2 left-2 z-10 text-[11px] text-gray-400 dark:text-gray-500 bg-white/70 dark:bg-gray-900/70 px-2 py-1 rounded">
      {{ $t('tasks.workflow.canvas.hint') }}
    </div>

    <!-- empty state -->
    <div
      v-if="!steps.length"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none"
    >
      <el-icon class="text-3xl text-gray-300">
        <ElIconConnection />
      </el-icon>
      <span class="text-xs text-gray-400">{{ $t('tasks.workflow.empty.noSteps') }}</span>
    </div>
  </div>
</template>

<script setup>
import Konva from 'konva'

const props = defineProps({
  steps: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
})

const emit = defineEmits(['select', 'update-layout', 'reorder', 'add'])

const containerRef = ref(null)
const scale = ref(1)

const NODE_WIDTH = 188
const NODE_HEIGHT = 64
const GAP_X = 64
const START_WIDTH = 96

let stage = null
let layer = null
let observer = null
let dropTargetId = null
let dropTargetShape = null
let dragId = null

const typeMeta = {
  ai: { color: '#3b82f6', icon: 'AI' },
  action: { color: '#f59e0b', icon: 'DO' },
  delay: { color: '#10b981', icon: 'WAIT' },
}

function nodeWidth(type) {
  return type === 'start' || type === 'end' ? START_WIDTH : NODE_WIDTH
}

function nodePosition(step, index) {
  const layout = step?.layout
  if (layout && Number.isFinite(layout.x) && Number.isFinite(layout.y))
    return { x: layout.x, y: layout.y }
  return { x: 80 + START_WIDTH + GAP_X + index * (NODE_WIDTH + GAP_X), y: 140 }
}

function buildNodes() {
  const nodes = [{
    id: '__start',
    type: 'start',
    label: 'Start',
    x: 80,
    y: 140 + NODE_HEIGHT / 2 - 24,
    width: START_WIDTH,
    height: 48,
  }]

  props.steps.forEach((step, index) => {
    const position = nodePosition(step, index)
    nodes.push({
      id: step.id,
      type: step.type,
      label: step.name || step.type,
      index,
      step,
      x: position.x,
      y: position.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })
  })

  const last = nodes[nodes.length - 1]
  nodes.push({
    id: '__end',
    type: 'end',
    label: 'End',
    x: last.x + last.width + GAP_X,
    y: last.y + last.height / 2 - 24,
    width: START_WIDTH,
    height: 48,
  })

  return nodes
}

function drawEdges(edges, nodes) {
  edges.destroyChildren()
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i]
    const to = nodes[i + 1]
    const startX = from.x + from.width
    const startY = from.y + from.height / 2
    const endX = to.x
    const endY = to.y + to.height / 2
    const midX = (startX + endX) / 2

    const line = new Konva.Shape({
      sceneFunc: (context, shape) => {
        context.beginPath()
        context.moveTo(startX, startY)
        context.bezierCurveTo(midX, startY, midX, endY, endX, endY)
        context.strokeShape(shape)
      },
      stroke: 'rgba(148, 163, 184, 0.75)',
      strokeWidth: 2,
    })
    edges.add(line)

    const angle = Math.atan2(endY - startY, endX - startX)
    const arrow = new Konva.Arrow({
      points: [endX - 10, endY - 6, endX, endY, endX - 10, endY + 6],
      fill: 'rgba(148, 163, 184, 0.85)',
      stroke: 'rgba(148, 163, 184, 0.85)',
      strokeWidth: 1,
      rotation: 0,
    })
    arrow.rotation(0)
    edges.add(arrow)
  }
}

function ensureStage() {
  if (!containerRef.value)
    return
  if (stage) {
    resize()
    draw()
    return
  }

  const rect = containerRef.value.getBoundingClientRect()
  stage = new Konva.Stage({
    container: containerRef.value,
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
    draggable: true,
  })
  layer = new Konva.Layer()
  stage.add(layer)

  stage.on('dragmove', () => {})
  stage.on('click', (event) => {
    if (event.target === stage)
      emit('select', null)
  })
  stage.on('wheel', (event) => {
    const native = event.evt
    if (!native.ctrlKey && !native.metaKey)
      return
    native.preventDefault()
    const pointer = stage.getPointerPosition()
    if (!pointer)
      return
    const oldScale = stage.scaleX()
    const next = Math.max(0.4, Math.min(2, oldScale * (native.deltaY < 0 ? 1.1 : 0.9)))
    const pointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    }
    stage.scale({ x: next, y: next })
    stage.position({
      x: pointer.x - pointTo.x * next,
      y: pointer.y - pointTo.y * next,
    })
    scale.value = next
  })

  draw()
  resize()
}

function resize() {
  if (!stage || !containerRef.value)
    return
  const rect = containerRef.value.getBoundingClientRect()
  stage.width(Math.max(1, Math.round(rect.width)))
  stage.height(Math.max(1, Math.round(rect.height)))
}

function draw() {
  if (!stage || !layer)
    return
  layer.destroyChildren()

  const nodes = buildNodes()
  const edges = new Konva.Group()
  drawEdges(edges, nodes)
  layer.add(edges)

  nodes.forEach((node) => {
    const group = new Konva.Group({
      id: node.id,
      x: node.x,
      y: node.y,
      draggable: node.type !== 'start' && node.type !== 'end',
    })

    const isStart = node.type === 'start'
    const isEnd = node.type === 'end'
    const color = isStart
      ? '#10b981'
      : isEnd
        ? '#64748b'
        : typeMeta[node.type]?.color || '#64748b'

    const terminal = isStart || isEnd
    const rect = new Konva.Rect({
      width: node.width,
      height: node.height,
      cornerRadius: 12,
      fill: props.selectedId === node.id || terminal ? color : '#ffffff',
      opacity: props.selectedId === node.id ? 1 : 0.96,
      stroke: color,
      strokeWidth: props.selectedId === node.id ? 3 : 1.5,
      shadowColor: '#000',
      shadowBlur: 8,
      shadowOpacity: 0.12,
      shadowOffset: { x: 0, y: 2 },
    })
    group.add(rect)

    if (!isStart && !isEnd) {
      const badge = new Konva.Rect({
        x: 10,
        y: 12,
        width: 34,
        height: 20,
        cornerRadius: 6,
        fill: color,
      })
      group.add(badge)

      const badgeText = new Konva.Text({
        x: 10,
        y: 16,
        width: 34,
        text: typeMeta[node.type]?.icon || '',
        fontSize: 10,
        fontStyle: 'bold',
        fill: '#ffffff',
        align: 'center',
      })
      group.add(badgeText)

      const indexText = new Konva.Text({
        x: 10,
        y: 38,
        text: `#${node.index + 1}`,
        fontSize: 10,
        fill: color,
      })
      group.add(indexText)

      const title = new Konva.Text({
        x: 52,
        y: 16,
        width: node.width - 62,
        text: String(node.label || '').slice(0, 18) || node.type,
        fontSize: 12,
        fontStyle: 'bold',
        fill: props.selectedId === node.id ? '#ffffff' : '#111827',
        ellipsis: true,
        wrap: 'none',
      })
      group.add(title)

      const subtitle = new Konva.Text({
        x: 52,
        y: 38,
        width: node.width - 62,
        text: node.type === 'delay' ? `${node.step.seconds || 1}s` : node.type,
        fontSize: 10,
        fill: props.selectedId === node.id ? 'rgba(255,255,255,0.8)' : '#6b7280',
        ellipsis: true,
        wrap: 'none',
      })
      group.add(subtitle)
    }
    else {
      const text = new Konva.Text({
        width: node.width,
        y: node.height / 2 - 7,
        text: node.label,
        fontSize: 12,
        fontStyle: 'bold',
        fill: '#ffffff',
        align: 'center',
      })
      group.add(text)
    }

    group.on('click', (event) => {
      event.cancelBubble = true
      emit('select', node.id)
    })

    group.on('dragstart', () => {
      dragId = node.id
    })

    group.on('dragmove', () => {
      highlightDropTarget(group)
    })

    group.on('dragend', () => {
      const targetId = dropTargetId
      clearDropHighlight()
      dragId = null
      if (targetId && targetId !== node.id)
        emit('reorder', { from: node.index, to: targetId })
      else
        emit('update-layout', { id: node.id, layout: { x: group.x(), y: group.y() } })
    })

    layer.add(group)
  })

  layer.draw()
}

function highlightDropTarget(draggedGroup) {
  const pointer = stage.getPointerPosition()
  if (!pointer)
    return
  const transform = stage.getAbsoluteTransform().copy().invert()
  const point = transform.point(pointer)
  const nodes = buildNodes()
  let target = null

  for (const node of nodes) {
    if (node.id === draggedGroup.id() || node.type === 'start')
      continue
    if (point.x >= node.x - 12 && point.x <= node.x + node.width + 12
      && point.y >= node.y - 12 && point.y <= node.y + node.height + 12) {
      target = node.id
      break
    }
  }

  if (dropTargetId !== target) {
    clearDropHighlight()
    dropTargetId = target
    if (target) {
      const shape = layer.findOne(`#${target}`)
      if (shape) {
        dropTargetShape = shape
        shape.to({ scaleX: 1.04, scaleY: 1.04, duration: 0.12 })
      }
    }
  }
}

function clearDropHighlight() {
  if (dropTargetShape) {
    dropTargetShape.to({ scaleX: 1, scaleY: 1, duration: 0.12 })
    dropTargetShape = null
  }
  dropTargetId = null
}

function zoomBy(delta) {
  const next = Math.max(0.4, Math.min(2, scale.value + delta))
  scale.value = next
  stage?.scale({ x: next, y: next })
  stage?.batchDraw()
}

function resetView() {
  scale.value = 1
  stage?.scale({ x: 1, y: 1 })
  stage?.position({ x: 0, y: 0 })
  stage?.batchDraw()
}

function fitView() {
  if (!stage)
    return
  const nodes = buildNodes()
  if (!nodes.length)
    return
  const minX = Math.min(...nodes.map(node => node.x))
  const maxX = Math.max(...nodes.map(node => node.x + node.width))
  const minY = Math.min(...nodes.map(node => node.y))
  const maxY = Math.max(...nodes.map(node => node.y + node.height))
  const width = stage.width()
  const height = stage.height()
  const next = Math.max(0.4, Math.min(1.4, Math.min((width - 80) / (maxX - minX), (height - 80) / (maxY - minY))))
  scale.value = next
  stage.scale({ x: next, y: next })
  stage.position({
    x: (width - (maxX - minX) * next) / 2 - minX * next,
    y: (height - (maxY - minY) * next) / 2 - minY * next,
  })
  stage.batchDraw()
}

function autoLayout() {
  const updates = []
  props.steps.forEach((step, index) => {
    updates.push({
      id: step.id,
      layout: {
        x: 80 + START_WIDTH + GAP_X + index * (NODE_WIDTH + GAP_X),
        y: 140,
      },
    })
  })
  emit('update-layout', { batch: updates })
  resetView()
  nextTick(() => fitView())
}

onMounted(() => {
  ensureStage()
  observer = new ResizeObserver(() => {
    resize()
  })
  observer.observe(containerRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  stage?.destroy()
  stage = null
  layer = null
})

watch(() => [props.steps, props.selectedId], () => draw(), { deep: true })
</script>
