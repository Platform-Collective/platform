//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { isWorkingDay, type WorkingCalendar } from '@hcengineering/gantt'
import { MAX_DISTANCE_DAYS } from '../roadmap/timeScale'

// Working days of a project, for the capacity of the Workload layout. The rule is the one of the Gantt (it is the
// `isWorkingDay` of `@hcengineering/gantt`): `weekdayMask` has bit 0 for Monday and bit 6 for Sunday, a holiday is the
// UTC midnight timestamp of a calendar day. A day of the layouts is the index of the local calendar date (days since
// 1970-01-01), so the UTC midnight of the same date is exactly `day * DAY_MS` and the two frames agree.

const DAY_MS = 86400000

/** Monday to Friday. */
export const DEFAULT_WEEKDAY_MASK = 31

/**
 * What a project without `workingDaysConfig` works on. The Gantt takes such a project for "every day is a working
 * day", but a person has no capacity on a weekend, so the workload plans on Monday to Friday and no holidays.
 */
export const DEFAULT_WORKING_CALENDAR: Readonly<WorkingCalendar> = { weekdayMask: DEFAULT_WEEKDAY_MASK, holidays: [] }

/** Days around today that the index covers; a day outside it is not planned (see `MAX_DISTANCE_DAYS`). */
export const WORKDAY_WINDOW_DAYS = MAX_DISTANCE_DAYS + 800

/** The calendar to plan on: the one of the project when it has one, the default otherwise. */
export function effectiveWorkingCalendar (
  config: { weekdayMask: number } | undefined,
  holidays: readonly number[] | undefined
): WorkingCalendar {
  if (config === undefined || typeof config.weekdayMask !== 'number' || !Number.isFinite(config.weekdayMask)) {
    return { ...DEFAULT_WORKING_CALENDAR, holidays: [] }
  }
  return { weekdayMask: config.weekdayMask, holidays: [...(holidays ?? [])] }
}

/**
 * Which days of a window are working days, with prefix counts so that the working days of a span are counted in
 * constant time. Built once per calendar; the classification is the Gantt's `isWorkingDay`.
 */
export class WorkdayIndex {
  readonly fromDay: number
  // First day after the window
  readonly toDay: number
  private readonly flags: Uint8Array
  // prefix[i] is the number of working days among the first i days of the window
  private readonly prefix: Int32Array

  constructor (fromDay: number, toDay: number, calendar: WorkingCalendar) {
    this.fromDay = fromDay
    this.toDay = Math.max(toDay, fromDay)
    const size = this.toDay - this.fromDay
    this.flags = new Uint8Array(size)
    this.prefix = new Int32Array(size + 1)
    // The holiday scan of the Gantt is linear, so the holidays are looked up once per day of the window
    for (let i = 0; i < size; i++) {
      const working = isWorkingDay((this.fromDay + i) * DAY_MS, calendar)
      this.flags[i] = working ? 1 : 0
      this.prefix[i + 1] = this.prefix[i] + (working ? 1 : 0)
    }
  }

  /** The index that covers the window of days around today. */
  static around (today: number, calendar: WorkingCalendar): WorkdayIndex {
    return new WorkdayIndex(today - WORKDAY_WINDOW_DAYS, today + WORKDAY_WINDOW_DAYS + 1, calendar)
  }

  get size (): number {
    return this.toDay - this.fromDay
  }

  has (day: number): boolean {
    return day >= this.fromDay && day < this.toDay
  }

  isWorkday (day: number): boolean {
    return this.has(day) && this.flags[day - this.fromDay] === 1
  }

  /** Working days among the days `first` to `last`, both included; days outside the window do not count. */
  count (first: number, last: number): number {
    const a = Math.max(first, this.fromDay)
    const b = Math.min(last, this.toDay - 1)
    if (b < a) return 0
    return this.prefix[b - this.fromDay + 1] - this.prefix[a - this.fromDay]
  }
}
