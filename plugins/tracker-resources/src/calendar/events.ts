//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ItemSchedule } from '../roadmap/dates'
import { DAYS_IN_WEEK, type DayRange } from './grid'

// What the month and week grids draw: an item with two dates is a bar over the days from its start to its end, an item
// with one date (or whose two dates are the same day) is a chip in one day cell.

export interface CalendarEvent<T> {
  id: string
  item: T
  // First and last day, both inclusive
  start: number
  end: number
  // The start lies after the target, so the days are the other way round (drawn hatched)
  inverted: boolean
  // Position of the item in the list the view sorted; chips of a day keep this order
  order: number
}

/** Whether the event covers more than one day. */
export function isMultiDay<T> (event: Pick<CalendarEvent<T>, 'start' | 'end'>): boolean {
  return event.end > event.start
}

/**
 * Turns the schedules of the items into events (in the order of the items) and sets aside the items without a day.
 */
export function buildCalendarEvents<T> (
  items: readonly T[],
  idOf: (item: T) => string,
  scheduleOf: (item: T) => ItemSchedule
): { events: Array<CalendarEvent<T>>, unscheduled: T[] } {
  const events: Array<CalendarEvent<T>> = []
  const unscheduled: T[] = []
  items.forEach((item, order) => {
    const schedule = scheduleOf(item)
    switch (schedule.kind) {
      case 'unscheduled':
        unscheduled.push(item)
        break
      case 'marker':
        events.push({ id: idOf(item), item, start: schedule.day, end: schedule.day, inverted: false, order })
        break
      case 'range':
        events.push({
          id: idOf(item),
          item,
          start: schedule.start,
          end: schedule.target,
          inverted: schedule.inverted,
          order
        })
        break
    }
  })
  return { events, unscheduled }
}

/** The events that touch the days of the range. */
export function eventsInRange<T> (events: ReadonlyArray<CalendarEvent<T>>, range: DayRange): Array<CalendarEvent<T>> {
  return events.filter((e) => e.end >= range.start && e.start < range.end)
}

/** The events that cover a day: bars first (earliest start, then longest), then the chips in the sort order. */
export function eventsOnDay<T> (events: ReadonlyArray<CalendarEvent<T>>, day: number): Array<CalendarEvent<T>> {
  return events.filter((e) => e.start <= day && e.end >= day).sort(compareEvents)
}

/** Bars before chips; bars by start and length, chips (and equal bars) by the order of the items. */
export function compareEvents<T> (a: CalendarEvent<T>, b: CalendarEvent<T>): number {
  const am = isMultiDay(a)
  const bm = isMultiDay(b)
  if (am !== bm) return am ? -1 : 1
  if (am) {
    if (a.start !== b.start) return a.start - b.start
    const lengthDiff = b.end - b.start - (a.end - a.start)
    if (lengthDiff !== 0) return lengthDiff
  }
  return a.order - b.order
}

// ---- weeks ----

/** The part of an event that falls in one week row. */
export interface WeekSegment<T> {
  event: CalendarEvent<T>
  // Column of the first day of the segment in the week (0 is the first day of the week)
  col: number
  // Number of columns, 1-7
  span: number
  // The event started in an earlier week / goes on in a later one (drawn without that rounded edge)
  continuesBefore: boolean
  continuesAfter: boolean
  // Row of the segment below the day numbers, packed so that segments of a column never overlap
  lane: number
  // Left out because the cell has no room (counted in the "+N more" of its days)
  hidden: boolean
}

export interface WeekLayout<T> {
  startDay: number
  segments: Array<WeekSegment<T>>
  // Rows the segments need
  laneCount: number
  // Rows that are drawn; the one after them holds the "+N more" links when something is hidden
  visibleLanes: number
  // Segments left out per column
  hiddenByColumn: number[]
}

/**
 * Splits the events into the segments of one week and packs them into lanes: bars first, then the chips of each day in
 * the sort order, each in the first lane that is free in all of its columns. With `maxLanes` (the rows that fit in
 * the cell) lanes beyond the limit are hidden, leaving the last row for the "+N more" links.
 */
export function layoutWeek<T> (
  events: ReadonlyArray<CalendarEvent<T>>,
  startDay: number,
  maxLanes: number = Number.POSITIVE_INFINITY
): WeekLayout<T> {
  const endDay = startDay + DAYS_IN_WEEK - 1
  const inWeek = events.filter((e) => e.end >= startDay && e.start <= endDay).sort(compareEvents)

  // Free columns of every lane
  const lanes: boolean[][] = []
  const segments: Array<WeekSegment<T>> = []
  for (const event of inWeek) {
    const col = Math.max(event.start, startDay) - startDay
    const last = Math.min(event.end, endDay) - startDay
    const span = last - col + 1
    let lane = 0
    for (; lane < lanes.length; lane++) {
      let free = true
      for (let c = col; c <= last; c++) {
        if (lanes[lane][c]) {
          free = false
          break
        }
      }
      if (free) break
    }
    if (lane === lanes.length) lanes.push(new Array<boolean>(DAYS_IN_WEEK).fill(false))
    for (let c = col; c <= last; c++) lanes[lane][c] = true
    segments.push({
      event,
      col,
      span,
      continuesBefore: event.start < startDay,
      continuesAfter: event.end > endDay,
      lane,
      hidden: false
    })
  }

  const laneCount = lanes.length
  const overflow = laneCount > maxLanes
  const visibleLanes = overflow ? Math.max(0, Math.floor(maxLanes) - 1) : laneCount
  const hiddenByColumn = new Array<number>(DAYS_IN_WEEK).fill(0)
  if (overflow) {
    for (const s of segments) {
      if (s.lane < visibleLanes) continue
      s.hidden = true
      for (let c = s.col; c < s.col + s.span; c++) hiddenByColumn[c]++
    }
  }
  return { startDay, segments, laneCount, visibleLanes, hiddenByColumn }
}
