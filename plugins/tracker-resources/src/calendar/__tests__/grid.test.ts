//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { dayParts, dayToTime, toDay } from '../../roadmap/timeScale'
import {
  addMonths,
  anchorForDay,
  buildMonthGrid,
  buildWeek,
  dayOf,
  daysInMonth,
  formatCalendarTitle,
  isFocusKey,
  isWeekendDay,
  monthStartOf,
  moveFocusDay,
  normalizeFirstDay,
  rangeHas,
  shiftAnchor,
  visibleRange,
  weekdayLabels,
  weekStartOf
} from '../grid'

const local = (y: number, m: number, d: number, h = 0): number => new Date(y, m - 1, d, h).getTime()
const day = (y: number, m: number, d: number): number => toDay(local(y, m, d))

const MONDAY = 1
const SUNDAY = 0
const SATURDAY = 6

describe('normalizeFirstDay', () => {
  it('keeps a valid weekday and maps Intl Sunday (7) to 0', () => {
    expect(normalizeFirstDay(0)).toBe(0)
    expect(normalizeFirstDay(1)).toBe(1)
    expect(normalizeFirstDay(6)).toBe(6)
    expect(normalizeFirstDay(7)).toBe(0)
  })

  it('falls back to Monday for anything else', () => {
    for (const v of [undefined, null, 'x', -1, 8, 1.5, NaN]) expect(normalizeFirstDay(v)).toBe(MONDAY)
  })
})

describe('months and weeks', () => {
  it('knows the length of a month, leap years included', () => {
    expect(daysInMonth(2026, 1)).toBe(28)
    expect(daysInMonth(2028, 1)).toBe(29)
    expect(daysInMonth(2026, 9)).toBe(31)
    expect(daysInMonth(2026, 10)).toBe(30)
  })

  it('finds the first day of the week for every week start', () => {
    // Saturday the 3rd of October 2026
    const d = day(2026, 10, 3)
    expect(dayParts(d).weekday).toBe(SATURDAY)
    expect(weekStartOf(d, MONDAY)).toBe(day(2026, 9, 28))
    expect(weekStartOf(d, SUNDAY)).toBe(day(2026, 9, 27))
    expect(weekStartOf(d, SATURDAY)).toBe(d)
    // A day that is the first day of its week stays
    expect(weekStartOf(day(2026, 9, 28), MONDAY)).toBe(day(2026, 9, 28))
  })

  it('adds months and clamps the date to the length of the target month', () => {
    expect(addMonths(day(2026, 1, 31), 1)).toBe(day(2026, 2, 28))
    expect(addMonths(day(2028, 1, 31), 1)).toBe(day(2028, 2, 29))
    expect(addMonths(day(2026, 3, 31), -1)).toBe(day(2026, 2, 28))
    expect(addMonths(day(2026, 12, 15), 1)).toBe(day(2027, 1, 15))
    expect(addMonths(day(2026, 1, 15), -1)).toBe(day(2025, 12, 15))
    expect(addMonths(day(2026, 5, 10), 14)).toBe(day(2027, 7, 10))
  })

  it('finds the weekend', () => {
    expect(isWeekendDay(day(2026, 10, 3))).toBe(true)
    expect(isWeekendDay(day(2026, 10, 4))).toBe(true)
    expect(isWeekendDay(day(2026, 10, 5))).toBe(false)
    expect(isWeekendDay(day(2026, 10, 2), [5, 6])).toBe(true)
  })
})

describe('buildMonthGrid', () => {
  const today = day(2026, 10, 3)

  it('has whole weeks from the one with the 1st to the one with the last day (Monday start)', () => {
    // October 2026 starts on a Thursday and ends on a Saturday
    const weeks = buildMonthGrid(day(2026, 10, 20), MONDAY, today)
    expect(weeks).toHaveLength(5)
    expect(weeks[0].startDay).toBe(day(2026, 9, 28))
    expect(weeks[0].days[0].day).toBe(day(2026, 9, 28))
    expect(weeks[4].days[6].day).toBe(day(2026, 11, 1))
    for (const w of weeks) expect(w.days).toHaveLength(7)
  })

  it('starts the weeks on Sunday when asked to', () => {
    const weeks = buildMonthGrid(day(2026, 10, 20), SUNDAY, today)
    expect(weeks[0].startDay).toBe(day(2026, 9, 27))
    expect(dayParts(weeks[0].startDay).weekday).toBe(SUNDAY)
  })

  it('needs 6 weeks for a month that starts late in the week and 4 for a short one that starts on the first day', () => {
    // August 2026 starts on a Saturday, 31 days
    expect(buildMonthGrid(day(2026, 8, 10), MONDAY, today)).toHaveLength(6)
    // February 2027 starts on a Monday, 28 days
    expect(buildMonthGrid(day(2027, 2, 10), MONDAY, today)).toHaveLength(4)
  })

  it('marks the days of the month, today and the weekend', () => {
    const weeks = buildMonthGrid(day(2026, 10, 20), MONDAY, today)
    const all = weeks.flatMap((w) => w.days)
    expect(all.filter((d) => d.inMonth)).toHaveLength(31)
    expect(all.filter((d) => d.today).map((d) => d.day)).toEqual([today])
    expect(all.every((d) => d.weekend === (d.weekday === 0 || d.weekday === 6))).toBe(true)
    expect(all[0]).toMatchObject({ inMonth: false, month: 8, date: 28 })
  })

  it('has consecutive days with no gap and no repeat', () => {
    for (const first of [SUNDAY, MONDAY, SATURDAY]) {
      const days = buildMonthGrid(day(2026, 10, 1), first, today).flatMap((w) => w.days.map((d) => d.day))
      for (let i = 1; i < days.length; i++) expect(days[i]).toBe(days[i - 1] + 1)
    }
  })

  it('does not lose or repeat a day around a daylight saving change', () => {
    // Changes of the clock in Europe, the US and New Zealand fall in these months; whatever the time zone of the run is
    for (const [y, m] of [
      [2026, 3],
      [2026, 4],
      [2026, 9],
      [2026, 10],
      [2026, 11]
    ]) {
      const weeks = buildMonthGrid(day(y, m, 15), MONDAY, today)
      const days = weeks.flatMap((w) => w.days)
      expect(days.length).toBe(weeks.length * 7)
      expect(days.filter((d) => d.inMonth)).toHaveLength(daysInMonth(y, m - 1))
      for (const d of days) {
        // Every cell is a distinct local calendar date that maps back to itself
        expect(toDay(dayToTime(d.day))).toBe(d.day)
        expect(new Date(dayToTime(d.day)).getDate()).toBe(d.date)
      }
      for (let i = 1; i < days.length; i++) expect(days[i].day).toBe(days[i - 1].day + 1)
    }
  })
})

describe('buildWeek', () => {
  it('is the week of the day with the right first day', () => {
    const w = buildWeek(day(2026, 10, 3), MONDAY, day(2026, 10, 3))
    expect(w.days.map((d) => d.date)).toEqual([28, 29, 30, 1, 2, 3, 4])
    expect(w.days.every((d) => d.inMonth)).toBe(true)
    expect(w.days[5].today).toBe(true)
    const s = buildWeek(day(2026, 10, 3), SUNDAY, 0)
    expect(s.days[0].day).toBe(day(2026, 9, 27))
  })

  it('has 7 days across the clock change', () => {
    // Europe moves the clock on the 25th of October 2026, the US on the 1st of November
    for (const d of [day(2026, 10, 25), day(2026, 11, 1), day(2026, 3, 29), day(2026, 3, 8), day(2026, 4, 5), day(2026, 9, 27)]) {
      const w = buildWeek(d, MONDAY, 0)
      expect(w.days).toHaveLength(7)
      expect(w.days.map((x) => x.day)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => w.startDay + i))
      expect(new Set(w.days.map((x) => x.date)).size).toBe(7)
    }
  })
})

describe('visibleRange and navigation', () => {
  it('covers the whole weeks of the grid in the month mode', () => {
    const r = visibleRange('month', day(2026, 10, 20), MONDAY)
    expect(r).toEqual({ start: day(2026, 9, 28), end: day(2026, 11, 2) })
  })

  it('is the week in the week mode and exactly the month for the agenda', () => {
    expect(visibleRange('week', day(2026, 10, 3), MONDAY)).toEqual({ start: day(2026, 9, 28), end: day(2026, 10, 5) })
    expect(visibleRange('agenda', day(2026, 10, 20), MONDAY)).toEqual({ start: day(2026, 10, 1), end: day(2026, 11, 1) })
  })

  it('moves by a month, or a week in the week mode', () => {
    expect(shiftAnchor('month', day(2026, 10, 31), 1)).toBe(day(2026, 11, 30))
    expect(shiftAnchor('agenda', day(2026, 1, 31), -1)).toBe(day(2025, 12, 31))
    expect(shiftAnchor('week', day(2026, 10, 3), 1)).toBe(day(2026, 10, 10))
    expect(shiftAnchor('week', day(2026, 10, 3), -1)).toBe(day(2026, 9, 26))
  })

  it('walks forward and back to where it started within a month length', () => {
    const start = day(2026, 6, 15)
    let a = start
    for (let i = 0; i < 12; i++) a = shiftAnchor('month', a, 1)
    expect(a).toBe(day(2027, 6, 15))
    for (let i = 0; i < 12; i++) a = shiftAnchor('month', a, -1)
    expect(a).toBe(start)
  })

  it('keeps the anchor when the day is visible and jumps to the day otherwise', () => {
    const anchor = day(2026, 10, 20)
    expect(anchorForDay('month', anchor, day(2026, 10, 31), MONDAY)).toBe(anchor)
    // The grid shows the first days of November
    expect(anchorForDay('month', anchor, day(2026, 11, 1), MONDAY)).toBe(anchor)
    expect(anchorForDay('month', anchor, day(2026, 11, 20), MONDAY)).toBe(day(2026, 11, 20))
    expect(rangeHas({ start: 5, end: 8 }, 7)).toBe(true)
    expect(rangeHas({ start: 5, end: 8 }, 8)).toBe(false)
  })

  it('has month starts', () => {
    expect(monthStartOf(day(2026, 10, 20))).toBe(day(2026, 10, 1))
    expect(dayOf(2026, 11, 32)).toBe(day(2027, 1, 1))
  })
})

describe('keyboard', () => {
  const d = day(2026, 10, 7)

  it('moves by a day, a week, to the ends of the week and by a month', () => {
    expect(moveFocusDay(d, 'ArrowLeft', MONDAY)).toBe(d - 1)
    expect(moveFocusDay(d, 'ArrowRight', MONDAY)).toBe(d + 1)
    expect(moveFocusDay(d, 'ArrowUp', MONDAY)).toBe(d - 7)
    expect(moveFocusDay(d, 'ArrowDown', MONDAY)).toBe(d + 7)
    expect(moveFocusDay(d, 'Home', MONDAY)).toBe(day(2026, 10, 5))
    expect(moveFocusDay(d, 'End', MONDAY)).toBe(day(2026, 10, 11))
    expect(moveFocusDay(d, 'Home', SUNDAY)).toBe(day(2026, 10, 4))
    expect(moveFocusDay(d, 'End', SUNDAY)).toBe(day(2026, 10, 10))
    expect(moveFocusDay(d, 'PageDown', MONDAY)).toBe(day(2026, 11, 7))
    expect(moveFocusDay(d, 'PageUp', MONDAY)).toBe(day(2026, 9, 7))
  })

  it('recognises the keys it handles', () => {
    expect(isFocusKey('ArrowLeft')).toBe(true)
    expect(isFocusKey('Enter')).toBe(false)
  })
})

describe('labels', () => {
  it('lists the weekday names from the first day of the week', () => {
    expect(weekdayLabels(MONDAY, 'en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(weekdayLabels(SUNDAY, 'en')[0]).toBe('Sun')
    expect(weekdayLabels(SATURDAY, 'en')).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(weekdayLabels(MONDAY, 'en', 'long')[0]).toBe('Monday')
  })

  it('titles a month and a week', () => {
    expect(formatCalendarTitle('month', day(2026, 10, 20), MONDAY, 'en')).toBe('October 2026')
    expect(formatCalendarTitle('agenda', day(2026, 10, 20), MONDAY, 'en')).toBe('October 2026')
    const week = formatCalendarTitle('week', day(2026, 10, 7), MONDAY, 'en')
    expect(week).toContain('5')
    expect(week).toContain('11')
    expect(week).toContain('2026')
  })

  it('titles a week that spans two years', () => {
    const title = formatCalendarTitle('week', day(2026, 12, 31), MONDAY, 'en')
    expect(title).toContain('2026')
    expect(title).toContain('2027')
  })
})
