//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Time axis of the Roadmap layout. Everything is computed on whole calendar days in the local time zone
// (like iterations and Date fields), so that daylight saving shifts never move an item by a day.
// A day is addressed by its index: the number of days since 1970-01-01 of the local calendar date.

/** GitHub Projects zoom levels of a roadmap. */
export type RoadmapZoom = 'month' | 'quarter' | 'year'

export const ROADMAP_ZOOMS: readonly RoadmapZoom[] = ['month', 'quarter', 'year']

export const DEFAULT_ROADMAP_ZOOM: RoadmapZoom = 'month'

const DAY_MS = 86400000

/** Pixels of one day at each zoom level. */
export const PX_PER_DAY: Readonly<Record<RoadmapZoom, number>> = {
  month: 8,
  quarter: 3,
  year: 1
}

// Shortest time span the axis covers, so that a roadmap with few dates still has room to schedule in
const MIN_SPAN_DAYS: Readonly<Record<RoadmapZoom, number>> = {
  month: 186,
  quarter: 366,
  year: 1096
}

// Dates further from today than this do not stretch the axis (a typo like year 1970 must not create a huge canvas)
export const MAX_DISTANCE_DAYS = 3660

export function isRoadmapZoom (value: unknown): value is RoadmapZoom {
  return value === 'month' || value === 'quarter' || value === 'year'
}

// ---- days ----

/** Index of the local calendar day containing the timestamp. */
export function toDay (ts: number): number {
  const d = new Date(ts)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

/** Timestamp of the start (local midnight) of the day. */
export function dayToTime (day: number): number {
  const u = new Date(day * DAY_MS)
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime()
}

/**
 * Moves a timestamp by whole calendar days and keeps its time of day, so that a date that carries a time
 * (some pickers store one) keeps it when an item is rescheduled.
 */
export function shiftTimestamp (ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export interface DayParts {
  year: number
  // 0-11
  month: number
  // 1-31
  date: number
  // 0 (Sunday) - 6
  weekday: number
}

export function dayParts (day: number): DayParts {
  const u = new Date(day * DAY_MS)
  return { year: u.getUTCFullYear(), month: u.getUTCMonth(), date: u.getUTCDate(), weekday: u.getUTCDay() }
}

function utcDay (year: number, month: number, date: number = 1): number {
  return Math.round(Date.UTC(year, month, date) / DAY_MS)
}

export function monthStart (day: number): number {
  const p = dayParts(day)
  return utcDay(p.year, p.month)
}

export function quarterStart (day: number): number {
  const p = dayParts(day)
  return utcDay(p.year, p.month - (p.month % 3))
}

export function yearStart (day: number): number {
  return utcDay(dayParts(day).year, 0)
}

/** First day of the unit that follows the one that starts at `start`. */
function nextUnitStart (unit: TickKind, start: number): number {
  const p = dayParts(start)
  switch (unit) {
    case 'week':
      return start + 7
    case 'month':
      return utcDay(p.year, p.month + 1)
    case 'quarter':
      return utcDay(p.year, p.month + 3)
    case 'year':
      return utcDay(p.year + 1, 0)
  }
}

/** The Monday of the week containing the day. */
export function weekStart (day: number): number {
  const wd = dayParts(day).weekday
  return day - ((wd + 6) % 7)
}

// ---- scale ----

export interface RoadmapScale {
  zoom: RoadmapZoom
  pxPerDay: number
  // First day of the axis
  startDay: number
  // First day after the axis
  endDay: number
  // Width of the axis in pixels
  width: number
  // X of the left edge of the day
  dayToX: (day: number) => number
  // The day under an x coordinate (relative to the axis start)
  xToDay: (x: number) => number
}

export function createScale (zoom: RoadmapZoom, startDay: number, endDay: number): RoadmapScale {
  const pxPerDay = PX_PER_DAY[zoom]
  const end = Math.max(endDay, startDay + 1)
  return {
    zoom,
    pxPerDay,
    startDay,
    endDay: end,
    width: (end - startDay) * pxPerDay,
    dayToX: (day) => (day - startDay) * pxPerDay,
    xToDay: (x) => startDay + Math.floor(x / pxPerDay)
  }
}

function unitStart (zoom: Exclude<TickKind, 'week'>, day: number): number {
  switch (zoom) {
    case 'month':
      return monthStart(day)
    case 'quarter':
      return quarterStart(day)
    case 'year':
      return yearStart(day)
  }
}

/**
 * Widens a day range to whole units of the zoom level: months, quarters or years.
 * `endDay` of the result is exclusive.
 */
export function snapRange (zoom: RoadmapZoom, fromDay: number, toDay: number): { startDay: number, endDay: number } {
  const startDay = unitStart(zoom, fromDay)
  const last = unitStart(zoom, Math.max(toDay, fromDay))
  return { startDay, endDay: nextUnitStart(zoom, last) }
}

/**
 * Range of the axis for the dates of the items: covers all of them and today, extends to the minimal span of
 * the zoom level (with more room ahead of today than behind it) and is snapped to whole units.
 * Dates too far from today are ignored.
 */
export function computeRange (
  zoom: RoadmapZoom,
  days: Iterable<number>,
  today: number
): { startDay: number, endDay: number } {
  const lowest = today - MAX_DISTANCE_DAYS
  const highest = today + MAX_DISTANCE_DAYS
  const span = MIN_SPAN_DAYS[zoom]
  let from = today - Math.floor(span / 3)
  let to = today + Math.ceil((span * 2) / 3)
  for (const d of days) {
    if (d < lowest || d > highest) continue
    if (d < from) from = d
    if (d > to) to = d
  }
  return snapRange(zoom, from, to)
}

// ---- header ----

export type TickKind = 'year' | 'quarter' | 'month' | 'week'

export interface RoadmapTick {
  kind: TickKind
  startDay: number
  // First day after the tick
  endDay: number
  x: number
  width: number
  year: number
  // Month 0-11, quarter 1-4 or the day of the month of a week's Monday
  index: number
}

export interface HeaderRows {
  // Coarse row (months, quarters, years)
  top: RoadmapTick[]
  // Fine row (weeks, months, quarters); its boundaries are the grid lines
  bottom: RoadmapTick[]
}

function buildTicks (scale: RoadmapScale, kind: TickKind): RoadmapTick[] {
  const res: RoadmapTick[] = []
  let cursor = kind === 'week' ? weekStart(scale.startDay) : unitStart(kind, scale.startDay)
  while (cursor < scale.endDay) {
    const next = nextUnitStart(kind, cursor)
    const from = Math.max(cursor, scale.startDay)
    const to = Math.min(next, scale.endDay)
    const p = dayParts(cursor)
    res.push({
      kind,
      startDay: from,
      endDay: to,
      x: scale.dayToX(from),
      width: (to - from) * scale.pxPerDay,
      year: p.year,
      index: kind === 'month' ? p.month : kind === 'quarter' ? Math.floor(p.month / 3) + 1 : kind === 'week' ? p.date : p.year
    })
    cursor = next
  }
  return res
}

/** Header rows of a zoom level: months over weeks, quarters over months, years over quarters. */
export function headerRows (scale: RoadmapScale): HeaderRows {
  switch (scale.zoom) {
    case 'month':
      return { top: buildTicks(scale, 'month'), bottom: buildTicks(scale, 'week') }
    case 'quarter':
      return { top: buildTicks(scale, 'quarter'), bottom: buildTicks(scale, 'month') }
    case 'year':
      return { top: buildTicks(scale, 'year'), bottom: buildTicks(scale, 'quarter') }
  }
}

/** Label of a tick, e.g. "October 2026", "Q4 2026", "Oct" or "5". */
export function formatTick (tick: RoadmapTick, locale?: string, row: 'top' | 'bottom' = 'top'): string {
  switch (tick.kind) {
    case 'year':
      return String(tick.year)
    case 'quarter':
      return row === 'top' ? `Q${tick.index} ${tick.year}` : `Q${tick.index}`
    case 'month': {
      const date = new Date(Date.UTC(tick.year, tick.index, 1))
      return new Intl.DateTimeFormat(locale, {
        month: row === 'top' ? 'long' : 'short',
        ...(row === 'top' ? { year: 'numeric' as const } : {}),
        timeZone: 'UTC'
      }).format(date)
    }
    case 'week':
      return String(tick.index)
  }
}

// ---- interaction ----

/** Whole days a pointer movement of `dx` pixels stands for. */
export function pixelsToDays (dx: number, pxPerDay: number): number {
  const days = Math.round(dx / pxPerDay)
  // Avoid -0
  return days === 0 ? 0 : days
}

/** Scroll offset (of the axis) that puts the day at `anchor` (0..1) of a viewport of `viewportWidth` pixels. */
export function scrollLeftForDay (scale: RoadmapScale, day: number, viewportWidth: number, anchor: number = 0.33): number {
  const x = scale.dayToX(day) - viewportWidth * anchor
  return Math.max(0, Math.min(x, Math.max(0, scale.width - viewportWidth)))
}
