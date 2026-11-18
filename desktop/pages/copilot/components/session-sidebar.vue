<template>
  <div class="flex flex-col h-full bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
    <div class="flex items-center gap-1 px-2 py-2 border-b border-gray-200 dark:border-gray-700">
      <span class="text-xs font-medium text-gray-500 dark:text-gray-400 flex-1 truncate">
        {{ $t('copilot.session.title') }}
      </span>

      <el-tooltip :content="$t('copilot.session.new')" placement="bottom">
        <el-button text size="small" icon="Plus" class="!px-1.5" @click="emit('create')" />
      </el-tooltip>

      <el-tooltip :content="$t('copilot.session.clearAll')" placement="bottom">
        <el-button text size="small" icon="Delete" class="!px-1.5" @click="emit('clear-all')" />
      </el-tooltip>
    </div>

    <el-scrollbar class="flex-1 min-h-0">
      <div class="p-1.5 flex flex-col gap-1">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="group/session flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors"
          :class="session.id === activeSessionId
            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-300'
            : 'hover:bg-gray-200/60 dark:hover:bg-gray-800'"
          @click="emit('select', session.id)"
        >
          <i class="i-solar-chat-round-dots-linear flex-none opacity-60" />

          <div class="flex-1 min-w-0 flex flex-col">
            <span class="truncate">{{ sessionLabel(session) }}</span>
            <span v-if="session.deviceId" class="truncate text-[0.65rem] opacity-50">{{ session.deviceId }}</span>
          </div>

          <span class="flex items-center opacity-0 group-hover/session:opacity-100 transition-opacity">
            <el-button text size="small" icon="EditPen" class="!px-1" @click.stop="emit('rename', session)" />
            <el-button text size="small" icon="Delete" class="!px-1" @click.stop="emit('delete', session.id)" />
          </span>
        </div>

        <div v-if="!sessions.length" class="px-2 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
          {{ $t('copilot.session.empty') }}
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup>
import dayjs from 'dayjs'

defineProps({
  sessions: {
    type: Array,
    default: () => [],
  },
  activeSessionId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['create', 'select', 'rename', 'delete', 'clear-all'])

function sessionLabel(session) {
  if (session.name?.trim())
    return session.name
  const date = dayjs(session.createdAt)
  const label = window.$preload.i18n.t('copilot.session.untitled')
  return `${label} ${date.format('MM-DD HH:mm')}`
}
</script>
