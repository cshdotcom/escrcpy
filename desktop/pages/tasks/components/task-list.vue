<template>
  <div class="h-full flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
    <div class="flex-none flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <el-select v-model="typeFilter" size="small" class="!w-36" :placeholder="$t('tasks.filter.type')">
        <el-option :label="$t('tasks.filter.all')" value="all" />
        <el-option v-for="item in TASK_TYPES" :key="item.value" :label="$t(item.label)" :value="item.value" />
      </el-select>

      <div class="flex-1" />

      <el-button type="primary" size="small" icon="Plus" @click="emit('create')">
        {{ $t('tasks.create') }}
      </el-button>
    </div>

    <el-scrollbar class="flex-1 min-h-0">
      <div class="p-3 flex flex-col gap-2">
        <div
          v-for="task in filteredTasks"
          :key="task.id"
          class="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400/60 dark:hover:border-blue-500/40 transition-colors"
        >
          <div
            class="flex-none w-9 h-9 rounded-lg flex items-center justify-center text-white text-base"
            :class="typeIconClass(task.type)"
          >
            <i :class="typeIcon(task.type)" />
          </div>

          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-sm font-medium truncate max-w-64">{{ task.name }}</span>
              <el-tag size="small" :type="tagMeta(task.type).type" class="!m-0">
                {{ $t(tagMeta(task.type).label) }}
              </el-tag>
              <el-tooltip v-if="configSummary(task)" :content="configSummary(task)" placement="top">
                <span class="text-xs text-gray-400 dark:text-gray-500 truncate max-w-70">
                  {{ configSummary(task) }}
                </span>
              </el-tooltip>
            </div>

            <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
              <span class="inline-flex items-center gap-1">
                <i class="i-solar-alarm-linear opacity-60" />
                <el-tooltip :content="task.cronExpr" placement="top">
                  <span><CronLabel :expr="task.cronExpr" /></span>
                </el-tooltip>
              </span>

              <span class="inline-flex items-center gap-1">
                <i class="i-solar-clock-circle-linear opacity-60" />
                {{ task.enabled === false ? '—' : formatDateTime(task.nextRunAt) }}
              </span>

              <span class="inline-flex items-center gap-1">
                <i class="i-solar-history-linear opacity-60" />
                {{ formatDateTime(task.lastRunAt) }}
              </span>

              <span
                v-if="task.lastStatus"
                class="inline-flex items-center gap-1"
                :class="task.lastStatus === 'SUCCESS' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'"
              >
                <span class="w-1.5 h-1.5 rounded-full" :class="task.lastStatus === 'SUCCESS' ? 'bg-emerald-500' : 'bg-red-500'" />
                {{ task.lastStatus === 'SUCCESS' ? $t('tasks.status.success') : $t('tasks.status.failed') }}
              </span>
            </div>
          </div>

          <div class="flex-none flex items-center gap-1.5">
            <el-switch
              :model-value="task.enabled !== false"
              size="small"
              @change="emit('toggle', { task, enabled: $event })"
            />

            <el-tooltip :content="$t('tasks.runNow')" placement="bottom">
              <el-button size="small" circle plain icon="VideoPlay" @click="emit('run', task)" />
            </el-tooltip>

            <el-tooltip :content="$t('common.edit')" placement="bottom">
              <el-button size="small" circle plain icon="EditPen" @click="emit('edit', task)" />
            </el-tooltip>

            <el-tooltip :content="$t('common.delete')" placement="bottom">
              <el-button size="small" circle plain type="danger" icon="Delete" @click="emit('delete', task)" />
            </el-tooltip>
          </div>
        </div>

        <div v-if="!filteredTasks.length" class="flex-1 flex flex-col items-center justify-center py-14 gap-3">
          <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-2xl shadow-lg shadow-blue-500/20">
            <i class="i-solar-alarm-bold-duotone" />
          </div>
          <div class="text-center">
            <div class="text-sm font-medium">{{ $t('tasks.empty.title') }}</div>
            <div class="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-md">
              {{ $t('tasks.empty.description') }}
            </div>
          </div>
          <el-button size="small" round plain @click="emit('create')">{{ $t('tasks.create') }}</el-button>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup>
import { TASK_TYPES, TASK_TYPE_TAG, describeTaskConfig } from '../configs/index.js'
import CronLabel from './cron-label.vue'
import { formatDateTime } from '../hooks/use-tasks.js'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  workflows: { type: Array, default: () => [] },
  devices: { type: Array, default: () => [] },
  vendors: { type: Array, default: () => [] },
})

const emit = defineEmits(['create', 'edit', 'run', 'toggle', 'delete', 'goto-workflows'])

const { t } = useI18n()

const typeFilter = ref('all')

const filteredTasks = computed(() => {
  if (typeFilter.value === 'all')
    return props.tasks
  return props.tasks.filter(task => task.type === typeFilter.value)
})

function typeIcon(type) {
  const hit = TASK_TYPES.find(item => item.value === type)
  return hit?.icon || 'i-solar-alarm-bold-duotone'
}

function typeIconClass(type) {
  if (type === 'AI')
    return 'bg-blue-500'
  if (type === 'AUTOMATION')
    return 'bg-orange-500'
  return 'bg-emerald-500'
}

function tagMeta(type) {
  return TASK_TYPE_TAG[type] || TASK_TYPE_TAG.AI
}

function configSummary(task) {
  return describeTaskConfig(task, t)
}
</script>
