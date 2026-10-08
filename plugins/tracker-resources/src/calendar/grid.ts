//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { dayParts } from '../roadmap/timeScale'

// Grids of the Calendar layout. Everything is computed on whole calendar days (the index of the day since 1970-01-01 of
// the local calendar date, see roadmap/timeScale.ts), so a daylight saving change never gives a week of 6 or 8 days.

export type CalendarMode = 'month' | 'week' | 'agenda'

export const CALENDAR_MODES: readonly CalendarMode[] = ['month', 'week', 'agenda']

export const DAYS_IN_WEEK = 7

const DAY_MS = 86400000

/** Saturday and Sunday (0 is Sunday). */
export const DEFAULT_WEEKEND: readonly number[] = [0, 6]

export function isCalendarMode (value: unknown): value is CalendarMode {
  return value === 'month' || value === 'week' || value === 'agenda'
}

/**
 * The first day of the week as a weekday number (0 is Sunday, 1 Monday): the setting of the platform when it is a
 * valid weekday (Intl reports Sunday as 7), Monday otherwise.
 */
export function normalizeFirstDay (value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 7) return 1
  return value % 7
}

/** Index of the day with the given calendar date (month 0-11), also for a month or a date out of range. */
export function dayOf (year: number, month: number, date: number = 1): number {
  return Math.round(Date.UTC(year, month, date) / DAY_MS)
}

export function daysInMonth (year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

/** First day of the week that contains the day. */
export function weekStartOf (day: number, firstDay: number): number {
  const weekday = dayParts(day).weekday
  return day - ((weekday - firstDay + DAYS_IN_WEEK) % DAYS_IN_WEEK)
}

/** First day of the month that contains the day. */
export function monthStartOf (day: number): number {
  const p = dayParts(day)
  return dayOf(p.year, p.month, 1)
}

/** The same date `count` months later (or earlier); a date that the month does not have (31st) becomes its last day. */
export function addMonths (day: number, count: number): number {
  const p = dayParts(day)
  const target = new Date(Date.UTC(p.year, p.month + count, 1))
  const year = target.getUTCFullYear()
  const month = target.getUTCMonth()
  return dayOf(year, month, Math.min(p.date, daysInMonth(year, month)))
}

export function isWeekendDay (day: number, weekend: readonly number[] = DEFAULT_WEEKEND): boolean {
  return weekend.includes(dayParts(day).weekday)
}

export interface CalendarDay {
  day: number
  year: number
  // 0-11
  month: number
  // 1-31
  date: number
  weekday: number
  // Whether the day belongs to the month that is shown (always true in a week)
  inMonth: boolean
  weekend: boolean
  today: boolean
}

export interface CalendarWeek {
  startDay: number
  days: CalendarDay[]
}

function makeDay (day: number, inMonthOf: number | undefined, today: number, weekend: readonly number[]): CalendarDay {
  const p = dayParts(day)
  const month = inMonthOf !== undefined ? dayParts(inMonthOf) : undefined
  return {
    day,
    year: p.year,
    month: p.month,
    date: p.date,
    weekday: p.weekday,
    inMonth: month === undefined || (month.year === p.year && month.month === p.month),
    weekend: weekend.includes(p.weekday),
    today: day === today
  }
}

function makeWeek (startDay: number, inMonthOf: number | undefined, today: number, weekend: readonly number[]): CalendarWeek {
  const days: CalendarDay[] = []
  for (let i = 0; i < DAYS_IN_WEEK; i++) days.push(makeDay(startDay + i, inMonthOf, today, weekend))
  return { startDay, days }
}

/** The weeks of the month that contains `anchor`: whole weeks, from the one with the 1st to the one with the last day. */
export function buildMonthGrid (
  anchor: number,
  firstDay: number,
  today: number,
  weekend: readonly number[] = DEFAULT_WEEKEND
): CalendarWeek[] {
  const first = monthStartOf(anchor)
  const last = addMonths(first, 1) - 1
  const weeks: CalendarWeek[] = []
  for (let start = weekStartOf(first, firstDay); start <= last; start += DAYS_IN_WEEK) {
    weeks.push(makeWeek(start, anchor, today, weekend))
  }
  return weeks
}

/** The week that contains `anchor`. */
export function buildWeek (
  anchor: number,
  firstDay: number,
  today: number,
  weekend: readonly number[] = DEFAULT_WEEKEND
): CalendarWeek {
  return makeWeek(weekStartOf(anchor, firstDay), undefined, today, weekend)
}

export interface DayRange {
  // First day
  start: number
  // First day after the range
  end: number
}

/**
 * The days a mode shows: the whole weeks of the month grid, the week, or the month for the agenda.
 */
export function visibleRange (mode: CalendarMode, anchor: number, firstDay: number): DayRange {
  switch (mode) {
    case 'month': {
      const weeks = buildMonthGrid(anchor, firstDay, 0)
      return { start: weeks[0].startDay, end: weeks[weeks.length - 1].startDay + DAYS_IN_WEEK }
    }
    case 'week': {
      const start = weekStartOf(anchor, firstDay)
      return { start, end: start + DAYS_IN_WEEK }
    }
    case 'agenda': {
      const start = monthStartOf(anchor)
      return { start, end: addMonths(start, 1) }
    }
  }
}

/** The anchor after the Previous (-1) or Next (1) button: a week in the week mode, a month in the others. */
export function shiftAnchor (mode: CalendarMode, anchor: number, direction: -1 | 1): number {
  return mode === 'week' ? anchor + direction * DAYS_IN_WEEK : addMonths(anchor, direction)
}

/** Whether the day is inside the range. */
export function rangeHas (range: DayRange, day: number): boolean {
  return day >= range.start && day < range.end
}

/**
 * The anchor that shows a day: the same anchor when the day is visible already, the day itself otherwise.
 */
export function anchorForDay (mode: CalendarMode, anchor: number, day: number, firstDay: number): number {
  return rangeHas(visibleRange(mode, anchor, firstDay), day) ? anchor : day
}

// ---- keyboard ----

export type FocusKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown'

const FOCUS_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']

export function isFocusKey (key: string): key is FocusKey {
  return FOCUS_KEYS.includes(key)
}

/**
 * The day the keyboard focus moves to: arrows move by a day or a week, Home and End to the first and last day of the
 * week, Page Up and Page Down to the same date of the previous and next month.
 */
export function moveFocusDay (day: number, key: FocusKey, firstDay: number): number {
  switch (key) {
    case 'ArrowLeft':
      return day - 1
    case 'ArrowRight':
      return day + 1
    case 'ArrowUp':
      return day - DAYS_IN_WEEK
    case 'ArrowDown':
      return day + DAYS_IN_WEEK
    case 'Home':
      return weekStartOf(day, firstDay)
    case 'End':
      return weekStartOf(day, firstDay) + DAYS_IN_WEEK - 1
    case 'PageUp':
      return addMonths(day, -1)
    case 'PageDown':
      return addMonths(day, 1)
  }
}

// ---- labels ----

function utcDate (day: number): Date {
  return new Date(day * DAY_MS)
}

/** Names of the weekdays in the order of the week, starting with `firstDay`. */
export function weekdayLabels (firstDay: number, locale?: string, style: 'short' | 'long' = 'short'): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' })
  // The 4th of January 1970 is a Sunday
  const sunday = 3
  const res: string[] = []
  for (let i = 0; i < DAYS_IN_WEEK; i++) res.push(format.format(utcDate(sunday + ((firstDay + i) % DAYS_IN_WEEK))))
  return res
}

/** Title of the toolbar: "October 2026" for a month (and the agenda), "Oct 5 – 11, 2026" for a week. */
export function formatCalendarTitle (mode: CalendarMode, anchor: number, firstDay: number, locale?: string): string {
  if (mode !== 'week') {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(utcDate(anchor))
  }
  const start = weekStartOf(anchor, firstDay)
  const format = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const formatRange = (format as unknown as { formatRange?: (a: Date, b: Date) => string }).formatRange
  return typeof formatRange === 'function'
    ? formatRange.call(format, utcDate(start), utcDate(start + DAYS_IN_WEEK - 1))
    : `${format.format(utcDate(start))} – ${format.format(utcDate(start + DAYS_IN_WEEK - 1))}`
}

/** Long date of a day, e.g. for the title of the popup of a day. */
export function formatDayLong (day: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(utcDate(day))
}

/** Short heading of a day of the agenda, e.g. "Mon, Oct 5". */
export function formatDayShort (day: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    utcDate(day)
  )
}
