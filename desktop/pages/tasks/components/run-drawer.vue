<template>
  <el-drawer v-model="visibleModel" :title="run?.refName || $t('tasks.history.title')" size="480px">
    <div v-if="run" class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2">
        <el-tag :type="run.kind === 'workflow' ? 'success' : 'primary'" size="small">
          {{ $t(run.kind === 'workflow' ? 'tasks.tab.workflows' : 'tasks.tab.tasks') }}
        </el-tag>
        <el-tag :type="run.status === 'SUCCESS' ? 'success' : run.status === 'RUNNING' ? 'info' : 'danger'" size="small">
          {{ $t(`tasks.status.${run.status.toLowerCase()}`) }}
        </el-tag>
        <el-tag type="info" size="small">
          {{ $t(run.trigger === 'schedule' ? 'tasks.history.scheduled' : 'tasks.history.manual') }}
        </el-tag>
        <el-tag v-if="run.type" size="small" type="warning">{{ $t(`tasks.type.${run.type}`) }}</el-tag>
      </div>

      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="px-2.5 py-2 rounded-md bg-gray-50 dark:bg-gray-800">
          <div class="text-gray-400">{{ $t('tasks.history.started') }}</div>
          <div>{{ formatDateTime(run.startedAt) }}</div>
        </div>
        <div class="px-2.5 py-2 rounded-md bg-gray-50 dark:bg-gray-800">
          <div class="text-gray-400">{{ $t('tasks.history.duration') }}</div>
          <div>{{ formatDuration(run.durationMs) }}</div>
        </div>
      </div>

      <div v-if="run.error" class="px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-300 break-all">
        {{ run.error }}
      </div>

      <!-- Workflow steps -->
      <div v-if="run.steps?.length" class="flex flex-col gap-2">
        <div class="text-xs font-medium text-gray-500">{{ $t('automation.steps') }}</div>

        <div
          v-for="(step, index) in run.steps"
          :key="step.id || index"
          class="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
        >
          <div class="flex items-center gap-2 px-2.5 py-2 bg-gray-50 dark:bg-gray-800/60 text-xs">
            <span class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[0.65rem]">
              {{ index + 1 }}
            </span>
            <span class="font-medium">{{ step.name }}</span>

            <div class="flex-1" />

            <el-tag
              size="small"
              :type="step.status === 'SUCCESS' ? 'success' : step.status === 'SKIPPED' ? 'info' : 'danger'"
              class="!m-0"
            >
              {{ $t(`tasks.stepStatus.${step.status.toLowerCase()}`) }}
            </el-tag>

            <span class="text-gray-400">{{ formatDuration(step.durationMs) }}</span>
          </div>

          <div v-if="step.output || step.error" class="px-3 py-2 text-xs">
            <pre class="whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-gray-600 dark:text-gray-300">{{ step.error || step.output }}</pre>
          </div>
        </div>
      </div>

      <!-- Output -->
      <div v-if="run.output" class="flex flex-col gap-1.5">
        <div class="text-xs font-medium text-gray-500">{{ $t('tasks.history.output') }}</div>
        <pre class="px-3 py-2.5 rounded-md bg-gray-50 dark:bg-gray-800 text-xs whitespace-pre-wrap break-all max-h-80 overflow-y-auto">{{ run.output }}</pre>
      </div>
    </div>
  </el-drawer>
</template>

<script setup>
import { formatDateTime, formatDuration } from '../hooks/use-tasks.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  run: { type: Object, default: null },
})

const emit = defineEmits(['update:visible'])

const visibleModel = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value),
})
</script>
