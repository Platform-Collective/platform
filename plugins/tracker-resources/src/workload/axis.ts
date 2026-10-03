//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { addMonths, monthStartOf, normalizeFirstDay, weekStartOf } from '../calendar/grid'
import { dayParts, MAX_DISTANCE_DAYS } from '../roadmap/timeScale'

// Time axis of the Workload layout: whole buckets (a day, a week or a month) in a row. Everything is computed on
// whole local calendar days (the day index of roadmap/timeScale.ts), so a daylight saving change never gives a week
// of 6 or 8 days.

export type WorkloadZoom = 'day' | 'week' | 'month'

export const WORKLOAD_ZOOMS: readonly WorkloadZoom[] = ['day', 'week', 'month']

export const DEFAULT_WORKLOAD_ZOOM: WorkloadZoom = 'week'

export function isWorkloadZoom (value: unknown): value is WorkloadZoom {
  return value === 'day' || value === 'week' || value === 'month'
}

/** Pixels of a bucket column at each zoom level. */
export const COLUMN_WIDTH: Readonly<Record<WorkloadZoom, number>> = {
  day: 44,
  week: 84,
  month: 108
}

// Most buckets one axis shows. A longer range is cut to this many buckets around today; the items outside are counted
// as out of range, never silently dropped.
export const MAX_BUCKETS: Readonly<Record<WorkloadZoom, number>> = {
  day: 366,
  week: 156,
  month: 72
}

// The span an axis shows at least, in days before and after today, so that a view with few dates still has room
const MIN_BEHIND_DAYS: Readonly<Record<WorkloadZoom, number>> = { day: 14, week: 56, month: 92 }
const MIN_AHEAD_DAYS: Readonly<Record<WorkloadZoom, number>> = { day: 42, week: 126, month: 276 }

export interface Bucket {
  index: number
  // First day
  start: number
  // First day after the bucket
  end: number
}

export interface WorkloadAxis {
  zoom: WorkloadZoom
  buckets: Bucket[]
  // First day of the axis and the first day after it
  startDay: number
  endDay: number
  // Index of the bucket that contains today, -1 when today is not on the axis
  todayIndex: number
  // Whether the range of the items was longer than the axis can show
  trimmed: boolean
}

/** First day of the bucket of the zoom level that contains the day. */
export function bucketStart (zoom: WorkloadZoom, day: number, firstDay: number): number {
  switch (zoom) {
    case 'day':
      return day
    case 'week':
      return weekStartOf(day, normalizeFirstDay(firstDay))
    case 'month':
      return monthStartOf(day)
  }
}

/** First day of the bucket that follows the one that starts at `start`. */
export function nextBucketStart (zoom: WorkloadZoom, start: number): number {
  switch (zoom) {
    case 'day':
      return start + 1
    case 'week':
      return start + 7
    case 'month':
      return addMonths(monthStartOf(start), 1)
  }
}

function buildBuckets (zoom: WorkloadZoom, fromDay: number, toDay: number, firstDay: number): Bucket[] {
  const res: Bucket[] = []
  let cursor = bucketStart(zoom, fromDay, firstDay)
  const last = bucketStart(zoom, Math.max(toDay, fromDay), firstDay)
  while (cursor <= last) {
    const next = nextBucketStart(zoom, cursor)
    res.push({ index: res.length, start: cursor, end: next })
    cursor = next
  }
  return res
}

/**
 * The axis for the days that items occupy: it covers all of them and today, is at least as long as the minimal span of
 * the zoom level (more room ahead of today than behind it) and is made of whole buckets. Days too far from today
 * are ignored, like on the roadmap, and a range of more than `MAX_BUCKETS` buckets is cut around today.
 */
export function computeAxis (
  zoom: WorkloadZoom,
  days: Iterable<number>,
  today: number,
  firstDay: number
): WorkloadAxis {
  const lowest = today - MAX_DISTANCE_DAYS
  const highest = today + MAX_DISTANCE_DAYS
  let from = today - MIN_BEHIND_DAYS[zoom]
  let to = today + MIN_AHEAD_DAYS[zoom]
  for (const d of days) {
    if (!Number.isFinite(d) || d < lowest || d > highest) continue
    if (d < from) from = d
    if (d > to) to = d
  }
  let buckets = buildBuckets(zoom, from, to, firstDay)
  let trimmed = false
  const cap = MAX_BUCKETS[zoom]
  if (buckets.length > cap) {
    trimmed = true
    const todayAt = buckets.findIndex((b) => today >= b.start && today < b.end)
    let first = Math.max(0, (todayAt >= 0 ? todayAt : 0) - Math.floor(cap / 4))
    if (first + cap > buckets.length) first = buckets.length - cap
    buckets = buckets.slice(first, first + cap).map((b, index) => ({ ...b, index }))
  }
  const todayIndex = buckets.findIndex((b) => today >= b.start && today < b.end)
  return {
    zoom,
    buckets,
    startDay: buckets[0].start,
    endDay: buckets[buckets.length - 1].end,
    todayIndex,
    trimmed
  }
}

/** Index of the bucket that contains the day (binary search), -1 when it is not on the axis. */
export function bucketIndexOfDay (axis: Pick<WorkloadAxis, 'buckets'>, day: number): number {
  const list = axis.buckets
  if (list.length === 0 || day < list[0].start || day >= list[list.length - 1].end) return -1
  let lo = 0
  let hi = list.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (list[mid].start <= day) lo = mid
    else hi = mid - 1
  }
  return lo
}

// ---- header ----

export interface HeaderGroup {
  // Index of the first bucket of the group and the number of buckets
  from: number
  count: number
  // The first day of the group: a month (day and week zoom) or a year (month zoom)
  day: number
  // Month 0-11 for a month group, -1 for a year group
  month: number
  year: number
}

/**
 * The coarse header row over the buckets: months over days and weeks, years over months. A week belongs to the month
 * its first day is in.
 */
export function headerGroups (axis: Pick<WorkloadAxis, 'zoom' | 'buckets'>): HeaderGroup[] {
  const res: HeaderGroup[] = []
  for (const bucket of axis.buckets) {
    const p = dayParts(bucket.start)
    const month = axis.zoom === 'month' ? -1 : p.month
    const last = res[res.length - 1]
    if (last !== undefined && last.year === p.year && last.month === month) {
      last.count++
    } else {
      res.push({ from: bucket.index, count: 1, day: bucket.start, month, year: p.year })
    }
  }
  return res
}

const DAY_MS = 86400000

const utcDate = (day: number): Date => new Date(day * DAY_MS)

/** Label of a group of the coarse header: "October 2026" or "2026". */
export function formatHeaderGroup (group: HeaderGroup, locale?: string): string {
  if (group.month < 0) return String(group.year)
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utcDate(group.day))
}

/** Short label of a bucket: "Mon 5" for a day, "5 Oct" style for a week, "Oct" for a month. */
export function formatBucketLabel (zoom: WorkloadZoom, bucket: Pick<Bucket, 'start'>, locale?: string): string {
  switch (zoom) {
    case 'day': {
      const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(utcDate(bucket.start))
      const date = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(utcDate(bucket.start))
      return `${weekday} ${date}`
    }
    case 'week':
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        utcDate(bucket.start)
      )
    case 'month':
      return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(utcDate(bucket.start))
  }
}

/** Long description of a bucket for tooltips and the panel: a date, a date range or a month. */
export function formatBucketRange (zoom: WorkloadZoom, bucket: Pick<Bucket, 'start' | 'end'>, locale?: string): string {
  if (zoom === 'month') {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      utcDate(bucket.start)
    )
  }
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  if (zoom === 'day') return format.format(utcDate(bucket.start))
  return `${format.format(utcDate(bucket.start))} – ${format.format(utcDate(bucket.end - 1))}`
}

// ---- viewport ----

/** The range of bucket indexes to draw for a scroll position: the visible ones plus `overscan` on each side. */
export function visibleBucketRange (
  scrollLeft: number,
  viewportWidth: number,
  columnWidth: number,
  count: number,
  overscan: number = 4
): { from: number, to: number } {
  if (count <= 0 || !(columnWidth > 0)) return { from: 0, to: -1 }
  const safeLeft = Number.isFinite(scrollLeft) ? Math.max(0, scrollLeft) : 0
  const safeWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const from = Math.max(0, Math.floor(safeLeft / columnWidth) - overscan)
  const to = Math.min(count - 1, Math.ceil((safeLeft + safeWidth) / columnWidth) + overscan)
  return { from: Math.min(from, count - 1), to }
}

/** Scroll offset that puts a bucket at `anchor` (0..1) of a viewport. */
export function scrollLeftForBucket (
  index: number,
  columnWidth: number,
  viewportWidth: number,
  contentWidth: number,
  anchor: number = 0.25
): number {
  const x = index * columnWidth - viewportWidth * anchor
  return Math.max(0, Math.min(x, Math.max(0, contentWidth - viewportWidth)))
}
