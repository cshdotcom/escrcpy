<template>
  <div class="h-full flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
    <!-- Header -->
    <div class="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <i class="i-solar-clipboard-list-linear text-xl text-primary-500" />
      <span class="font-semibold">{{ $t('automation.name') }}</span>
      <span class="text-xs text-gray-400 hidden xl:inline truncate max-w-56">{{ $t('automation.tips') }}</span>
      <span class="flex-1" />
      <el-select v-model="deviceId" size="small" filterable class="!w-52" :placeholder="$t('automation.run.noDevice')" @change="onDeviceChange">
        <el-option v-for="device in devices" :key="device.id" :label="device.id" :value="device.id">
          <span class="flex items-center gap-2">
            <i class="i-solar-smartphone-linear" :class="device.status === 'device' ? 'text-green-500' : 'text-gray-300'" />
            <span class="text-xs">{{ device.id }}</span>
          </span>
        </el-option>
      </el-select>
      <el-button size="small" icon="Refresh" :loading="loadingDevices" @click="refreshDevices">
        {{ $t('common.refresh') }}
      </el-button>
    </div>

    <div class="flex-1 min-h-0 flex">
      <!-- Left: script list -->
      <div class="w-60 flex-none border-r border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-800">
        <div class="flex items-center justify-between px-3 py-2 text-xs text-gray-500">
          <span>{{ $t('automation.scripts') }}</span>
          <div class="flex gap-1">
            <el-tooltip :content="$t('automation.script.import')" placement="top">
              <el-button size="small" text type="primary" @click="importScript">
                <i class="i-solar-import-linear" />
              </el-button>
            </el-tooltip>
            <el-tooltip :content="$t('automation.script.new')" placement="top">
              <el-button size="small" text type="primary" :disabled="!deviceId" @click="newScript">
                <i class="i-solar-add-circle-linear" />
              </el-button>
            </el-tooltip>
          </div>
        </div>
        <el-scrollbar class="flex-1 px-2">
          <div
            v-for="script in scripts"
            :key="script.id"
            class="group flex items-center gap-2 px-2.5 py-2 mb-1.5 rounded-lg border cursor-pointer transition-colors"
            :class="script.id === scriptId ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-primary-300'"
            @click="selectScript(script.id)"
          >
            <i class="i-solar-document-text-linear text-base text-gray-400" />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium truncate">{{ script.name }}</div>
              <div class="text-[10px] text-gray-400">{{ script.steps?.length || 0 }} {{ $t('automation.step.type') }}</div>
            </div>
            <el-tag v-if="runState.scriptId === script.id && ['running', 'paused'].includes(runState.state)" size="small" :type="runState.state === 'running' ? 'warning' : 'info'" class="!m-0">
              {{ $t(`automation.state.${runState.state}`) }}
            </el-tag>
            <el-button size="small" text type="danger" class="!px-1 opacity-0 group-hover:opacity-100" @click.stop="deleteScript">
              <i class="i-solar-trash-bin-trash-linear" />
            </el-button>
          </div>
          <div v-if="!scripts.length" class="py-10 text-center text-xs text-gray-400">
            {{ deviceId ? $t('automation.scripts.empty') : $t('automation.run.noDevice') }}
          </div>
        </el-scrollbar>
      </div>

      <!-- Center: step list + run controls + log -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- Script title + save/export -->
        <div class="flex-none flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
          <el-input v-if="scriptId" v-model="scriptName" size="small" class="!w-52" :placeholder="$t('automation.script.name')" />
          <el-button v-if="scriptId" size="small" type="primary" :loading="saving" @click="saveScript">
            {{ $t('common.save') }}
          </el-button>
          <el-button v-if="scriptId" size="small" :disabled="!scripts.length" @click="exportScript">
            <i class="i-solar-export-linear mr-1" />
            {{ $t('automation.script.export') }}
          </el-button>
          <span class="flex-1" />
          <el-tag v-if="scriptId" size="small" :type="stateTagType" class="!m-0">
            {{ $t(`automation.state.${runState.state}`) }}
          </el-tag>
          <span v-if="isRunning && runState.stepCount" class="text-xs text-gray-400">
            {{ Math.max(1, runState.currentStepIndex + 1) }}/{{ runState.stepCount }}
          </span>
        </div>

        <!-- Run controls -->
        <div v-if="scriptId" class="flex-none flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-wrap">
          <el-button size="small" :disabled="!canRun" @click="runStepCurrent">
            {{ $t('automation.run.step') }}
          </el-button>
          <el-button size="small" :disabled="!canRun" @click="runSelected">
            {{ $t('automation.run.selected') }} ({{ checkedStepIds.length }})
          </el-button>
          <el-button size="small" type="primary" :disabled="!canRun" :loading="starting" @click="runAll">
            {{ $t('automation.run.all') }}
          </el-button>
          <el-button v-if="runState.state === 'running'" size="small" type="warning" @click="pauseRun">
            {{ $t('automation.run.pause') }}
          </el-button>
          <el-button v-if="runState.state === 'paused'" size="small" type="success" @click="resumeRun">
            {{ $t('automation.run.resume') }}
          </el-button>
          <el-button v-if="isRunning" size="small" type="danger" @click="stopRun">
            {{ $t('automation.run.stop') }}
          </el-button>
          <el-button size="small" :disabled="!canRun" @click="addStep">
            <i class="i-solar-add-circle-linear mr-1" />
            {{ $t('automation.step.add') }}
          </el-button>
        </div>

        <!-- Step list -->
        <el-scrollbar class="flex-1 min-h-0 px-3">
          <template v-if="scriptId">
            <template v-for="(step, index) in steps" :key="step.id">
              <div
                class="group flex items-center gap-2 px-2.5 py-2 mb-1.5 rounded-lg border cursor-pointer transition-colors"
                :class="stepClasses(step)"
                :style="isContainer(step.type) ? '' : ''"
                draggable="true"
                @click="selectedStepId = step.id"
                @dragstart="onDragStart(index)"
                @dragover.prevent="onDragOver(index)"
                @drop.prevent="onDrop(index)"
              >
              <el-checkbox v-model="stepChecked[step.id]" size="small" @click.stop @change="onCheckChange" />
              <i :class="stepIcon(step.type)" class="text-base flex-none" />
              <span class="text-xs font-mono w-6 text-gray-400 flex-none">{{ index + 1 }}</span>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium truncate">
                  {{ step.name || $t(stepLabelKey(step.type)) }}
                </div>
                <div class="text-[10px] text-gray-400 truncate font-mono">
                  {{ stepSummary(step) }}
                </div>
              </div>
              <span v-if="isContainer(step.type)" class="text-[10px] text-gray-400 flex-none font-mono">{{ (step.steps || []).length }} ⊂ ×{{ step.loopCount }}</span>
              <span v-if="runState.scriptId === scriptId && runState.state === 'running' && runState.stepIds?.includes(step.id) && runState.currentStepIndex === steps.indexOf(step)" class="flex-none">
                <i class="i-solar-play-circle-linear text-primary-500 animate-pulse" />
              </span>
              <el-tag v-if="!isContainer(step.type) && step.loopCount > 1" size="small" type="info" class="!m-0 flex-none">
                ×{{ step.loopCount }}
              </el-tag>
              <el-tag v-if="step.delayBefore > 0" size="small" type="info" class="!m-0 flex-none">
                {{ step.delayBefore }}ms
              </el-tag>
              <div class="flex-none flex gap-0.5 opacity-0 group-hover:opacity-100">
                <el-button size="small" text :title="$t('automation.step.moveUp')" :disabled="index === 0" @click.stop="moveStep(index, -1)">
                  <i class="i-solar-alt-arrow-up-linear" />
                </el-button>
                <el-button size="small" text :title="$t('automation.step.moveDown')" :disabled="index === steps.length - 1" @click.stop="moveStep(index, 1)">
                  <i class="i-solar-alt-arrow-down-linear" />
                </el-button>
                <el-button size="small" text :title="$t('automation.step.insertBefore')" @click.stop="insertStep(index)">
                  <i class="i-solar-add-square-linear" />
                </el-button>
                <el-button size="small" text :title="$t('common.duplicate')" @click.stop="duplicateStep(index)">
                  <i class="i-solar-copy-linear" />
                </el-button>
                <el-button size="small" text type="danger" :title="$t('common.delete')" @click.stop="removeStep(index)">
                  <i class="i-solar-trash-bin-trash-linear" />
                </el-button>
              </div>
              </div>
              <!-- child steps of loop / condition containers -->
              <div
                v-for="(child, childIndex) in (step.steps || [])"
                :key="child.id"
                class="group flex items-center gap-2 ml-6 pl-6 pr-2.5 py-1.5 mb-1 rounded-lg border border-dashed cursor-pointer transition-colors"
                :class="stepClasses(child)"
                @click="selectedStepId = child.id"
              >
                <i :class="stepIcon(child.type)" class="text-sm flex-none" />
                <span class="text-[10px] font-mono w-8 text-gray-400 flex-none">{{ index + 1 }}.{{ childIndex + 1 }}</span>
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium truncate">{{ child.name || $t(stepLabelKey(child.type)) }}</div>
                  <div class="text-[10px] text-gray-400 truncate font-mono">{{ stepSummary(child) }}</div>
                </div>
                <el-tag v-if="child.loopCount > 1" size="small" type="info" class="!m-0 flex-none">×{{ child.loopCount }}</el-tag>
                <div class="flex-none flex gap-0.5 opacity-0 group-hover:opacity-100">
                  <el-button size="small" text :disabled="childIndex === 0" @click.stop="moveChild(step, childIndex, -1)">
                    <i class="i-solar-alt-arrow-up-linear" />
                  </el-button>
                  <el-button size="small" text :disabled="childIndex === (step.steps || []).length - 1" @click.stop="moveChild(step, childIndex, 1)">
                    <i class="i-solar-alt-arrow-down-linear" />
                  </el-button>
                  <el-button size="small" text @click.stop="duplicateChild(step, childIndex)">
                    <i class="i-solar-copy-linear" />
                  </el-button>
                  <el-button size="small" text type="danger" @click.stop="removeChild(step, childIndex)">
                    <i class="i-solar-trash-bin-trash-linear" />
                  </el-button>
                </div>
              </div>
            </template>
            <div v-if="!steps.length" class="py-10 text-center text-xs text-gray-400">
              {{ $t('automation.step.selectHint') }}
            </div>
          </template>
          <div v-else class="py-16 text-center text-xs text-gray-400">
            {{ $t('automation.empty.hint') }}
          </div>
        </el-scrollbar>

        <!-- Execution log -->
        <div v-if="scriptId" class="flex-none h-48 border-t border-gray-200 dark:border-gray-700 flex flex-col bg-gray-900 text-gray-100">
          <div class="flex-none flex items-center gap-2 px-3 py-1.5 text-xs border-b border-gray-700">
            <i class="i-solar-code-linear text-gray-400" />
            <span>{{ $t('automation.log.title') }}</span>
            <span class="flex-1" />
            <el-button size="small" text class="!text-gray-300" @click="clearLog">
              {{ $t('automation.log.clear') }}
            </el-button>
          </div>
          <el-scrollbar ref="logScrollbar" class="flex-1 px-3">
            <div v-for="(entry, index) in logs" :key="index" class="text-[11px] font-mono py-0.5 whitespace-pre-wrap flex gap-2">
              <span class="text-gray-500 flex-none">{{ formatTime(entry.at) }}</span>
              <span :class="logClass(entry.level)" class="break-all">{{ entry.text }}</span>
            </div>
            <div v-if="!logs.length" class="py-8 text-center text-[11px] text-gray-500">
              {{ $t('automation.log.empty') }}
            </div>
          </el-scrollbar>
        </div>
      </div>

      <!-- Right: step form -->
      <div class="w-80 flex-none border-l border-gray-200 dark:border-gray-700 flex flex-col bg-white dark:bg-gray-800">
        <div class="flex-none px-3 py-2 text-xs text-gray-500 border-b border-gray-100 dark:border-gray-800">
          {{ $t('automation.step.type') }}
        </div>
        <el-scrollbar class="flex-1 px-3 py-2">
          <template v-if="currentStep">
            <el-form label-position="top" size="small" class="step-form">
              <el-form-item :label="$t('automation.script.name')">
                <el-input v-model="currentStep.name" :placeholder="$t(stepLabelKey(currentStep.type))" />
              </el-form-item>

              <el-form-item :label="$t('automation.step.type')">
                <el-select v-model="currentStep.type" @change="onTypeChange">
                  <el-option-group v-for="group in STEP_GROUPS" :key="group.key" :label="$t(group.labelKey)">
                    <el-option v-for="type in group.types" :key="type" :label="$t(stepLabelKey(type))" :value="type" />
                  </el-option-group>
                </el-select>
              </el-form-item>

              <!-- containers carry their loop count at the top level -->
              <el-form-item v-if="isContainer(currentStep.type)" :label="$t('automation.step.loopCount')">
                <el-input-number v-model="currentStep.loopCount" :min="1" :max="999" class="!w-full" controls-position="right" />
              </el-form-item>

              <!-- type-specific fields -->
              <template v-for="field in typeFields" :key="field">
                <el-form-item :label="fieldLabel(field)">
                  <div v-if="field === 'apkPath'" class="flex gap-1 w-full">
                    <el-input v-model="currentStep.apkPath" :placeholder="$t('automation.step.install.apkPath.placeholder')" />
                    <el-button size="small" @click="pickApk">
                      <i class="i-solar-download-square-linear" />
                    </el-button>
                  </div>
                  <el-switch v-else-if="field === 'uninstallBefore' || field === 'forceStop'" v-model="currentStep[field]" />
                  <el-select v-else-if="field === 'conditionType'" v-model="currentStep.conditionType">
                    <el-option v-for="ct in CONDITION_TYPES" :key="ct.value" :label="$t(ct.labelKey)" :value="ct.value" />
                  </el-select>
                  <el-select v-else-if="field === 'method'" v-model="currentStep.method">
                    <el-option v-for="method in ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']" :key="method" :label="method" :value="method" />
                  </el-select>
                  <el-switch v-else-if="field === 'required'" v-model="currentStep.required" />
                  <el-input-number v-else-if="isNumberField(field)" v-model="currentStep[field]" :min="0" class="!w-full" controls-position="right" />
                  <el-input v-else-if="isLongField(field)" v-model="currentStep[field]" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" :placeholder="fieldPlaceholder(field)" />
                  <el-input v-else v-model="currentStep[field]" :placeholder="fieldPlaceholder(field)" />
                </el-form-item>
                <div v-if="field === 'apkPath' && currentStep.uninstallBefore" class="text-[10px] text-gray-400 -mt-2 mb-2">
                  {{ $t('automation.step.install.uninstallBefore') }} → package
                </div>
                <div v-if="field === 'command'" class="text-[10px] text-gray-400 -mt-2 mb-2">
                  {{ $t('automation.step.command.hint') }}
                </div>
              </template>

              <!-- condition sub-fields per guard type -->
              <template v-if="currentStep.type === 'condition'">
                <template v-if="currentStep.conditionType === 'image_exists'">
                  <el-form-item :label="$t('automation.step.imageMatch.selectTemplate')">
                    <div class="flex gap-1 w-full">
                      <el-input v-model="currentStep.templatePath" />
                      <el-button size="small" @click="pickTemplate">
                        <i class="i-solar-gallery-linear" />
                      </el-button>
                    </div>
                  </el-form-item>
                  <el-form-item :label="$t('automation.step.imageMatch.threshold')">
                    <el-input-number v-model="currentStep.threshold" :min="0.1" :max="1" :step="0.05" class="!w-full" controls-position="right" />
                  </el-form-item>
                </template>
                <template v-else-if="currentStep.conditionType === 'variable_compare'">
                  <el-form-item :label="$t('automation.magic.varName')">
                    <el-input v-model="currentStep.varName" :placeholder="$t('automation.magic.namePlaceholder')" />
                  </el-form-item>
                  <el-form-item :label="$t('automation.step.varOp')">
                    <el-select v-model="currentStep.varOp">
                      <el-option v-for="op in COMPARE_OPS" :key="op" :label="op" :value="op" />
                    </el-select>
                  </el-form-item>
                  <el-form-item :label="$t('automation.step.varValue')">
                    <el-input v-model="currentStep.varValue" :placeholder="$t('automation.magic.valuePlaceholder')" />
                  </el-form-item>
                </template>
              </template>

              <!-- key presets -->
              <div v-if="currentStep.type === 'key'" class="flex flex-wrap gap-1 mb-2">
                <el-button v-for="preset in KEY_PRESETS" :key="preset.keyCode" size="small" @click="currentStep.keyCode = preset.keyCode">
                  {{ preset.name }}
                </el-button>
              </div>

              <!-- imageMatch attachment -->
              <el-divider class="!my-3">
                <span class="text-xs">{{ $t('automation.step.imageMatch') }}</span>
              </el-divider>
              <el-form-item>
                <el-switch v-model="imageMatchEnabled" />
              </el-form-item>
              <template v-if="imageMatchEnabled">
                <el-form-item :label="$t('automation.step.imageMatch.templatePreview')">
                  <div class="flex gap-1 w-full">
                    <el-input v-model="imageMatchTemplate" :placeholder="$t('automation.step.imageMatch.selectTemplate')" />
                    <el-button size="small" @click="pickTemplate">
                      <i class="i-solar-gallery-linear" />
                    </el-button>
                  </div>
                </el-form-item>
                <el-form-item :label="$t('automation.step.imageMatch.threshold')">
                  <el-input-number v-model="imageMatchThreshold" :min="0.1" :max="1" :step="0.05" class="!w-full" controls-position="right" />
                </el-form-item>
                <el-form-item v-if="currentStep.type === 'tap'">
                  <el-checkbox v-model="imageMatchFollow">
                    {{ $t('automation.step.imageMatch.followMatchPoint') }}
                  </el-checkbox>
                </el-form-item>
                <div v-if="currentStep.type === 'tap'" class="text-[10px] text-gray-400 -mt-2">
                  {{ $t('automation.step.imageMatch.followMatchPoint.tip') }}
                </div>
              </template>

              <!-- advanced common fields -->
              <!-- children management (loop / condition) -->
              <template v-if="isContainer(currentStep.type)">
                <el-divider class="!my-3">
                  <span class="text-xs">{{ $t('automation.step.loopChildren') }}</span>
                </el-divider>
                <div
                  v-for="(child, childIndex) in currentStep.steps"
                  :key="child.id"
                  class="group flex items-center gap-2 px-2 py-1.5 mb-1 rounded border border-dashed cursor-pointer transition-colors"
                  :class="child.id === selectedStepId ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-primary-300'"
                  @click="selectedStepId = child.id"
                >
                  <i :class="stepIcon(child.type)" class="text-sm flex-none" />
                  <span class="text-xs flex-1 min-w-0 truncate">{{ child.name || $t(stepLabelKey(child.type)) }}</span>
                  <span class="text-[10px] text-gray-400 font-mono flex-none max-w-24 truncate">{{ stepSummary(child) }}</span>
                  <div class="flex-none flex gap-0.5 opacity-0 group-hover:opacity-100">
                    <el-button size="small" text :disabled="childIndex === 0" @click.stop="moveChild(currentStep, childIndex, -1)">
                      <i class="i-solar-alt-arrow-up-linear" />
                    </el-button>
                    <el-button size="small" text :disabled="childIndex === currentStep.steps.length - 1" @click.stop="moveChild(currentStep, childIndex, 1)">
                      <i class="i-solar-alt-arrow-down-linear" />
                    </el-button>
                    <el-button size="small" text @click.stop="duplicateChild(currentStep, childIndex)">
                      <i class="i-solar-copy-linear" />
                    </el-button>
                    <el-button size="small" text type="danger" @click.stop="removeChild(currentStep, childIndex)">
                      <i class="i-solar-trash-bin-trash-linear" />
                    </el-button>
                  </div>
                </div>
                <div v-if="!currentStep.steps.length" class="text-[10px] text-gray-400 mb-2 text-center py-3">
                  {{ $t('automation.step.selectHint') }}
                </div>
                <el-button size="small" class="w-full" @click="addChildStep(currentStep)">
                  <i class="i-solar-add-circle-linear mr-1" />
                  {{ $t('automation.step.addChild') }}
                </el-button>
              </template>

              <el-collapse class="mt-2">
                <el-collapse-item :title="$t('automation.step.advanced')" name="advanced">
                  <el-form-item :label="$t('automation.step.delayBefore')">
                    <el-input-number v-model="currentStep.delayBefore" :min="0" :step="100" class="!w-full" controls-position="right" />
                  </el-form-item>
                  <el-form-item :label="$t('automation.step.loopCount')">
                    <el-input-number v-model="currentStep.loopCount" :min="1" :max="999" class="!w-full" controls-position="right" />
                  </el-form-item>
                  <el-form-item :label="$t('automation.step.randomRange')">
                    <el-input-number v-model="currentStep.randomRange" :min="0" :max="20" class="!w-full" controls-position="right" />
                    <div class="text-[10px] text-gray-400 w-full">
                      {{ $t('automation.step.randomRange.tip') }}
                    </div>
                  </el-form-item>
                  <el-form-item :label="$t('automation.step.target.by')">
                    <el-input v-model="currentStep.target.by" placeholder="coordinates / id" />
                  </el-form-item>
                  <el-form-item :label="$t('automation.step.target.value')">
                    <el-input v-model="currentStep.target.value" />
                  </el-form-item>
                </el-collapse-item>
              </el-collapse>
            </el-form>
          </template>
          <div v-else class="py-10 text-center text-xs text-gray-400">
            {{ $t('automation.step.selectHint') }}
          </div>
        </el-scrollbar>
      </div>
    </div>
  </div>
</template>

<script setup>
import { STEP_GROUPS, STEP_META, KEY_PRESETS, CONDITION_TYPES, COMPARE_OPS, isContainer, stepIcon, stepLabelKey, defaultStep, uid } from './configs/index.js'

const { t } = useI18n()

const devices = ref([])
const deviceId = ref('')
const loadingDevices = ref(false)
const scripts = ref([])
const scriptId = ref('')
const scriptName = ref('')
const steps = ref([])
const selectedStepId = ref('')
const stepChecked = reactive({})
const logs = ref([])
const saving = ref(false)
const starting = ref(false)
const runState = reactive({ scriptId: '', state: 'idle', mode: '', stepCount: 0, currentStepIndex: -1, currentIteration: 0, stepIds: [] })
let pollTimer = null

const invoke = (channel, payload) => window.$preload.ipcxRenderer.invoke(channel, payload)

const currentStep = computed(() => steps.value.find(step => step.id === selectedStepId.value) || null)
const typeFields = computed(() => STEP_META[currentStep.value?.type]?.fields || [])
const isRunning = computed(() => runState.state === 'running' || runState.state === 'paused')
const canRun = computed(() => Boolean(scriptId.value && deviceId.value && !isRunning.value))
const checkedStepIds = computed(() => steps.value.filter(step => stepChecked[step.id]).map(step => step.id))
const stateTagType = computed(() => ({ running: 'warning', paused: 'info', stopped: 'danger', idle: 'success' }[runState.state] || 'info'))

// imageMatch is stored on the step as an object; bind through helpers so the
// switch works even when the field is initially undefined.
const imageMatchEnabled = computed({
  get: () => Boolean(currentStep.value?.imageMatch?.enabled),
  set: (value) => {
    if (!currentStep.value)
      return
    if (value)
      currentStep.value.imageMatch = { enabled: true, templatePath: '', threshold: 0.8, followMatchPoint: false }
    else
      currentStep.value.imageMatch = undefined
  },
})
const imageMatchTemplate = computed({
  get: () => currentStep.value?.imageMatch?.templatePath || '',
  set: (value) => {
    if (currentStep.value?.imageMatch)
      currentStep.value.imageMatch.templatePath = String(value || '')
  },
})
const imageMatchThreshold = computed({
  get: () => currentStep.value?.imageMatch?.threshold ?? 0.8,
  set: (value) => {
    if (currentStep.value?.imageMatch)
      currentStep.value.imageMatch.threshold = Number(value) || 0.8
  },
})
const imageMatchFollow = computed({
  get: () => currentStep.value?.imageMatch?.followMatchPoint === true,
  set: (value) => {
    if (currentStep.value?.imageMatch)
      currentStep.value.imageMatch.followMatchPoint = value === true
  },
})

const NUMBER_FIELDS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'duration', 'waitMs', 'keyCode', 'threshold', 'timeoutMs', 'intervalMs', 'delayBefore', 'loopCount', 'randomRange'])
const LONG_FIELDS = new Set(['text', 'command', 'headers', 'body', 'content'])
function isNumberField(field) {
  return NUMBER_FIELDS.has(field)
}
function isLongField(field) {
  return LONG_FIELDS.has(field)
}
function fieldLabel(field) {
  const fallback = {
    x: 'X', y: 'Y', x1: 'startX', y1: 'startY', x2: 'endX', y2: 'endY',
    duration: 'automation.step.record.duration', waitMs: 'automation.step.waitDuration', text: 'automation.step.text',
    keyCode: 'key', package: 'package', saveDir: 'automation.step.saveDir',
    command: 'automation.step.command', templatePath: 'automation.step.imageMatch.selectTemplate',
    threshold: 'automation.step.imageMatch.threshold', required: 'required',
    timeoutMs: 'timeout', intervalMs: 'interval', url: 'URL', method: 'method',
    headers: 'headers', body: 'body', title: 'title', content: 'content',
    apkPath: 'automation.step.install.apkPath', uninstallBefore: 'automation.step.install.uninstallBefore',
    forceStop: 'automation.step.launch.forceStop', conditionType: 'automation.step.conditionType',
    varOp: 'automation.step.varOp',
  }[field] || field
  if (fallback.startsWith('automation.'))
    return t(fallback)
  if (['startX', 'endX'].includes(fallback))
    return t(`automation.step.${fallback}`)
  return fallback
}
function fieldPlaceholder(field) {
  if (field === 'command')
    return t('automation.step.command.placeholder')
  if (field === 'package')
    return 'com.example.app'
  if (field === 'url')
    return 'https://'
  return ''
}

function stepClasses(step) {
  const classes = []
  if (step.id === selectedStepId.value)
    classes.push('border-primary-500', 'bg-primary-50', 'dark:bg-primary-900/20')
  else
    classes.push('border-gray-200', 'dark:border-gray-700', 'hover:border-primary-300')
  return classes
}

function stepSummary(step) {
  switch (step.type) {
    case 'tap': return `(${step.x}, ${step.y})`
    case 'swipe': return `(${step.x1},${step.y1})->(${step.x2},${step.y2}) ${step.duration}ms`
    case 'input_text': return String(step.text || '').slice(0, 24)
    case 'key': return `keycode ${step.keyCode}`
    case 'wait': return `${step.waitMs}ms`
    case 'open_app': return `${step.forceStop ? 'force-stop+' : ''}${String(step.package || '')}`
    case 'install': return `${step.uninstallBefore ? 'uninstall+' : ''}${String(step.apkPath || '').split(/[\\/]/).pop()}`
    case 'record': return `${step.duration}s -> ${String(step.saveDir || '').split(/[\\/]/).pop()}`
    case 'loop': return `×${step.loopCount}`
    case 'condition': return String(step.conditionType || 'device_online')
    case 'screenshot': return String(step.saveDir || '').slice(-32)
    case 'shell': return String(step.command || '').slice(0, 32)
    case 'match_image': case 'wait_image': return String(step.templatePath || '').split(/[\\/]/).pop()
    case 'http': return `${step.method || 'GET'} ${String(step.url || '').slice(0, 20)}`
    case 'notify': return String(step.title || '')
    default: return ''
  }
}

function logClass(level) {
  return { ok: 'text-green-400', error: 'text-red-400', info: 'text-gray-300' }[level] || 'text-gray-300'
}

function formatTime(ms) {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ── devices & scripts ─────────────────────────────────────

async function refreshDevices() {
  loadingDevices.value = true
  try {
    const result = await invoke('automation:devices')
    devices.value = result?.devices || []
    if (!deviceId.value) {
      const payloadDevice = window.$preload?.payload?.device?.id
      deviceId.value = devices.value.find(d => d.id === payloadDevice)?.id || devices.value[0]?.id || ''
    }
    await loadScripts()
  }
  catch (error) {
    ElMessage.warning(error?.message ?? String(error))
  }
  finally {
    loadingDevices.value = false
  }
}

async function onDeviceChange() {
  await loadScripts()
}

async function loadScripts() {
  if (!deviceId.value) {
    scripts.value = []
    resetEditor()
    return
  }
  const result = await invoke('automation:scripts:list', { deviceId: deviceId.value })
  scripts.value = result?.scripts || []
  if (!scripts.value.some(script => script.id === scriptId.value)) {
    resetEditor()
    if (scripts.value.length)
      await selectScript(scripts.value[0].id)
  }
}

function resetEditor() {
  scriptId.value = ''
  scriptName.value = ''
  steps.value = []
  selectedStepId.value = ''
  logs.value = []
  Object.keys(stepChecked).forEach(key => delete stepChecked[key])
  runState.scriptId = ''
  runState.state = 'idle'
  stopPolling()
}

// Steps persisted in the store may carry `target: undefined` after main-process
// normalization — always hydrate so the form can bind step.target.by safely.
// Containers hydrate their children recursively.
function hydrateSteps(rawSteps) {
  return (rawSteps || []).map((step) => {
    const hydrated = { ...step, target: step.target || { by: '', value: '' } }
    if (isContainer(hydrated.type))
      hydrated.steps = hydrateSteps(hydrated.steps)
    else if (hydrated.steps !== undefined)
      delete hydrated.steps
    return hydrated
  })
}

async function selectScript(id) {
  const script = scripts.value.find(item => item.id === id)
  if (!script)
    return

  // Official behaviour: switching scripts stops the running one (with confirm).
  if (scriptId.value && scriptId.value !== id && runState.scriptId === scriptId.value && isRunning.value) {
    try {
      await ElMessageBox.confirm(t('automation.run.confirmSwitch'), 'Tips', { type: 'warning' })
    }
    catch {
      return
    }
    await invoke('automation:script:stop', { scriptId: scriptId.value })
  }

  scriptId.value = script.id
  scriptName.value = script.name
  steps.value = hydrateSteps(script.steps)
  selectedStepId.value = steps.value[0]?.id || ''
  logs.value = []
  Object.keys(stepChecked).forEach(key => delete stepChecked[key])
  await syncRunState()
  await loadLogs()
  ensurePolling()
}

async function newScript() {
  if (!deviceId.value) {
    ElMessage.warning(t('automation.run.noDevice'))
    return
  }
  const name = `${t('automation.script.name')} ${scripts.value.length + 1}`
  const result = await invoke('automation:script:save', {
    script: { id: '', deviceId: deviceId.value, name, steps: [], variables: [] },
  })
  if (!result?.success) {
    ElMessage.warning(result?.error?.message || 'failed')
    return
  }
  await loadScripts()
  await selectScript(result.script.id)
}

async function saveScript() {
  if (!scriptId.value)
    return
  saving.value = true
  try {
    const result = await invoke('automation:script:save', {
      script: { id: scriptId.value, deviceId: deviceId.value, name: scriptName.value, steps: steps.value, variables: [] },
    })
    if (result?.success) {
      scriptId.value = result.script.id
      scriptName.value = result.script.name
      steps.value = hydrateSteps(result.script.steps)
      const index = scripts.value.findIndex(item => item.id === scriptId.value)
      if (index !== -1)
        scripts.value[index] = result.script
      ElMessage.success(t('automation.script.saved'))
    }
    else {
      ElMessage.warning(result?.error?.message || 'failed')
    }
  }
  finally {
    saving.value = false
  }
}

async function deleteScript() {
  if (!scriptId.value)
    return
  try {
    await ElMessageBox.confirm(t('automation.script.confirmDelete'), 'Tips', { type: 'warning' })
  }
  catch {
    return
  }
  await invoke('automation:script:delete', { id: scriptId.value })
  await loadScripts()
}

async function exportScript() {
  if (!scriptId.value)
    return
  const result = await invoke('automation:export', { scriptId: scriptId.value })
  if (result?.success && result.filePath)
    ElMessage.success(t('automation.export.success'))
  else if (result && !result.success)
    ElMessage.warning(result?.error?.message || 'failed')
}

async function importScript() {
  const result = await invoke('automation:import')
  if (!result?.success || !result?.script) {
    if (result && !result.success)
      ElMessage.warning(result?.error?.message || 'failed')
    return
  }
  const imported = result.script

  if (scriptId.value && steps.value.length) {
    try {
      await ElMessageBox.confirm(t('automation.import.confirmReplace'), 'Tips', { type: 'warning' })
      // Replace the current script's steps with the imported ones.
      const save = await invoke('automation:script:save', {
        script: { id: scriptId.value, deviceId: deviceId.value, name: scriptName.value, steps: imported.steps, variables: imported.variables || [] },
      })
      if (save?.success) {
        steps.value = hydrateSteps(save.script.steps)
        selectedStepId.value = steps.value[0]?.id || ''
        ElMessage.success(t('automation.import.success'))
      }
      return
    }
    catch { /* fall through: create a new script instead */ }
  }

  const save = await invoke('automation:script:save', {
    script: { ...imported, id: '', deviceId: deviceId.value },
  })
  if (save?.success) {
    await loadScripts()
    await selectScript(save.script.id)
    ElMessage.success(t('automation.import.success'))
  }
}

// ── step editing ──────────────────────────────────────────

function addStep() {
  if (!scriptId.value) {
    ElMessage.warning(t('automation.empty.hint'))
    return
  }
  const step = defaultStep('tap')
  steps.value.push(step)
  selectedStepId.value = step.id
}

function insertStep(index) {
  const step = defaultStep('tap')
  steps.value.splice(index, 0, step)
  selectedStepId.value = step.id
}

function duplicateStep(index) {
  const copy = { ...structuredClone(toRaw(steps.value[index])), id: uid('step'), target: steps.value[index]?.target || { by: '', value: '' } }
  steps.value.splice(index + 1, 0, copy)
  selectedStepId.value = copy.id
}

function moveStep(index, direction) {
  const target = index + direction
  if (target < 0 || target >= steps.value.length)
    return
  const [step] = steps.value.splice(index, 1)
  steps.value.splice(target, 0, step)
}

function removeStep(index) {
  const [removed] = steps.value.splice(index, 1)
  if (removed?.id === selectedStepId.value)
    selectedStepId.value = steps.value[Math.min(index, steps.value.length - 1)]?.id || ''
  delete stepChecked[removed?.id]
}

function onTypeChange(type) {
  const step = currentStep.value
  if (!step)
    return
  const fresh = defaultStep(type)
  const keep = { id: step.id, name: step.name, delayBefore: step.delayBefore, loopCount: step.loopCount, randomRange: step.randomRange, target: step.target || { by: '', value: '' }, imageMatch: step.imageMatch }
  Object.assign(step, fresh, keep)
  if (isContainer(type))
    step.steps = Array.isArray(step.steps) ? step.steps : []
  else
    delete step.steps
}

// ── child steps (loop / condition containers) ────────────

function addChildStep(container) {
  container.steps = Array.isArray(container.steps) ? container.steps : []
  const step = defaultStep('tap')
  container.steps.push(step)
  selectedStepId.value = step.id
}

function moveChild(container, index, direction) {
  const target = index + direction
  if (target < 0 || target >= container.steps.length)
    return
  const [child] = container.steps.splice(index, 1)
  container.steps.splice(target, 0, child)
}

function duplicateChild(container, index) {
  const copy = { ...structuredClone(toRaw(container.steps[index])), id: uid('step'), target: container.steps[index]?.target || { by: '', value: '' } }
  container.steps.splice(index + 1, 0, copy)
  selectedStepId.value = copy.id
}

function removeChild(container, index) {
  const [removed] = container.steps.splice(index, 1)
  if (removed?.id === selectedStepId.value)
    selectedStepId.value = container.steps[Math.min(index, container.steps.length - 1)]?.id || ''
}

function onCheckChange() { /* checkbox state lives in stepChecked */ }

// ── drag & drop reorder ───────────────────────────────────

let dragIndex = -1
function onDragStart(index) {
  dragIndex = index
}
function onDragOver(index) {
  if (dragIndex === -1 || dragIndex === index)
    return
}
function onDrop(index) {
  if (dragIndex === -1 || dragIndex === index)
    return
  const [step] = steps.value.splice(dragIndex, 1)
  steps.value.splice(index, 0, step)
  dragIndex = -1
}

// ── template picker ───────────────────────────────────────

async function pickTemplate() {
  const result = await invoke('automation:pick-template')
  if (result?.success && result.filePath)
    imageMatchTemplate.value = result.filePath
}

async function pickApk() {
  const result = await invoke('automation:pick-apk')
  if (result?.success && result.filePath && currentStep.value)
    currentStep.value.apkPath = result.filePath
}

// ── execution control ─────────────────────────────────────

async function runAll() {
  await startRun('all')
}
async function runSelected() {
  if (!checkedStepIds.value.length) {
    ElMessage.warning(t('automation.step.selectHint'))
    return
  }
  await startRun('selected', checkedStepIds.value)
}
async function runStepCurrent() {
  if (!currentStep.value) {
    ElMessage.warning(t('automation.step.selectHint'))
    return
  }
  await startRun('step', [currentStep.value.id])
}

async function startRun(mode, stepIds = []) {
  if (!deviceId.value) {
    ElMessage.warning(t('automation.run.noDevice'))
    return
  }
  if (!steps.value.length) {
    ElMessage.warning(t('automation.run.noSteps'))
    return
  }
  // Always run the persisted state — flush pending edits first.
  await saveScript()
  starting.value = true
  try {
    const result = await invoke('automation:script:run', { scriptId: scriptId.value, mode, stepIds })
    if (!result?.success) {
      ElMessage.warning(result?.error?.message || 'failed')
      return
    }
    Object.assign(runState, result.run, { stepIds })
    logs.value = []
    await loadLogs()
    ensurePolling()
  }
  finally {
    starting.value = false
  }
}

async function pauseRun() {
  const result = await invoke('automation:script:pause', { scriptId: scriptId.value })
  if (result?.success)
    Object.assign(runState, result.run)
}

async function resumeRun() {
  const result = await invoke('automation:script:resume', { scriptId: scriptId.value })
  if (result?.success)
    Object.assign(runState, result.run)
}

async function stopRun() {
  await invoke('automation:script:stop', { scriptId: scriptId.value })
}

function clearLog() {
  logs.value = []
}

async function syncRunState() {
  if (!scriptId.value)
    return
  const result = await invoke('automation:script:status', { scriptId: scriptId.value })
  if (result?.success && result.run?.scriptId) {
    Object.assign(runState, result.run)
    if (typeof result.run.stepIds === 'undefined')
      runState.stepIds = []
  }
  else {
    runState.scriptId = ''
    runState.state = 'idle'
    runState.stepIds = []
  }
}

async function loadLogs() {
  if (!scriptId.value)
    return
  const result = await invoke('automation:script:logs', { scriptId: scriptId.value, since: 0 })
  if (result?.success) {
    logs.value = result.logs || []
    scrollLogToBottom()
  }
}

function scrollLogToBottom() {
  nextTick(() => {
    logScrollbar.value?.wrapRef?.scrollTo?.({ top: 999999 })
  })
}

function ensurePolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (isRunning.value) {
      await syncRunState()
      await pollLogs()
    }
    else if (runState.state === 'idle' || runState.state === 'stopped') {
      await pollLogs()
      stopPolling()
    }
  }, 700)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function pollLogs() {
  if (!scriptId.value)
    return
  const result = await invoke('automation:script:logs', { scriptId: scriptId.value, since: logs.value.length })
  if (result?.success && result.logs?.length) {
    logs.value.push(...result.logs)
    if (logs.value.length > 300)
      logs.value.splice(0, logs.value.length - 300)
    scrollLogToBottom()
  }
}

// Live events from the main process (log lines + state transitions).
function onAutomationEvent(event) {
  if (!event || event.scriptId !== scriptId.value)
    return
  if (event.type === 'log') {
    logs.value.push(event.entry)
    if (logs.value.length > 300)
      logs.value.splice(0, logs.value.length - 300)
    scrollLogToBottom()
  }
  else if (event.type === 'state') {
    Object.assign(runState, event)
    if (event.state === 'idle' || event.state === 'stopped')
      stopPolling()
  }
}

const logScrollbar = ref(null)

onMounted(async () => {
  window.$preload.ipcRenderer.on('automation:event', onAutomationEvent)
  invoke('automation:subscribe').catch(() => {})
  await refreshDevices()
})

onBeforeUnmount(() => {
  stopPolling()
  window.$preload.ipcRenderer.removeListener?.('automation:event', onAutomationEvent)
})
</script>

<style scoped>
.step-form :deep(.el-form-item__label) {
  font-size: 12px;
  line-height: 1.4;
  padding-bottom: 2px;
}
</style>
