<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="message in messages"
      :key="message.id"
      class="group/message"
      :class="message.role === 'user' ? 'self-end max-w-85%' : 'self-start max-w-92% w-fit'"
    >
      <!-- User message -->
      <div v-if="message.role === 'user'" class="flex flex-col items-end gap-1">
        <div
          v-if="message.content"
          class="px-3 py-2 rounded-lg rounded-tr-none text-sm whitespace-pre-wrap break-words
            bg-blue-500 text-white shadow-sm"
        >
          {{ message.content }}
        </div>

        <div v-if="message.images?.length" class="flex flex-wrap gap-1 justify-end">
          <el-image
            v-for="(image, index) in message.images"
            :key="index"
            :src="image"
            :preview-src-list="message.images"
            :initial-index="index"
            fit="cover"
            class="w-24 h-32 rounded-md border border-gray-200 dark:border-gray-700 object-cover"
          />
        </div>

        <div class="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover/message:opacity-100 transition-opacity">
          <el-button text size="small" icon="CopyDocument" @click="copyText(message.content)" />
          <el-button text size="small" icon="Delete" @click="emit('delete', message.id)" />
        </div>
      </div>

      <!-- Assistant message -->
      <div v-else-if="message.role === 'assistant'" class="flex flex-col items-start gap-1">
        <div class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <span class="text-blue-500">
            <i class="i-solar-magic-stick-3-line-duotone" />
          </span>
          <span>{{ $t('copilot.role.assistant') }}</span>
          <span v-if="message.usage" class="opacity-70">
            · {{ message.usage.inputTokens || 0 }} / {{ message.usage.outputTokens || 0 }} tokens
          </span>
        </div>

        <div
          v-if="message.content || message.stopped"
          class="px-3 py-2 rounded-lg rounded-tl-none w-full
            bg-gray-100 dark:bg-gray-800 shadow-sm"
        >
          <MarkdownView :content="message.content" />
        </div>

        <div class="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover/message:opacity-100 transition-opacity">
          <el-button text size="small" icon="CopyDocument" @click="copyText(message.content)" />
          <el-button text size="small" icon="Delete" @click="emit('delete', message.id)" />
        </div>
      </div>

      <!-- Tool result -->
      <div v-else-if="message.role === 'tool'" class="w-full">
        <ToolCard :message="message" />
      </div>
    </div>

    <!-- Streaming assistant bubble -->
    <div v-if="streaming" class="self-start max-w-92% w-full flex flex-col items-start gap-1">
      <div class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
        <span class="text-blue-500 animate-pulse">
          <i class="i-solar-magic-stick-3-line-duotone" />
        </span>
        <span>{{ $t('copilot.role.assistant') }}</span>
        <span class="flex items-center gap-1">
          <span class="inline-block w-1 h-1 rounded-full bg-blue-500 animate-ping" />
          <span v-if="steps > 0">{{ $t('copilot.taskStatus.steps') }} {{ steps }}</span>
        </span>
      </div>

      <div v-if="streamingText" class="px-3 py-2 rounded-lg rounded-tl-none w-full bg-gray-100 dark:bg-gray-800 shadow-sm">
        <MarkdownView :content="streamingText" />
        <span class="inline-block w-2 h-4 -mb-1 ml-0.5 bg-blue-500 animate-pulse" />
      </div>

      <div v-else class="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
        <i class="i-svg-spinners-90-ring-with-bg text-blue-500" />
        {{ $t('copilot.event.thinking') }}
      </div>
    </div>
  </div>
</template>

<script setup>
import MarkdownView from './markdown-view.vue'
import ToolCard from './tool-card.vue'

defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  streaming: {
    type: Boolean,
    default: false,
  },
  streamingText: {
    type: String,
    default: '',
  },
  steps: {
    type: Number,
    default: 0,
  },
})

const emit = defineEmits(['delete'])

function copyText(text) {
  navigator.clipboard.writeText(String(text || ''))
  ElMessage.success(window.$preload.i18n.t('copilot.chat.copySuccess'))
}
</script>
