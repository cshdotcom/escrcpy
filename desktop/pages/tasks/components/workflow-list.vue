<template>
  <div class="h-full flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
    <div class="flex-none flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <span class="text-xs text-gray-500 dark:text-gray-400">{{ $t('tasks.workflow.hint') }}</span>
      <div class="flex-1" />

      <el-button type="primary" size="small" icon="Plus" @click="emit('create')">
        {{ $t('tasks.workflow.create') }}
      </el-button>
    </div>

    <el-scrollbar class="flex-1 min-h-0">
      <div class="p-3 flex flex-col gap-2">
        <div
          v-for="workflow in workflows"
          :key="workflow.id"
          class="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-emerald-400/60 dark:hover:border-emerald-500/40 transition-colors"
        >
          <div class="flex-none w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-base">
            <i class="i-solar-route-bold-duotone" />
          </div>

          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium truncate max-w-64">{{ workflow.name }}</span>
              <el-tag size="small" type="success" class="!m-0">
                {{ workflow.steps?.length || 0 }} {{ $t('tasks.workflow.stepsCount') }}
              </el-tag>
            </div>

            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
              {{ stepSummary(workflow) }}
            </div>

            <div v-if="workflow.description" class="text-xs text-gray-400 dark:text-gray-500 truncate max-w-96">
              {{ workflow.description }}
            </div>
          </div>

          <div class="flex-none flex items-center gap-1.5">
            <el-tooltip :content="$t('tasks.runNow')" placement="bottom">
              <el-button size="small" circle plain icon="VideoPlay" @click="emit('run', workflow)" />
            </el-tooltip>

            <el-tooltip :content="$t('common.edit')" placement="bottom">
              <el-button size="small" circle plain icon="EditPen" @click="emit('edit', workflow)" />
            </el-tooltip>

            <el-tooltip :content="$t('common.delete')" placement="bottom">
              <el-button size="small" circle plain type="danger" icon="Delete" @click="emit('delete', workflow)" />
            </el-tooltip>
          </div>
        </div>

        <div v-if="!workflows.length" class="flex-1 flex flex-col items-center justify-center py-14 gap-3">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white text-2xl shadow-lg shadow-emerald-500/20">
            <i class="i-solar-route-bold-duotone" />
          </div>
          <div class="text-center">
            <div class="text-sm font-medium">{{ $t('tasks.workflow.empty.title') }}</div>
            <div class="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-md">
              {{ $t('tasks.workflow.empty.description') }}
            </div>
          </div>
          <el-button size="small" round plain @click="emit('create')">{{ $t('tasks.workflow.create') }}</el-button>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup>
const props = defineProps({
  workflows: { type: Array, default: () => [] },
  vendors: { type: Array, default: () => [] },
  devices: { type: Array, default: () => [] },
})

const emit = defineEmits(['create', 'edit', 'run', 'delete'])

const { t } = useI18n()

function stepSummary(workflow) {
  const steps = workflow.steps || []

  if (!steps.length)
    return t('tasks.workflow.empty.noSteps')

  return steps
    .map(step => step.name || t(`tasks.workflow.step.${step.type}`))
    .join('  →  ')
}
</script>
