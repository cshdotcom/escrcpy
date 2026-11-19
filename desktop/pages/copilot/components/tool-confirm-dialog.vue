<template>
  <el-dialog
    v-model="visible"
    :title="$t('copilot.confirm.title')"
    width="420px"
    align-center
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2 text-sm font-medium">
        <span class="text-lg text-blue-500">
          <i class="i-bi-wrench" />
        </span>
        {{ toolName }}
      </div>

      <div>
        <div class="text-xs text-gray-400 dark:text-gray-500 mb-1">
          {{ $t('copilot.confirm.args') }}
        </div>
        <el-scrollbar max-height="220px">
          <pre
            class="p-2 rounded-md text-xs whitespace-pre-wrap break-all
            bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
          >{{ prettyArgs }}</pre>
        </el-scrollbar>
      </div>

      <el-checkbox v-model="allowAll">
        {{ $t('copilot.confirm.allowAll') }}
      </el-checkbox>
    </div>

    <template #footer>
      <el-button @click="handleClose">
        {{ $t('copilot.confirm.deny') }}
      </el-button>
      <el-button type="primary" @click="handleAllow">
        {{ $t('copilot.confirm.allow') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
const props = defineProps({
  pending: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['resolve'])

const visible = computed(() => Boolean(props.pending))
const allowAll = ref(false)

const toolName = computed(() => props.pending?.name || '')
const prettyArgs = computed(() => {
  try {
    return JSON.stringify(props.pending?.args, null, 2)
  }
  catch {
    return String(props.pending?.args ?? '')
  }
})

watch(visible, (value) => {
  if (value)
    allowAll.value = false
})

function handleAllow() {
  emit('resolve', allowAll.value ? 'allow-all' : 'allow')
}

function handleClose() {
  emit('resolve', 'deny')
}
</script>
