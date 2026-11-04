// SPDX-License-Identifier: EPL-2.0

import {
  getCalendarDayKey,
  getCalendarQueryWindow,
  groupIssuesByCalendarDay,
  getIssueCalendarRange,
  isIssueOnCalendarDay,
  moveCalendarMonth,
  moveIssueToCalendarDay
} from '../calendar-dates'

function date (year: number, month: number, day: number, hour: number = 12): Date {
  return new Date(year, month - 1, day, hour)
}

describe('issue calendar ranges', () => {
  it.each([undefined, null, NaN, Infinity, 9e15])('hides issues without a valid due date (%s)', (dueDate) => {
    const issue = { dueDate, startDate: date(2026, 1, 1).getTime() }
    expect(getIssueCalendarRange(issue)).toBeUndefined()
    expect(isIssueOnCalendarDay(issue, date(2026, 1, 1))).toBe(false)
  })

  it('shows due-only issues for the entire local due day', () => {
    const issue = { dueDate: date(2026, 10, 23, 23).getTime() }
    expect(isIssueOnCalendarDay(issue, date(2026, 10, 23, 0))).toBe(true)
    expect(isIssueOnCalendarDay(issue, date(2026, 10, 22))).toBe(false)
    expect(isIssueOnCalendarDay(issue, date(2026, 10, 24))).toBe(false)
  })

  it('includes both endpoints and every day of a range spanning months and leap day', () => {
    const issue = { startDate: date(2024, 2, 28).getTime(), dueDate: date(2024, 3, 2).getTime() }
    for (const day of [date(2024, 2, 28), date(2024, 2, 29), date(2024, 3, 1), date(2024, 3, 2)]) {
      expect(isIssueOnCalendarDay(issue, day)).toBe(true)
    }
    expect(isIssueOnCalendarDay(issue, date(2024, 2, 27))).toBe(false)
    expect(isIssueOnCalendarDay(issue, date(2024, 3, 3))).toBe(false)
  })

  it.each([undefined, null, NaN, date(2026, 11, 1).getTime()])(
    'falls back to the due day for a missing, invalid or reversed start (%s)',
    (startDate) => {
      const issue = { startDate, dueDate: date(2026, 10, 23).getTime() }
      expect(isIssueOnCalendarDay(issue, date(2026, 10, 23))).toBe(true)
      expect(isIssueOnCalendarDay(issue, date(2026, 10, 22))).toBe(false)
      expect(isIssueOnCalendarDay(issue, date(2026, 10, 24))).toBe(false)
    }
  )

  it('accepts the Unix epoch as a date', () => {
    expect(isIssueOnCalendarDay({ dueDate: 0 }, new Date(0))).toBe(true)
  })

  it('does not match an invalid grid day', () => {
    expect(isIssueOnCalendarDay({ dueDate: 0 }, new Date(NaN))).toBe(false)
  })
})

describe('moving calendar dates', () => {
  it('moves due-only issues across years without introducing a start date', () => {
    const issue = { startDate: null, dueDate: date(2026, 12, 31).getTime() }
    expect(moveIssueToCalendarDay(issue, date(2027, 1, 2))).toEqual({ dueDate: date(2027, 1, 2).getTime() })
    expect(issue.startDate).toBeNull()
    expect(issue.dueDate).toBe(date(2026, 12, 31).getTime())
  })

  it.each([date(2026, 3, 9), date(2026, 3, 30), date(2026, 10, 26), date(2026, 11, 2)])(
    'lands on the target local day and shifts start by the exact same delta around DST (%s)',
    (target) => {
      const issue = { startDate: date(2026, 2, 25).getTime(), dueDate: date(2026, 3, 1).getTime() }
      const original = { ...issue }
      const result = moveIssueToCalendarDay(issue, target)
      expect(result).toBeDefined()
      expect(result?.dueDate).toBe(target.getTime())
      expect((result?.startDate ?? 0) - issue.startDate).toBe((result?.dueDate ?? 0) - issue.dueDate)
      expect(issue).toEqual(original)
    }
  )

  it('moves backwards and preserves the due time', () => {
    const dueDate = date(2026, 4, 3, 17).getTime()
    expect(moveIssueToCalendarDay({ dueDate }, date(2024, 2, 29))).toEqual({
      dueDate: date(2024, 2, 29, 17).getTime()
    })
  })

  it('ignores a same-day drop, undated issue and invalid target', () => {
    const dueDate = date(2026, 1, 1).getTime()
    expect(moveIssueToCalendarDay({ dueDate }, date(2026, 1, 1, 0))).toBeUndefined()
    expect(moveIssueToCalendarDay({ startDate: dueDate }, date(2026, 1, 2))).toBeUndefined()
    expect(moveIssueToCalendarDay({ dueDate }, new Date(NaN))).toBeUndefined()
  })

  it('shifts a start timestamp of zero', () => {
    const dueDate = date(1970, 1, 2).getTime()
    const result = moveIssueToCalendarDay({ startDate: 0, dueDate }, date(1970, 1, 3))
    expect(result?.startDate).toBe(date(1970, 1, 3).getTime() - dueDate)
  })
})

describe('month navigation', () => {
  it('does not skip February when navigating from January 31', () => {
    expect(moveCalendarMonth(date(2024, 1, 31), 1)).toEqual(date(2024, 2, 1, 0))
  })

  it('wraps years in both directions', () => {
    expect(moveCalendarMonth(date(2026, 12, 31), 1)).toEqual(date(2027, 1, 1, 0))
    expect(moveCalendarMonth(date(2026, 1, 31), -1)).toEqual(date(2025, 12, 1, 0))
  })
})

describe('calendar query window', () => {
  it('covers the whole six-week grid for any week start', () => {
    // The grid starts at most six days before the first and spans 42 days.
    expect(getCalendarQueryWindow(date(2026, 3, 31))).toEqual({
      start: date(2026, 2, 22, 0).getTime(),
      end: date(2026, 4, 12, 0).getTime()
    })
  })
})

describe('issues grouped by calendar day', () => {
  const window = getCalendarQueryWindow(date(2026, 3, 15))

  function issuesOn (groups: Map<number, Array<{ id: string }>>, day: Date): string[] {
    return (groups.get(getCalendarDayKey(day)) ?? []).map((issue) => issue.id)
  }

  it('matches isIssueOnCalendarDay for every cell of the grid, including a DST change', () => {
    const issues = [
      { id: 'due', dueDate: date(2026, 3, 10, 18).getTime() },
      { id: 'range', startDate: date(2026, 3, 27).getTime(), dueDate: date(2026, 4, 2).getTime() },
      { id: 'reversed', startDate: date(2026, 3, 20).getTime(), dueDate: date(2026, 3, 18).getTime() },
      { id: 'undated', dueDate: null }
    ]
    const groups = groupIssuesByCalendarDay(issues, window)
    for (let i = 0; i < 49; i++) {
      const day = new Date(window.start)
      day.setDate(day.getDate() + i)
      const expected = issues.filter((issue) => isIssueOnCalendarDay(issue, day)).map((issue) => issue.id)
      expect(issuesOn(groups, day)).toEqual(expected)
    }
  })

  it('clips long ranges to the visible window and keeps the input order per day', () => {
    const issues = [
      { id: 'b', startDate: date(2025, 1, 1).getTime(), dueDate: date(2027, 1, 1).getTime() },
      { id: 'a', dueDate: date(2026, 3, 15).getTime() }
    ]
    const groups = groupIssuesByCalendarDay(issues, window)
    expect(issuesOn(groups, date(2026, 3, 15))).toEqual(['b', 'a'])
    expect(groups.size).toBe(49)
    expect(groups.has(getCalendarDayKey(new Date(window.end)))).toBe(false)
  })
})
