<template>
  <div class="h-full flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
    <div class="flex-none flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
      <el-radio-group v-model="kindFilter" size="small" @change="emit('refresh')">
        <el-radio-button value="">{{ $t('tasks.history.all') }}</el-radio-button>
        <el-radio-button value="task">{{ $t('tasks.tab.tasks') }}</el-radio-button>
        <el-radio-button value="workflow">{{ $t('tasks.tab.workflows') }}</el-radio-button>
      </el-radio-group>

      <div class="flex-1" />

      <el-button size="small" icon="Refresh" @click="emit('refresh')" />

      <el-button size="small" icon="Delete" @click="handleClear">
        {{ $t('automation.log.clear') }}
      </el-button>
    </div>

    <el-scrollbar class="flex-1 min-h-0">
      <div class="p-3">
        <el-table :data="filteredRuns" size="small" :show-header="true" style="width: 100%">
          <el-table-column prop="startedAt" :label="$t('tasks.history.time')" width="170">
            <template #default="{ row }">{{ formatDateTime(row.startedAt) }}</template>
          </el-table-column>

          <el-table-column prop="refName" :label="$t('tasks.history.name')" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="inline-flex items-center gap-1.5">
                <i :class="row.kind === 'workflow' ? 'i-solar-route-linear' : 'i-solar-alarm-linear'" class="opacity-60" />
                {{ row.refName }}
              </span>
            </template>
          </el-table-column>

          <el-table-column prop="kind" :label="$t('tasks.history.kind')" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.kind === 'workflow' ? 'success' : 'primary'" class="!m-0">
                {{ $t(row.kind === 'workflow' ? 'tasks.tab.workflows' : 'tasks.tab.tasks') }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="trigger" :label="$t('tasks.history.trigger')" width="80">
            <template #default="{ row }">
              <span class="text-xs text-gray-500">{{ $t(row.trigger === 'schedule' ? 'tasks.history.scheduled' : 'tasks.history.manual') }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="status" :label="$t('tasks.history.status')" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'SUCCESS' ? 'success' : row.status === 'RUNNING' ? 'info' : 'danger'" class="!m-0">
                {{ $t(`tasks.status.${row.status.toLowerCase()}`) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="durationMs" :label="$t('tasks.history.duration')" width="80">
            <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
          </el-table-column>

          <el-table-column :label="$t('common.control')" width="80" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="activeRun = row">
                {{ $t('tasks.history.view') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="!filteredRuns.length" class="py-14 text-center text-xs text-gray-400">
          {{ $t('automation.log.empty') }}
        </div>
      </div>
    </el-scrollbar>

    <RunDrawer v-model:visible="runDrawerVisible" :run="activeRun" />
  </div>
</template>

<script setup>
import RunDrawer from './run-drawer.vue'
import { formatDateTime, formatDuration } from '../hooks/use-tasks.js'

const props = defineProps({
  runs: { type: Array, default: () => [] },
})

const emit = defineEmits(['refresh', 'clear'])

const { t } = useI18n()

const kindFilter = ref('')
const activeRun = ref(null)

const runDrawerVisible = computed({
  get: () => Boolean(activeRun.value),
  set: value => !value && (activeRun.value = null),
})

const filteredRuns = computed(() => {
  if (!kindFilter.value)
    return props.runs
  return props.runs.filter(run => run.kind === kindFilter.value)
})

function handleClear() {
  emit('clear', kindFilter.value || undefined)
}
</script>
