//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

const defaultHourUnits = ['h', 'hr', 'hrs', 'hour', 'hours']
const defaultMinuteUnits = ['m', 'min', 'mins', 'minute', 'minutes']

const tokenRe = /(\d+(?:\.\d+)?|\.\d+)\s*([^\d\s.:+-]+)?\s*/y

function normalizeUnits (defaults: string[], extra: string[]): Set<string> {
  return new Set([...defaults, ...extra.map((it) => it.trim().toLowerCase()).filter((it) => it !== '')])
}

/**
 * Parse a spent time input into hours.
 *
 * Accepts decimal hours ("1.5", "1,5"), clock notation ("1:30") and
 * hour/minute units ("1h 30m", "45m", "1h30", "2 hours"). Additional
 * (localized) unit labels can be passed. Returns undefined for empty or
 * invalid input.
 */
export function parseTimeReportValue (
  input: string | undefined,
  hourUnits: string[] = [],
  minuteUnits: string[] = []
): number | undefined {
  let text = (input ?? '').trim().toLowerCase().replace(/,/g, '.')
  let sign = 1
  if (text.startsWith('-')) {
    sign = -1
    text = text.slice(1).trim()
  }
  if (text === '') return undefined

  const clock = /^(\d+):([0-5]\d)$/.exec(text)
  if (clock !== null) {
    return sign * (Number(clock[1]) + Number(clock[2]) / 60)
  }
  if (/^(\d+(\.\d*)?|\.\d+)$/.test(text)) {
    return sign * Number(text)
  }

  const hours = normalizeUnits(defaultHourUnits, hourUnits)
  const minutes = normalizeUnits(defaultMinuteUnits, minuteUnits)
  let total = 0
  let hasHours = false
  let hasMinutes = false
  let pos = 0
  while (pos < text.length) {
    tokenRe.lastIndex = pos
    const match = tokenRe.exec(text)
    if (match === null) return undefined
    pos = tokenRe.lastIndex
    const num = Number(match[1])
    const unit = match[2]
    if (unit !== undefined && hours.has(unit) && !hasHours && !hasMinutes) {
      total += num
      hasHours = true
    } else if (
      (unit !== undefined && minutes.has(unit)) ||
      // "1h30": a bare trailing number after hours means minutes
      (unit === undefined && hasHours && pos === text.length)
    ) {
      if (hasMinutes) return undefined
      total += num / 60
      hasMinutes = true
    } else {
      return undefined
    }
  }
  return sign * total
}

/**
 * Format hours as an editable "Xh Ym" string, which parseTimeReportValue accepts.
 */
export function formatTimeReportValue (value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  const sign = value < 0 ? '-' : ''
  const totalMinutes = Math.round(Math.abs(value) * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || h === 0) parts.push(`${m}m`)
  return sign + parts.join(' ')
}
