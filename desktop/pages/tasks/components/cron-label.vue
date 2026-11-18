<template>
  <span>{{ rendered }}</span>
</template>

<script setup>
/**
 * Cron expression to readable label. Presets map to localized strings,
 * custom expressions fall back to a structural description.
 */
import { CRON_PRESETS } from '../configs/index.js'

const props = defineProps({
  expr: { type: String, default: '' },
})

const { t } = useI18n()

const WEEK_CN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const rendered = computed(() => {
  const expr = String(props.expr || '').trim()

  const preset = CRON_PRESETS.find(item => item.value === expr)
  if (preset && preset.value !== 'custom')
    return t(preset.label)

  const parts = expr.split(/\s+/)
  if (parts.length !== 5)
    return expr

  const [mi, h, dom, mon, dow] = parts
  const time = `${pad(h)}:${pad(mi)}`

  if (mi.startsWith('*/') && h === '*' && dom === '*' && mon === '*' && dow === '*')
    return t('tasks.cron.everyNMinutes', { n: mi.slice(2) })
  if (h.startsWith('*/') && dom === '*' && mon === '*' && dow === '*')
    return t('tasks.cron.everyNHours', { n: h.slice(2) })
  if (dom === '*' && mon === '*' && dow === '*' && /^\d+$/.test(mi) && /^\d+$/.test(h))
    return t('tasks.cron.dailyAt', { time })
  if (dom === '*' && mon === '*' && dow === '1-5' && /^\d+$/.test(mi) && /^\d+$/.test(h))
    return t('tasks.cron.weekdaysAt', { time })
  if (dom === '*' && mon === '*' && /^\d+(,\d+)*$/.test(dow) && /^\d+$/.test(mi) && /^\d+$/.test(h)) {
    const days = dow.split(',').map(d => t(`tasks.weekday.${WEEK_CN[Number(d) % 7]}`)).join(' / ')
    return t('tasks.cron.weeklyAt', { days, time })
  }
  if (dow === '*' && mon === '*' && /^\d+$/.test(dom) && /^\d+$/.test(mi) && /^\d+$/.test(h))
    return t('tasks.cron.monthlyAt', { day: dom, time })

  return expr
})

function pad(value) {
  const num = Number.parseInt(value, 10)
  if (Number.isNaN(num))
    return value
  return num < 10 ? `0${num}` : `${num}`
}
</script>
