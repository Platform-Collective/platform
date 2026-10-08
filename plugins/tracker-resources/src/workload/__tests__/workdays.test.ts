//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { isWorkingDay } from '@hcengineering/gantt'
import { dayOf } from '../../calendar/grid'
import {
  DEFAULT_WEEKDAY_MASK,
  DEFAULT_WORKING_CALENDAR,
  effectiveWorkingCalendar,
  WORKDAY_WINDOW_DAYS,
  WorkdayIndex
} from '../workdays'

const DAY_MS = 86400000
// 5 October 2026 is a Monday
const MON = dayOf(2026, 9, 5)
const holiday = (day: number): number => day * DAY_MS

describe('effectiveWorkingCalendar', () => {
  it('plans a project without a calendar on Monday to Friday, unlike the Gantt', () => {
    const cal = effectiveWorkingCalendar(undefined, [holiday(MON)])
    expect(cal.weekdayMask).toBe(DEFAULT_WEEKDAY_MASK)
    // The holidays belong to a project that opted in
    expect(cal.holidays).toEqual([])
    expect(DEFAULT_WORKING_CALENDAR.holidays).toEqual([])
  })

  it('takes the weekdays and the holidays of the project', () => {
    const cal = effectiveWorkingCalendar({ weekdayMask: 63 }, [holiday(MON)])
    expect(cal).toEqual({ weekdayMask: 63, holidays: [holiday(MON)] })
  })

  it('does not share the list of holidays', () => {
    const list = [holiday(MON)]
    const cal = effectiveWorkingCalendar({ weekdayMask: 31 }, list)
    list.push(1)
    expect(cal.holidays).toHaveLength(1)
  })

  it('falls back for a damaged mask', () => {
    expect(effectiveWorkingCalendar({ weekdayMask: Number.NaN }, []).weekdayMask).toBe(DEFAULT_WEEKDAY_MASK)
    expect(effectiveWorkingCalendar({ weekdayMask: 'x' as any }, []).weekdayMask).toBe(DEFAULT_WEEKDAY_MASK)
  })
})

describe('WorkdayIndex', () => {
  const cal = { weekdayMask: 31, holidays: [] }

  it('classifies weekdays', () => {
    const index = new WorkdayIndex(MON - 14, MON + 28, cal)
    for (let i = 0; i < 5; i++) expect(index.isWorkday(MON + i)).toBe(true)
    expect(index.isWorkday(MON + 5)).toBe(false)
    expect(index.isWorkday(MON + 6)).toBe(false)
    expect(index.isWorkday(MON + 7)).toBe(true)
  })

  it('treats holidays as non-working days', () => {
    const index = new WorkdayIndex(MON - 14, MON + 28, { weekdayMask: 31, holidays: [holiday(MON + 1), holiday(MON + 5)] })
    expect(index.isWorkday(MON + 1)).toBe(false)
    expect(index.count(MON, MON + 4)).toBe(4)
    // A holiday on a weekend changes nothing
    expect(index.count(MON, MON + 6)).toBe(4)
  })

  it('honours another weekday mask (Monday to Saturday, all days, none)', () => {
    expect(new WorkdayIndex(MON, MON + 7, { weekdayMask: 63, holidays: [] }).count(MON, MON + 6)).toBe(6)
    expect(new WorkdayIndex(MON, MON + 7, { weekdayMask: 127, holidays: [] }).count(MON, MON + 6)).toBe(7)
    expect(new WorkdayIndex(MON, MON + 7, { weekdayMask: 0, holidays: [] }).count(MON, MON + 6)).toBe(0)
    // Sunday only
    expect(new WorkdayIndex(MON, MON + 7, { weekdayMask: 64, holidays: [] }).isWorkday(MON + 6)).toBe(true)
  })

  it('counts both ends of a span', () => {
    const index = new WorkdayIndex(MON - 14, MON + 28, cal)
    expect(index.count(MON, MON)).toBe(1)
    expect(index.count(MON, MON + 4)).toBe(5)
    expect(index.count(MON + 5, MON + 6)).toBe(0)
    expect(index.count(MON, MON + 13)).toBe(10)
    expect(index.count(MON + 3, MON)).toBe(0)
  })

  it('does not count days outside the window', () => {
    const index = new WorkdayIndex(MON, MON + 7, cal)
    expect(index.count(MON - 100, MON + 100)).toBe(5)
    expect(index.isWorkday(MON - 1)).toBe(false)
    expect(index.has(MON + 7)).toBe(false)
  })

  it('agrees with the working day rule of the Gantt for every day', () => {
    const calendar = { weekdayMask: 0b0101101, holidays: [holiday(MON + 3), holiday(MON + 10)] }
    const index = new WorkdayIndex(MON - 50, MON + 50, calendar)
    for (let day = MON - 50; day < MON + 50; day++) {
      expect(index.isWorkday(day)).toBe(isWorkingDay(day * DAY_MS, calendar))
    }
  })

  it('is empty and safe for a reversed window', () => {
    const index = new WorkdayIndex(MON + 5, MON, cal)
    expect(index.size).toBe(0)
    expect(index.count(MON, MON + 10)).toBe(0)
  })

  it('covers a window around today', () => {
    const index = WorkdayIndex.around(MON, cal)
    expect(index.has(MON - WORKDAY_WINDOW_DAYS)).toBe(true)
    expect(index.has(MON + WORKDAY_WINDOW_DAYS)).toBe(true)
    expect(index.has(MON + WORKDAY_WINDOW_DAYS + 1)).toBe(false)
  })
})
