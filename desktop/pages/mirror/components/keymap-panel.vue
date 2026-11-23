<template>
  <div class="w-72 max-h-full flex flex-col rounded-lg border border-gray-200/80 dark:border-white/10 bg-white/95 dark:bg-gray-900/95 shadow-xl backdrop-blur-sm overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-200/80 dark:border-white/10">
      <span class="text-xs font-semibold">{{ $t('keyboard.mapping.name') }}</span>

      <el-segmented
        v-model="modeModel"
        size="small"
        :options="modeOptions"
        class="ml-auto"
      />

      <el-button text size="small" @click="$emit('close')">
        <el-icon><ElIconClose /></el-icon>
      </el-button>
    </div>

    <!-- Profiles -->
    <div class="px-3 py-2 border-b border-gray-200/60 dark:border-white/5 space-y-2">
      <div class="flex items-center gap-1">
        <el-select
          v-model="activeIdModel"
          size="small"
          class="flex-1"
          :placeholder="$t('keyboard.mapping.profile.namePlaceholder')"
        >
          <el-option
            v-for="profile in profiles"
            :key="profile.id"
            :label="profile.name"
            :value="profile.id"
          />
        </el-select>

        <el-button size="small" text :title="$t('keyboard.mapping.profile.new')" @click="$emit('create-profile')">
          <el-icon><ElIconPlus /></el-icon>
        </el-button>

        <el-button size="small" text :title="$t('keyboard.mapping.profile.duplicate')" @click="$emit('duplicate-profile')">
          <el-icon><ElIconCopyDocument /></el-icon>
        </el-button>

        <el-button size="small" text :title="$t('keyboard.mapping.profile.delete')" @click="$emit('delete-profile')">
          <el-icon><ElIconDelete /></el-icon>
        </el-button>
      </div>

      <div class="flex items-center gap-1">
        <el-button size="small" text class="!px-1" @click="$emit('import-profile')">
          {{ $t('common.import') }}
        </el-button>
        <el-button size="small" text class="!px-1" @click="$emit('export-profile')">
          {{ $t('common.export') }}
        </el-button>
        <span class="ml-auto text-[10px] text-gray-400">
          {{ activeProfile?.mappings?.length || 0 }}
        </span>
      </div>
    </div>

    <!-- Mapping list -->
    <div class="flex-1 overflow-auto px-3 py-2 space-y-1 min-h-24">
      <el-empty
        v-if="!activeProfile?.mappings?.length"
        :image-size="40"
        :description="$t('keyboard.mapping.empty.title')"
      />

      <div
        v-for="mapping in activeProfile?.mappings || []"
        :key="mapping.id"
        class="flex items-center gap-2 rounded px-2 py-1 cursor-pointer transition"
        :class="selectedId === mapping.id ? 'bg-primary-50 dark:bg-primary-500/15' : 'hover:bg-gray-50 dark:hover:bg-white/5'"
        @click="$emit('select', mapping.id)"
      >
        <el-switch
          :model-value="mapping.enabled !== false"
          size="small"
          @change="value => $emit('update-mapping', mapping.id, { enabled: value })"
          @click.stop
        />
        <span class="text-xs flex-1 truncate">
          {{ $t(`keyboard.mapping.type.${mapping.kind}`) }}
        </span>
        <span class="text-[10px] text-gray-400 truncate max-w-16">
          {{ mapping.trigger?.combo || '' }}
        </span>
        <el-button text size="small" @click.stop="$emit('remove-mapping', mapping.id)">
          <el-icon><ElIconClose /></el-icon>
        </el-button>
      </div>
    </div>

    <!-- Editor -->
    <div class="border-t border-gray-200/80 dark:border-white/10 px-3 py-2 space-y-2 max-h-72 overflow-auto">
      <template v-if="selectedMapping">
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.trigger') }}</span>
          <el-button
            size="small"
            class="flex-1"
            :type="capturing?.mappingId === selectedMapping.id && capturing?.target === 'trigger' ? 'primary' : 'default'"
            @click="$emit('start-capture', { target: 'trigger' })"
          >
            {{ captureLabel }}
          </el-button>
          <el-button size="small" text @click="$emit('update-mapping', selectedMapping.id, { trigger: null })">
            {{ $t('keyboard.mapping.capture.clear') }}
          </el-button>
        </div>

        <!-- Swipe -->
        <template v-if="selectedMapping.kind === 'swipe'">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.direction') }}</span>
            <el-select
              :model-value="selectedMapping.action.direction || 'up'"
              size="small"
              class="flex-1"
              @change="value => updateAction({ direction: value })"
            >
              <el-option v-for="dir in directions" :key="dir" :label="dir" :value="dir" />
            </el-select>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.distance') }}</span>
            <el-slider
              :model-value="selectedMapping.action.distance || 0.12"
              :min="0.02"
              :max="0.5"
              :step="0.01"
              class="flex-1"
              @change="value => updateAction({ distance: value })"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.duration') }}</span>
            <el-slider
              :model-value="selectedMapping.action.duration || 160"
              :min="16"
              :max="600"
              :step="4"
              class="flex-1"
              @change="value => updateAction({ duration: value })"
            />
          </div>
        </template>

        <!-- Rapid tap -->
        <template v-else-if="selectedMapping.kind === 'rapidTap'">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.interval') }}</span>
            <el-slider
              :model-value="selectedMapping.action.interval || 90"
              :min="30"
              :max="500"
              :step="10"
              class="flex-1"
              @change="value => updateAction({ interval: value })"
            />
          </div>
        </template>

        <!-- Scroll -->
        <template v-else-if="selectedMapping.kind === 'scroll'">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.sensitivity') }}</span>
            <el-slider
              :model-value="selectedMapping.action.sensitivity || 1"
              :min="0.1"
              :max="3"
              :step="0.1"
              class="flex-1"
              @change="value => updateAction({ sensitivity: value })"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.duration') }}</span>
            <el-slider
              :model-value="selectedMapping.action.duration || 120"
              :min="16"
              :max="600"
              :step="4"
              class="flex-1"
              @change="value => updateAction({ duration: value })"
            />
          </div>
        </template>

        <!-- Joystick -->
        <template v-else-if="selectedMapping.kind === 'joystick'">
          <div class="grid grid-cols-2 gap-1">
            <el-button
              v-for="dir in directions"
              :key="dir"
              size="small"
              :type="capturing?.mappingId === selectedMapping.id && capturing?.direction === dir ? 'primary' : 'default'"
              @click="$emit('start-capture', { target: 'direction', direction: dir })"
            >
              {{ dir }} · {{ selectedMapping.action.directions?.[dir]?.combo || '-' }}
            </el-button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.dragDistance') }}</span>
            <el-slider
              :model-value="selectedMapping.action.radius || 0.14"
              :min="0.04"
              :max="0.35"
              :step="0.01"
              class="flex-1"
              @change="value => updateAction({ radius: value })"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.dragDuration') }}</span>
            <el-slider
              :model-value="selectedMapping.action.duration || 80"
              :min="16"
              :max="240"
              :step="4"
              class="flex-1"
              @change="value => updateAction({ duration: value })"
            />
          </div>
        </template>

        <!-- View control -->
        <template v-else-if="selectedMapping.kind === 'viewControl'">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.sensitivity') }}</span>
            <el-slider
              :model-value="selectedMapping.action.sensitivity || 1"
              :min="0.1"
              :max="3"
              :step="0.1"
              class="flex-1"
              @change="value => updateAction({ sensitivity: value })"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.range') }}</span>
            <el-slider
              :model-value="selectedMapping.action.range || 0.1"
              :min="0.02"
              :max="0.5"
              :step="0.01"
              class="flex-1"
              @change="value => updateAction({ range: value })"
            />
          </div>
        </template>

        <!-- Macro -->
        <template v-else-if="selectedMapping.kind === 'macro'">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">脚本</span>
            <el-select
              :model-value="selectedMapping.action.automationConfig?.scriptId || ''"
              size="small"
              class="flex-1"
              placeholder="Select script"
              @change="value => updateAction({ automationConfig: { ...(selectedMapping.action.automationConfig || {}), scriptId: value } })"
            >
              <el-option
                v-for="item in workflows"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-gray-500 w-14">{{ $t('keyboard.mapping.field.loop') }}</span>
            <el-slider
              :model-value="selectedMapping.action.loop || 1"
              :min="1"
              :max="20"
              :step="1"
              class="flex-1"
              @change="value => updateAction({ loop: value })"
            />
          </div>
        </template>

        <div class="flex items-center gap-1 pt-1">
          <el-button size="small" text class="!px-1" @click="$emit('update-mapping', selectedMapping.id, { position: { x: 0.5, y: 0.5 } })">
            重置位置
          </el-button>
          <el-button size="small" text class="!px-1" type="danger" @click="$emit('remove-mapping', selectedMapping.id)">
            {{ $t('keyboard.mapping.profile.delete') }}
          </el-button>
        </div>
      </template>

      <div v-else class="text-[11px] text-gray-400">
        {{ $t('keyboard.mapping.empty.description') }}
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  profiles: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  selectedId: { type: String, default: null },
  selectedMapping: { type: Object, default: null },
  mode: { type: String, default: 'off' },
  capturing: { type: Object, default: null },
  workflows: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'update:activeId',
  'update:mode',
  'select',
  'close',
  'start-capture',
  'update-mapping',
  'remove-mapping',
  'create-profile',
  'duplicate-profile',
  'delete-profile',
  'import-profile',
  'export-profile',
])

const { t } = useI18n()
const directions = ['up', 'down', 'left', 'right']

const modeOptions = computed(() => [
  { label: t('keyboard.mapping.mode.off'), value: 'off' },
  { label: t('keyboard.mapping.mode.edit'), value: 'edit' },
  { label: t('keyboard.mapping.mode.play'), value: 'play' },
])

const modeModel = computed({
  get: () => props.mode,
  set: value => emit('update:mode', value),
})

const activeIdModel = computed({
  get: () => props.activeId,
  set: value => emit('update:activeId', value),
})

const activeProfile = computed(() => props.profiles.find(item => item.id === props.activeId) || null)

const captureLabel = computed(() => {
  if (props.capturing?.mappingId === props.selectedMapping?.id && props.capturing?.target === 'trigger')
    return props.capturing.pendingLabel || t('keyboard.mapping.capture.hint')
  return props.selectedMapping?.trigger?.combo || t('keyboard.mapping.capture')
})

function updateAction(patch) {
  if (!props.selectedMapping)
    return
  emit('update-mapping', props.selectedMapping.id, { action: patch })
}
</script>
