<template>
  <div class="h-full flex flex-col">
    <BatchActions
      class="overflow-hidden transition-all"
      :class="hasSelection ? 'max-h-12 opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0'"
      :devices="selectedRows"
    />

    <div class="flex-1 min-h-0 overflow-hidden">
      <el-table
        ref="tableRef"
        v-loading="loading && !deviceList.length"
        :element-loading-text="$t('common.loading')"
        :data="deviceList"
        style="width: 100%"
        height="100%"
        row-key="id"
        class="el-table--beautify"
        @selection-change="onSelectionChange"
      >
        <template #empty>
          <AppEmpty v-show="!loading" :sub-title="$t('device.list.empty')">
          </AppEmpty>
        </template>

        <el-table-column type="selection" width="30"></el-table-column>

        <el-table-column
          :label="$t('device.serial')"
          sortable
          show-overflow-tooltip
          align="left"
          min-width="250"
        >
          <template #default="{ row }">
            <div class="flex items-center gap-2 relative">
              <DevicePopover :key="row.status" :device="row" class="" />

              <div class="flex-none max-w-[75%] truncate">
                {{ row.id }}
              </div>

              <el-link type="primary" underline="never" title="WIFI" class="flex-none">
                <i v-if="row.wifi" class="i-bi-wifi"></i>
              </el-link>
            </div>
          </template>
        </el-table-column>

        <el-table-column
          :label="$t('device.name')"
          prop="remark"
          sortable
          show-overflow-tooltip
          align="left"
          min-width="150"
          :filters="remarkFilters"
          :filter-method="remarkFilterMethod"
        >
          <template #default="{ row }">
            <Remark :device="row" class="" />
          </template>
        </el-table-column>

        <el-table-column
          v-slot="{ row }"
          :label="$t('device.status')"
          prop="status"
          align="left"
          sortable
          show-overflow-tooltip
          min-width="150"
          :filters="statusFilters"
          :filter-method="filterMethod"
        >
          <el-tag effect="plain" class="el-tag--plain-text" :type="getDictLabel('deviceStatus', row.status, { labelKey: 'tagType' })">
            <div class="flex items-center">
              <el-tooltip
                v-if="['unauthorized'].includes(row.status)"
                :content="$t('device.permission.error')"
                placement="top"
              >
                <el-link type="danger" underline="never" icon="WarningFilled" class="mr-1 flex-none"></el-link>
              </el-tooltip>

              <span class="flex-none">{{ $t(getDictLabel('deviceStatus', row.status)) || '-' }}</span>
            </div>
          </el-tag>
        </el-table-column>

        <el-table-column
          v-slot="{ row }"
          :label="$t('common.actions')"
          align="left"
          min-width="150"
        >
          <div class="flex items-center gap-1 !*:ml-0">
            <ConnectAction
              v-if="['offline'].includes(row.status) && row.wifi"
              v-bind="{
                device: row,
                handleConnect,
              }"
            />

            <MirrorAction
              v-if="['device', 'unauthorized'].includes(row.status)"
              :ref="getMirrorActionRefs"
              v-bind="{ row, toggleRowExpansion }"
            />

            <MoreDropdown v-if="['device'].includes(row.status)" v-bind="{ row, toggleRowExpansion }" />

            <WirelessAction v-if="['device', 'unauthorized'].includes(row.status)" v-bind="{ row, handleConnect, handleRefresh }" />

            <RemoveAction
              v-if="['offline'].includes(row.status)"
              v-bind="{
                device: row,
                handleRefresh,
              }"
            />
          </div>
        </el-table-column>
        <el-table-column type="expand">
          <template #header>
            <el-icon class="" :title="$t('device.control.more')">
              <Operation class="" />
            </el-icon>
          </template>

          <template #default="{ row }">
            <ControlBar :device="row" :swapy-enabled="true" button-class="!min-w-10 !w-4vw !max-w-12" />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="flex-none flex items-center py-1 overflow-hidden py-2">
      <div class="flex-none">
        <WirelessGroup ref="wirelessGroupRef" v-bind="{ handleRefresh }" @auto-connected="onAutoConnected" />
      </div>

      <div class="flex-1 w-0 gap-2 flex items-center justify-end">
        <el-button
          type="default"
          :icon="loading ? '' : 'Refresh'"
          :loading="loading"
          circle
          :title="$t('device.refresh.name')"
          @click="handleRefresh"
        >
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { uniqBy } from 'lodash-es'
import { sleep } from '$/utils/index.js'

import AppEmpty from '$/components/app-empty/index.vue'
import BatchActions from './components/batch-actions/index.vue'
import ControlBar from '$/components/control-bar/index.vue'
import MirrorAction from './components/mirror-action/index.vue'
import MoreDropdown from './components/more-dropdown/index.vue'
import Remark from './components/remark/index.vue'
import WirelessAction from './components/wireless-action/index.vue'
import ConnectAction from './components/connect-action/index.vue'
import RemoveAction from './components/remove-action/index.vue'
import WirelessGroup from './components/wireless-group/index.vue'
import DevicePopover from './components/device-popover/index.vue'

import { getDictLabel } from '$/dicts/helper'
import { deviceStatus } from '$/dicts/index.js'

const deviceStore = useDeviceStore()
const preferenceStore = usePreferenceStore()

const loading = ref(false)

const mirrorActionRefs = ref([])
const selectedRows = ref([])

const tableRef = ref(null)
const wirelessGroupRef = ref(null)

const deviceList = computed({
  get: () => deviceStore.list,
  set: (val) => {
    deviceStore.list = val
  },
})

const hasSelection = computed(() => selectedRows.value.length > 0)

const statusFilters = computed(() => {
  return deviceStatus
    .map(item => ({
      text: window.t(item.label),
      value: item.value,
    }))
    .filter(item => !['emulator'].includes(item.value))
})

const remarkFilters = computed(() => {
  const value = deviceList.value
    .map(item => ({
      text: item.remark ?? item.name,
      value: item.remark ?? item.name,
    }))
  return uniqBy(value, 'value')
})

function remarkFilterMethod(value, row, column) {
  const target = row.remark || row.name
  return target === value
}

async function getDeviceData(options = {}) {
  const { unloading = false } = options

  if (!unloading) {
    loading.value = true
  }

  try {
    await deviceStore.getList()
  }
  catch (error) {
    const message = error?.message || error?.cause?.message || ''
    console.warn('Device list fetch error:', message)

    if (message.includes('failed to start daemon')) {
      await getDeviceData()
      return false
    }

    if (message) {
      ElMessage.warning(message)
    }

    deviceList.value = []
  }

  loading.value = false
}

function filterMethod(value, row, column) {
  const property = column.property
  return row[property] === value
}

function onSelectionChange(rows) {
  selectedRows.value = rows
}

async function onAdbWatch(type, ret) {
  if (ret && ret.id) {
    await sleep(1000)
    getDeviceData()
  }

  if (type === 'remove') {
    mirrorActionRefs.value = mirrorActionRefs.value.filter(
      item => item.row.id !== ret.id,
    )
  }
}

// ── lightweight device-state polling ────────────────────
// The adb tracker (above) is the primary update source, but it can miss state
// flips (device⇄offline arrives as 'change') or go deaf when the tracker
// socket breaks. This raw poll (no enrichment shell calls) compares a cheap
// signature and only triggers a full refresh when the state actually changed,
// so a device that flapped to "offline" self-heals in the UI without the user
// unplugging and replugging it.
//
// Double-confirmation: a single `adb devices` call can itself lie for a
// moment (daemon hiccup, USB enumeration race) — that is exactly the
// "connected device randomly shows offline" bug. A signature change is only
// applied after a second poll taken 1.5s later agrees with the first.
let devicePollTimer = null
let lastRawSignature = null
let confirmTimer = null

async function pollDeviceStatus() {
  if (document.hidden)
    return

  let raw
  try {
    raw = await window.$preload.adb.getRawDeviceList()
  }
  catch {
    // adb hiccup — tracker reconnect + health check handle recovery
    return
  }

  const signature = (raw || []).map(device => `${device.id}:${device.type}`).sort().join('|')
  if (signature === lastRawSignature)
    return

  // First poll after mount: just record the baseline (the initial full load
  // already happened in onMounted), nothing to double-confirm against.
  if (lastRawSignature === null) {
    lastRawSignature = signature
    return
  }

  // A change away from the confirmed baseline: confirm before applying.
  if (!confirmTimer) {
    confirmTimer = setTimeout(async () => {
      confirmTimer = null

      try {
        const recheck = await window.$preload.adb.getRawDeviceList()
        const recheckSignature = (recheck || []).map(device => `${device.id}:${device.type}`).sort().join('|')

        if (recheckSignature === signature && signature !== lastRawSignature) {
          lastRawSignature = signature
          getDeviceData({ unloading: true })
        }
        else if (recheckSignature === lastRawSignature) {
          // transient flicker that already resolved — ignore it
        }
        else {
          // a different state again — next poll cycle will re-confirm
        }
      }
      catch {
        // adb hiccup during confirmation — leave state untouched
      }
    }, 1500)
  }
}

let autoMirrorTimer
let autoMirrorLock = false
async function getMirrorActionRefs(ref) {
  if (!ref?.row?.id) {
    return false
  }

  if (['unauthorized', 'offline'].includes(ref.row.status)) {
    return false
  }

  const exists = mirrorActionRefs.value.some(item => item.row.id === ref.row.id)
  if (exists) {
    return false
  }

  mirrorActionRefs.value.push(ref)

  const autoMirrorFlag = preferenceStore.data.autoMirror

  if (!autoMirrorFlag || autoMirrorLock) {
    return false
  }

  autoMirrorLock = true

  if (autoMirrorTimer) {
    clearTimeout(autoMirrorTimer)
  }
  autoMirrorTimer = setTimeout(async () => {
    for (const item of mirrorActionRefs.value) {
      await item.handleClick(item.row)
      await sleep()
    }
  }, 1000)
}

function toggleRowExpansion(...args) {
  tableRef.value.toggleRowExpansion(...args)
}

function handleConnect(...args) {
  wirelessGroupRef.value.connect(...args)
}

async function handleRefresh() {
  loading.value = true
  await sleep()
  getDeviceData({ resetResolve: true, unloading: true })
}

function onAutoConnected() {}

let unAdbWatch = null

onMounted(async () => {
  await getDeviceData()
  unAdbWatch = await window.$preload.adb.watch(onAdbWatch)
  devicePollTimer = setInterval(pollDeviceStatus, 5000)
})

onBeforeUnmount(() => {
  unAdbWatch?.()
  if (devicePollTimer) {
    clearInterval(devicePollTimer)
    devicePollTimer = null
  }
  if (confirmTimer) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
})

onActivated(() => {
  getDeviceData()
})
</script>

<style lang="postcss" scoped>
:deep() {
  .el-table {
    --el-empty-image-width: 24vh;
    .el-table__row .cell {
      @apply !py-1;
    }

    .el-table__expanded-cell {
      @apply !py-0;
    }
  }
}
</style>
