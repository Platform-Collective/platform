//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { dayOf, weekStartOf } from '../../calendar/grid'
import { dayParts } from '../../roadmap/timeScale'
import {
  bucketIndexOfDay,
  bucketStart,
  COLUMN_WIDTH,
  computeAxis,
  formatBucketLabel,
  formatBucketRange,
  formatHeaderGroup,
  headerGroups,
  isWorkloadZoom,
  MAX_BUCKETS,
  nextBucketStart,
  scrollLeftForBucket,
  visibleBucketRange
} from '../axis'

// 5 October 2026 is a Monday
const TODAY = dayOf(2026, 9, 5)
const MON = 1
const SUN = 0

describe('buckets', () => {
  it('starts a week on the first day of the week of the platform', () => {
    const wednesday = dayOf(2026, 9, 7)
    expect(bucketStart('week', wednesday, MON)).toBe(TODAY)
    expect(bucketStart('week', wednesday, SUN)).toBe(TODAY - 1)
    // A garbage first day falls back to Monday
    expect(bucketStart('week', wednesday, Number.NaN)).toBe(TODAY)
  })

  it('starts a month on the 1st and a day on itself', () => {
    expect(bucketStart('month', dayOf(2026, 9, 17), MON)).toBe(dayOf(2026, 9, 1))
    expect(bucketStart('day', 123, MON)).toBe(123)
  })

  it('knows the next bucket, also over a month with 28, 30 and 31 days', () => {
    expect(nextBucketStart('day', 10)).toBe(11)
    expect(nextBucketStart('week', 10)).toBe(17)
    expect(nextBucketStart('month', dayOf(2026, 1, 1))).toBe(dayOf(2026, 2, 1))
    expect(nextBucketStart('month', dayOf(2026, 8, 1))).toBe(dayOf(2026, 9, 1))
    expect(nextBucketStart('month', dayOf(2026, 11, 1))).toBe(dayOf(2027, 0, 1))
  })

  it('recognises the zoom levels', () => {
    expect(isWorkloadZoom('week')).toBe(true)
    expect(isWorkloadZoom('quarter')).toBe(false)
  })
})

describe('computeAxis', () => {
  for (const zoom of ['day', 'week', 'month'] as const) {
    it(`covers today with whole contiguous buckets (${zoom})`, () => {
      const axis = computeAxis(zoom, [], TODAY, MON)
      expect(axis.todayIndex).toBeGreaterThanOrEqual(0)
      const today = axis.buckets[axis.todayIndex]
      expect(TODAY >= today.start && TODAY < today.end).toBe(true)
      axis.buckets.forEach((b, i) => {
        expect(b.index).toBe(i)
        expect(b.end).toBeGreaterThan(b.start)
        if (i > 0) expect(b.start).toBe(axis.buckets[i - 1].end)
      })
      expect(axis.startDay).toBe(axis.buckets[0].start)
      expect(axis.endDay).toBe(axis.buckets[axis.buckets.length - 1].end)
      expect(axis.trimmed).toBe(false)
      // More room ahead of today than behind it
      expect(axis.endDay - TODAY).toBeGreaterThan(TODAY - axis.startDay)
    })
  }

  it('has week buckets of seven days that start on the first day of the week', () => {
    const axis = computeAxis('week', [], TODAY, SUN)
    for (const b of axis.buckets) {
      expect(b.end - b.start).toBe(7)
      expect(dayParts(b.start).weekday).toBe(0)
    }
    expect(weekStartOf(TODAY, SUN)).toBe(axis.buckets[axis.todayIndex].start)
  })

  it('has month buckets that follow the calendar', () => {
    const axis = computeAxis('month', [], TODAY, MON)
    for (const b of axis.buckets) expect(dayParts(b.start).date).toBe(1)
    expect(new Set(axis.buckets.map((b) => b.end - b.start)).size).toBeGreaterThan(1)
  })

  it('extends to the days of the items', () => {
    const far = TODAY + 400
    const early = TODAY - 200
    const axis = computeAxis('week', [far, early], TODAY, MON)
    expect(axis.startDay).toBeLessThanOrEqual(early)
    expect(axis.endDay).toBeGreaterThan(far)
  })

  it('ignores days that are far from today and values that are not days', () => {
    const base = computeAxis('week', [], TODAY, MON)
    const axis = computeAxis('week', [TODAY - 100000, TODAY + 100000, Number.NaN, Infinity], TODAY, MON)
    expect(axis.startDay).toBe(base.startDay)
    expect(axis.endDay).toBe(base.endDay)
  })

  it('cuts a range that is too long around today and says so', () => {
    const axis = computeAxis('day', [TODAY - 3000, TODAY + 3000], TODAY, MON)
    expect(axis.buckets.length).toBe(MAX_BUCKETS.day)
    expect(axis.trimmed).toBe(true)
    expect(axis.todayIndex).toBeGreaterThanOrEqual(0)
    // Today is closer to the start than to the end
    expect(axis.todayIndex).toBeLessThan(MAX_BUCKETS.day / 2)
    axis.buckets.forEach((b, i) => {
      expect(b.index).toBe(i)
    })
  })

  it('finds the bucket of a day, and none for a day outside', () => {
    const axis = computeAxis('week', [], TODAY, MON)
    expect(bucketIndexOfDay(axis, TODAY)).toBe(axis.todayIndex)
    expect(bucketIndexOfDay(axis, TODAY + 6)).toBe(axis.todayIndex)
    expect(bucketIndexOfDay(axis, TODAY + 7)).toBe(axis.todayIndex + 1)
    expect(bucketIndexOfDay(axis, axis.startDay - 1)).toBe(-1)
    expect(bucketIndexOfDay(axis, axis.endDay)).toBe(-1)
    expect(bucketIndexOfDay({ buckets: [] }, 5)).toBe(-1)
    for (const b of axis.buckets) {
      expect(bucketIndexOfDay(axis, b.start)).toBe(b.index)
      expect(bucketIndexOfDay(axis, b.end - 1)).toBe(b.index)
    }
  })
})

describe('header', () => {
  it('groups days and weeks by month and months by year', () => {
    const days = computeAxis('day', [], TODAY, MON)
    const groups = headerGroups(days)
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(days.buckets.length)
    expect(groups[0].from).toBe(0)
    groups.forEach((g, i) => {
      if (i > 0) expect(g.from).toBe(groups[i - 1].from + groups[i - 1].count)
    })
    expect(groups.every((g) => g.month >= 0)).toBe(true)

    const months = headerGroups(computeAxis('month', [], TODAY, MON))
    expect(months.every((g) => g.month === -1)).toBe(true)
    expect(months.length).toBeGreaterThanOrEqual(1)
  })

  it('puts a week into the month of its first day', () => {
    const axis = computeAxis('week', [], TODAY, MON)
    const groups = headerGroups(axis)
    for (const g of groups) {
      const first = axis.buckets[g.from]
      expect(dayParts(first.start).month).toBe(g.month)
    }
  })

  it('labels in the locale of the user', () => {
    const [group] = headerGroups({ zoom: 'week', buckets: [{ index: 0, start: TODAY, end: TODAY + 7 }] })
    expect(formatHeaderGroup(group, 'en')).toBe('October 2026')
    expect(formatHeaderGroup({ ...group, month: -1 }, 'en')).toBe('2026')
    expect(formatBucketLabel('month', { start: TODAY }, 'en')).toBe('Oct')
    expect(formatBucketLabel('week', { start: TODAY }, 'en')).toBe('Oct 5')
    expect(formatBucketLabel('day', { start: TODAY }, 'en')).toBe('Mon 5')
    expect(formatBucketRange('day', { start: TODAY, end: TODAY + 1 }, 'en')).toBe('Oct 5, 2026')
    expect(formatBucketRange('week', { start: TODAY, end: TODAY + 7 }, 'en')).toBe('Oct 5, 2026 – Oct 11, 2026')
    expect(formatBucketRange('month', { start: dayOf(2026, 9, 1), end: dayOf(2026, 10, 1) }, 'en')).toBe('October 2026')
  })
})

describe('viewport', () => {
  it('draws the visible columns with some overscan', () => {
    const w = COLUMN_WIDTH.week
    const range = visibleBucketRange(w * 10, w * 5, w, 100, 2)
    expect(range).toEqual({ from: 8, to: 17 })
  })

  it('stays inside the axis', () => {
    expect(visibleBucketRange(0, 500, 50, 4, 3)).toEqual({ from: 0, to: 3 })
    expect(visibleBucketRange(100000, 500, 50, 4, 3)).toEqual({ from: 3, to: 3 })
  })

  it('is safe for bad numbers and an empty axis', () => {
    expect(visibleBucketRange(Number.NaN, Number.NaN, 50, 10, 1)).toEqual({ from: 0, to: 1 })
    expect(visibleBucketRange(0, 100, 50, 0).to).toBe(-1)
    expect(visibleBucketRange(0, 100, 0, 10).to).toBe(-1)
  })

  it('scrolls a bucket into view without leaving the content', () => {
    expect(scrollLeftForBucket(20, 80, 800, 10000)).toBe(20 * 80 - 200)
    expect(scrollLeftForBucket(0, 80, 800, 10000)).toBe(0)
    expect(scrollLeftForBucket(500, 80, 800, 10000)).toBe(9200)
    expect(scrollLeftForBucket(3, 80, 800, 100)).toBe(0)
  })
})
