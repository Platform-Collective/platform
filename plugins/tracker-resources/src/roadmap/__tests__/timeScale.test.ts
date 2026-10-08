//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  computeRange,
  createScale,
  dayParts,
  dayToTime,
  formatTick,
  headerRows,
  monthStart,
  pixelsToDays,
  PX_PER_DAY,
  quarterStart,
  scrollLeftForDay,
  shiftTimestamp,
  snapRange,
  toDay,
  weekStart,
  yearStart
} from '../timeScale'

const local = (y: number, m: number, d: number, h = 0): number => new Date(y, m - 1, d, h).getTime()

describe('days', () => {
  it('maps a timestamp to the local calendar day and back', () => {
    const ts = local(2026, 10, 3, 17)
    const day = toDay(ts)
    expect(dayToTime(day)).toBe(local(2026, 10, 3))
    expect(dayParts(day)).toMatchObject({ year: 2026, month: 9, date: 3 })
  })

  it('consecutive local days differ by one, also across a daylight saving change', () => {
    for (const [y, m, d] of [
      [2026, 3, 28],
      [2026, 3, 29],
      [2026, 10, 24],
      [2026, 10, 25],
      [2026, 11, 1]
    ]) {
      expect(toDay(local(y, m, d + 1)) - toDay(local(y, m, d))).toBe(1)
    }
  })

  it('shifts a timestamp by calendar days and keeps its time of day', () => {
    const ts = local(2026, 3, 27, 15)
    const shifted = shiftTimestamp(ts, 3)
    expect(new Date(shifted).getHours()).toBe(15)
    expect(toDay(shifted) - toDay(ts)).toBe(3)
    expect(toDay(shiftTimestamp(ts, -30)) - toDay(ts)).toBe(-30)
  })

  it('finds the start of a month, quarter, year and week', () => {
    const day = toDay(local(2026, 11, 18)) // a Wednesday
    expect(dayParts(monthStart(day))).toMatchObject({ year: 2026, month: 10, date: 1 })
    expect(dayParts(quarterStart(day))).toMatchObject({ year: 2026, month: 9, date: 1 })
    expect(dayParts(yearStart(day))).toMatchObject({ year: 2026, month: 0, date: 1 })
    expect(dayParts(weekStart(day))).toMatchObject({ month: 10, date: 16, weekday: 1 })
    // A Sunday belongs to the week that started on the Monday before
    expect(dayParts(weekStart(toDay(local(2026, 11, 22)))).date).toBe(16)
    // A Monday is its own week start
    expect(dayParts(weekStart(toDay(local(2026, 11, 16)))).date).toBe(16)
  })
})

describe('scale', () => {
  it('has a different density for every zoom level', () => {
    expect(PX_PER_DAY.month).toBeGreaterThan(PX_PER_DAY.quarter)
    expect(PX_PER_DAY.quarter).toBeGreaterThan(PX_PER_DAY.year)
  })

  it('converts days to x and x to days', () => {
    const scale = createScale('quarter', 1000, 1100)
    expect(scale.width).toBe(100 * PX_PER_DAY.quarter)
    expect(scale.dayToX(1000)).toBe(0)
    expect(scale.dayToX(1010)).toBe(10 * PX_PER_DAY.quarter)
    expect(scale.xToDay(scale.dayToX(1042))).toBe(1042)
    // Anywhere inside a day gives that day
    expect(scale.xToDay(scale.dayToX(1042) + PX_PER_DAY.quarter - 0.1)).toBe(1042)
  })

  it('never has an empty axis', () => {
    expect(createScale('month', 10, 10).width).toBeGreaterThan(0)
  })

  it('snaps a range to whole units of the zoom level', () => {
    const from = toDay(local(2026, 11, 18))
    const to = toDay(local(2027, 2, 3))
    const month = snapRange('month', from, to)
    expect(dayParts(month.startDay)).toMatchObject({ year: 2026, month: 10, date: 1 })
    expect(dayParts(month.endDay)).toMatchObject({ year: 2027, month: 2, date: 1 })
    const quarter = snapRange('quarter', from, to)
    expect(dayParts(quarter.startDay)).toMatchObject({ year: 2026, month: 9, date: 1 })
    expect(dayParts(quarter.endDay)).toMatchObject({ year: 2027, month: 3, date: 1 })
    const year = snapRange('year', from, to)
    expect(dayParts(year.startDay)).toMatchObject({ year: 2026, month: 0, date: 1 })
    expect(dayParts(year.endDay)).toMatchObject({ year: 2028, month: 0, date: 1 })
  })

  it('snaps a single day to one unit', () => {
    const day = toDay(local(2026, 2, 14))
    const r = snapRange('month', day, day)
    expect(dayParts(r.startDay).month).toBe(1)
    expect(dayParts(r.endDay).month).toBe(2)
  })
})

describe('computeRange', () => {
  const today = toDay(local(2026, 10, 3))

  it('covers today and gives room around it when there are no dates', () => {
    for (const zoom of ['month', 'quarter', 'year'] as const) {
      const r = computeRange(zoom, [], today)
      expect(r.startDay).toBeLessThanOrEqual(today)
      expect(r.endDay).toBeGreaterThan(today)
      expect(r.endDay - r.startDay).toBeGreaterThan(150)
    }
  })

  it('has more room ahead of today than behind it', () => {
    const r = computeRange('quarter', [], today)
    expect(r.endDay - today).toBeGreaterThan(today - r.startDay)
  })

  it('stretches over every date', () => {
    const early = toDay(local(2025, 1, 15))
    const late = toDay(local(2029, 6, 20))
    const r = computeRange('month', [early, late], today)
    expect(r.startDay).toBeLessThanOrEqual(early)
    expect(r.endDay).toBeGreaterThan(late)
  })

  it('ignores dates absurdly far from today', () => {
    const r = computeRange('month', [toDay(local(1970, 1, 1)), toDay(local(2500, 1, 1))], today)
    expect(r.endDay - r.startDay).toBeLessThan(400)
  })
})

describe('header', () => {
  it('shows months over weeks at the month zoom', () => {
    const range = snapRange('month', toDay(local(2026, 10, 1)), toDay(local(2026, 11, 30)))
    const scale = createScale('month', range.startDay, range.endDay)
    const { top, bottom } = headerRows(scale)
    expect(top.map((t) => t.index)).toEqual([9, 10])
    expect(top.every((t) => t.kind === 'month')).toBe(true)
    expect(bottom.every((t) => t.kind === 'week')).toBe(true)
    // Weeks start on Mondays
    expect(bottom.slice(1).every((t) => dayParts(t.startDay).weekday === 1)).toBe(true)
  })

  it('shows quarters over months at the quarter zoom and years over quarters at the year zoom', () => {
    const range = snapRange('quarter', toDay(local(2026, 1, 1)), toDay(local(2026, 12, 31)))
    const q = headerRows(createScale('quarter', range.startDay, range.endDay))
    expect(q.top.map((t) => t.index)).toEqual([1, 2, 3, 4])
    expect(q.bottom).toHaveLength(12)

    const yr = snapRange('year', toDay(local(2026, 1, 1)), toDay(local(2027, 12, 31)))
    const y = headerRows(createScale('year', yr.startDay, yr.endDay))
    expect(y.top.map((t) => t.year)).toEqual([2026, 2027])
    expect(y.bottom).toHaveLength(8)
  })

  it('tiles the axis without gaps and clips ticks at the edges', () => {
    const start = toDay(local(2026, 10, 14))
    const end = toDay(local(2026, 12, 20))
    const scale = createScale('month', start, end)
    const rows = headerRows(scale)
    for (const row of [rows.top, rows.bottom]) {
      expect(row[0].startDay).toBe(start)
      expect(row[row.length - 1].endDay).toBe(end)
      for (let i = 1; i < row.length; i++) expect(row[i].startDay).toBe(row[i - 1].endDay)
      const total = row.reduce((sum: number, t) => sum + t.width, 0)
      expect(total).toBe(scale.width)
    }
  })

  it('formats the labels', () => {
    const scale = createScale('quarter', toDay(local(2026, 10, 1)), toDay(local(2027, 1, 1)))
    const { top, bottom } = headerRows(scale)
    expect(formatTick(top[0], 'en')).toBe('Q4 2026')
    expect(formatTick(bottom[0], 'en', 'bottom')).toBe('Oct')
    const yearly = headerRows(createScale('year', toDay(local(2026, 1, 1)), toDay(local(2027, 1, 1))))
    expect(formatTick(yearly.top[0])).toBe('2026')
    expect(formatTick(yearly.bottom[1], undefined, 'bottom')).toBe('Q2')
    const monthly = headerRows(createScale('month', toDay(local(2026, 10, 1)), toDay(local(2026, 11, 1))))
    expect(formatTick(monthly.top[0], 'en')).toBe('October 2026')
  })
})

describe('interaction', () => {
  it('rounds a pixel movement to whole days', () => {
    expect(pixelsToDays(PX_PER_DAY.month * 3 + 1, PX_PER_DAY.month)).toBe(3)
    expect(pixelsToDays(PX_PER_DAY.month * 3 + PX_PER_DAY.month * 0.6, PX_PER_DAY.month)).toBe(4)
    expect(pixelsToDays(-PX_PER_DAY.month * 2, PX_PER_DAY.month)).toBe(-2)
    expect(Object.is(pixelsToDays(-0.1, PX_PER_DAY.month), 0)).toBe(true)
  })

  it('computes a scroll offset that stays inside the axis', () => {
    const scale = createScale('month', 0, 400)
    expect(scrollLeftForDay(scale, 0, 500)).toBe(0)
    expect(scrollLeftForDay(scale, 399, 500)).toBe(scale.width - 500)
    expect(scrollLeftForDay(scale, 200, 600, 0.5)).toBe(scale.dayToX(200) - 300)
    // An axis narrower than the viewport does not scroll
    expect(scrollLeftForDay(createScale('year', 0, 100), 50, 500)).toBe(0)
  })
})
