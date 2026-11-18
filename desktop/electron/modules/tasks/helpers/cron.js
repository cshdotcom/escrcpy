/**
 * Minimal five-field cron engine (minute hour day-of-month month day-of-week).
 * Supports star, step, value, range, list and range-step syntax in every field.
 * Times are evaluated in the host local timezone on purpose: users expect
 * "every day at 08:00" to mean their local 08:00.
 */

export class CronParseError extends Error {}

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 7],
}

function parseField(field, kind, isDow) {
  const [min, max] = RANGES[kind]
  const values = new Set()

  for (const part of String(field || '').split(',')) {
    const segment = part.trim()
    if (!segment)
      continue

    let range = segment
    let step = 1

    if (segment.includes('/')) {
      const [rangePart, stepPart] = segment.split('/')
      range = rangePart
      step = Number.parseInt(stepPart, 10)
      if (!Number.isFinite(step) || step <= 0)
        throw new CronParseError(`Invalid step "${stepPart}" in "${field}"`)
    }

    let lo
    let hi

    if (range === '*' || range === '') {
      lo = min
      hi = max
    }
    else if (range.includes('-')) {
      const [a, b] = range.split('-')
      lo = Number.parseInt(a, 10)
      hi = Number.parseInt(b, 10)
    }
    else {
      lo = Number.parseInt(range, 10)
      hi = segment.includes('/') ? max : lo
    }

    if (!Number.isFinite(lo) || !Number.isFinite(hi))
      throw new CronParseError(`Invalid value "${segment}" in "${field}"`)

    if (lo < min || hi > max || lo > hi) {
      if (!(isDow && hi === 7))
        throw new CronParseError(`Out of range "${segment}" in "${field}" (${kind} allows ${min}-${max})`)
    }

    for (let value = lo; value <= hi; value += step)
      values.add(isDow && value === 7 ? 0 : value)
  }

  if (!values.size)
    throw new CronParseError(`Empty field "${field}"`)

  return values
}

export function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/)

  if (parts.length !== 5)
    throw new CronParseError(`Expected 5 fields (minute hour day month weekday), got ${parts.length}: "${expr}"`)

  return {
    minute: parseField(parts[0], 'minute', false),
    hour: parseField(parts[1], 'hour', false),
    dom: parseField(parts[2], 'dom', false),
    month: parseField(parts[3], 'month', false),
    dow: parseField(parts[4], 'dow', true),
    domRestricted: parts[2].trim() !== '*',
    dowRestricted: parts[4].trim() !== '*',
  }
}

export function isValidCron(expr) {
  try {
    parseCron(expr)
    return true
  }
  catch {
    return false
  }
}

function dayMatches(fields, date) {
  if (!fields.month.has(date.getMonth() + 1))
    return false

  const domOk = fields.dom.has(date.getDate())
  const dowOk = fields.dow.has(date.getDay())

  // Standard Vixie cron semantics: when both day fields are restricted,
  // the day matches if either one does.
  if (fields.domRestricted && fields.dowRestricted)
    return domOk || dowOk
  if (fields.domRestricted)
    return domOk
  if (fields.dowRestricted)
    return dowOk

  return true
}

/**
 * Next run strictly after `from` (local time). Returns a Date or null when
 * no match exists within the search window (4 years, covers Feb 29).
 */
export function nextRun(from, expr) {
  let fields

  try {
    fields = parseCron(expr)
  }
  catch {
    return null
  }

  // Start scanning at the next full minute strictly after `from`.
  const start = new Date(from.getTime())
  start.setMinutes(start.getMinutes() + 1)
  start.setSeconds(0, 0)

  // Fast path: minute scan for the first 48 hours.
  const cursor = new Date(start.getTime())
  const fastEnd = start.getTime() + 48 * 3600 * 1000

  while (cursor.getTime() <= fastEnd) {
    if (fields.minute.has(cursor.getMinutes()) && fields.hour.has(cursor.getHours()) && dayMatches(fields, cursor))
      return new Date(cursor.getTime())

    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  // Slow path: day-level jumping for sparse schedules (e.g. yearly).
  const slowCursor = new Date(fastEnd + 60_000)
  const limitYear = start.getFullYear() + 4

  while (slowCursor.getFullYear() <= limitYear) {
    if (!dayMatches(fields, slowCursor)) {
      slowCursor.setDate(slowCursor.getDate() + 1)
      slowCursor.setHours(0, 0, 0, 0)
      continue
    }

    for (let hour = 0; hour <= 23; hour++) {
      if (!fields.hour.has(hour))
        continue

      for (let minute = 0; minute <= 59; minute++) {
        if (!fields.minute.has(minute))
          continue

        const candidate = new Date(slowCursor)
        candidate.setHours(hour, minute, 0, 0)

        if (candidate.getTime() > start.getTime())
          return candidate
      }
    }

    slowCursor.setDate(slowCursor.getDate() + 1)
  }

  return null
}

/** Upcoming `count` run times strictly after `from`. */
export function nextRuns(from, expr, count = 5) {
  const runs = []
  let cursor = new Date(from.getTime())

  for (let index = 0; index < count; index++) {
    const value = nextRun(cursor, expr)
    if (!value)
      break

    runs.push(value)
    cursor = value
  }

  return runs
}
