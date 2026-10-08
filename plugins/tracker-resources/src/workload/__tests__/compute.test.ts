//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { dayOf } from '../../calendar/grid'
import type { ItemSchedule } from '../../roadmap/dates'
import { toDay } from '../../roadmap/timeScale'
import { computeAxis, type WorkloadAxis } from '../axis'
import {
  bucketCapacities,
  cellItems,
  computeWorkload,
  distribute,
  emptyRowLoad,
  loadState,
  NEAR_RATIO,
  scheduleSpan,
  summarizeRow,
  utilization,
  type LoadEntry
} from '../compute'
import { planReassign } from '../reassign'
import { rowKeyOf } from '../rows'
import { WorkdayIndex } from '../workdays'

const DAY_MS = 86400000
// 5 October 2026 is a Monday
const MON = dayOf(2026, 9, 5)
const TODAY = MON
const MON_TO_FRI = { weekdayMask: 31, holidays: [] as number[] }

const range = (start: number, target: number): ItemSchedule => ({ kind: 'range', start, target, inverted: false })
const marker = (day: number): ItemSchedule => ({ kind: 'marker', day, role: 'target' })
const unscheduled: ItemSchedule = { kind: 'unscheduled' }

function setup (
  zoom: 'day' | 'week' | 'month' = 'week',
  calendar: { weekdayMask: number, holidays: number[] } = MON_TO_FRI,
  days: number[] = []
): { axis: WorkloadAxis, index: WorkdayIndex } {
  return { axis: computeAxis(zoom, days, TODAY, 1), index: WorkdayIndex.around(TODAY, calendar) }
}

function sum (values: ArrayLike<number>): number {
  let total = 0
  for (let i = 0; i < values.length; i++) total += values[i]
  return total
}

const entry = (id: string, row: string, load: number, schedule: ItemSchedule): LoadEntry => ({ id, row, load, schedule })

describe('scheduleSpan', () => {
  it('gives the first and last day, one day for a marker and nothing without a day', () => {
    expect(scheduleSpan(range(3, 9))).toEqual({ start: 3, end: 9 })
    expect(scheduleSpan(marker(4))).toEqual({ start: 4, end: 4 })
    expect(scheduleSpan(unscheduled)).toBeUndefined()
  })
})

describe('distribute', () => {
  it('spreads the load evenly over the working days of a week', () => {
    const { axis, index } = setup('day')
    const shares = new Map<number, number>()
    distribute(range(MON, MON + 4), 40, axis, index, (b, share) => shares.set(axis.buckets[b].start, share))
    expect([...shares.keys()]).toEqual([MON, MON + 1, MON + 2, MON + 3, MON + 4])
    for (const v of shares.values()) expect(v).toBeCloseTo(8, 9)
  })

  it('gives the weekend no share and divides by the working days only', () => {
    const { axis, index } = setup('day')
    const shares = new Map<number, number>()
    // Monday of one week to Friday of the next: 10 working days
    distribute(range(MON, MON + 11), 100, axis, index, (b, share) => shares.set(axis.buckets[b].start, share))
    expect(shares.size).toBe(10)
    expect(shares.has(MON + 5)).toBe(false)
    expect(shares.has(MON + 6)).toBe(false)
    expect(shares.get(MON + 7)).toBeCloseTo(10, 9)
    expect(sum([...shares.values()])).toBeCloseTo(100, 9)
  })

  it('skips the holidays of the calendar', () => {
    const { axis, index } = setup('day', { weekdayMask: 31, holidays: [(MON + 2) * DAY_MS] })
    const shares = new Map<number, number>()
    distribute(range(MON, MON + 4), 32, axis, index, (b, share) => shares.set(axis.buckets[b].start, share))
    expect(shares.has(MON + 2)).toBe(false)
    expect(shares.size).toBe(4)
    expect(shares.get(MON)).toBeCloseTo(8, 9)
  })

  it('splits the load between the weeks of a span by their working days', () => {
    const { axis, index } = setup('week')
    const shares = new Map<number, number>()
    // Friday of week 1 (1 working day) to Tuesday of week 2 (2 working days): 3 working days
    distribute(range(MON + 4, MON + 8), 30, axis, index, (b, share) => shares.set(axis.buckets[b].start, share))
    expect(shares.get(MON)).toBeCloseTo(10, 9)
    expect(shares.get(MON + 7)).toBeCloseTo(20, 9)
  })

  it('puts all the load of a one date item on that day', () => {
    const { axis, index } = setup('day')
    const shares: number[] = []
    distribute(marker(MON + 2), 6, axis, index, (b, share) => shares.push(share, axis.buckets[b].start))
    expect(shares).toEqual([6, MON + 2])
  })

  it('plans a span that has no working day on its calendar days', () => {
    const { axis, index } = setup('day')
    const shares = new Map<number, number>()
    // Saturday and Sunday
    distribute(range(MON + 5, MON + 6), 10, axis, index, (b, share) => shares.set(axis.buckets[b].start, share))
    expect(shares.get(MON + 5)).toBeCloseTo(5, 9)
    expect(shares.get(MON + 6)).toBeCloseTo(5, 9)
    // A one day marker on a holiday keeps its load too
    const holiday = setup('day', { weekdayMask: 31, holidays: [MON * DAY_MS] })
    const got: number[] = []
    distribute(marker(MON), 3, holiday.axis, holiday.index, (_b, share) => got.push(share))
    expect(got).toEqual([3])
  })

  it('does nothing for an item without a day, and for a span outside the axis', () => {
    const { axis, index } = setup('week')
    const visit = jest.fn()
    expect(distribute(unscheduled, 10, axis, index, visit)).toBe(false)
    expect(distribute(range(axis.endDay + 10, axis.endDay + 20), 10, axis, index, visit)).toBe(false)
    expect(distribute(range(axis.startDay - 30, axis.startDay - 2), 10, axis, index, visit)).toBe(false)
    expect(visit).not.toHaveBeenCalled()
  })

  it('keeps only the part of a span that is on the axis', () => {
    const { axis, index } = setup('week')
    const shares: number[] = []
    // The span starts before the axis, the days after it are on the axis
    distribute(range(axis.startDay - 7, axis.startDay + 6), 20, axis, index, (_b, share) => shares.push(share))
    expect(sum(shares)).toBeCloseTo(10, 9)
  })

  it('is safe for load that is not a number', () => {
    const { axis, index } = setup('day')
    for (const load of [Number.NaN, -5, Infinity, 0]) {
      const shares: number[] = []
      distribute(range(MON, MON + 2), load, axis, index, (_b, share) => shares.push(share))
      for (const s of shares) {
        expect(Number.isFinite(s)).toBe(true)
        expect(s).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('conserves the load of an item inside the axis', () => {
    for (const zoom of ['day', 'week', 'month'] as const) {
      const { axis, index } = setup(zoom, MON_TO_FRI, [MON + 3, MON + 70])
      const shares: number[] = []
      distribute(range(MON + 3, MON + 70), 123.456, axis, index, (_b, share) => shares.push(share))
      expect(sum(shares)).toBeCloseTo(123.456, 9)
    }
  })
})

describe('computeWorkload', () => {
  it('adds the loads of a person up per bucket and counts the items', () => {
    const { axis, index } = setup('week')
    const { rows, outOfRange } = computeWorkload(
      [
        entry('a', 'ann', 20, range(MON, MON + 4)),
        entry('b', 'ann', 10, range(MON + 2, MON + 3)),
        entry('c', 'bob', 8, range(MON + 7, MON + 11))
      ],
      axis,
      index
    )
    expect(outOfRange).toBe(0)
    const ann = rows.get('ann')!
    expect(ann.loads[axis.todayIndex]).toBeCloseTo(30, 9)
    expect(ann.counts[axis.todayIndex]).toBe(2)
    expect(ann.itemCount).toBe(2)
    const bob = rows.get('bob')!
    expect(bob.loads[axis.todayIndex]).toBe(0)
    expect(bob.loads[axis.todayIndex + 1]).toBeCloseTo(8, 9)
  })

  it('keeps a row per assignee, the unassigned items included', () => {
    const { axis, index } = setup('week')
    const { rows } = computeWorkload(
      [entry('a', 'ann', 1, range(MON, MON)), entry('b', '__unassigned__', 1, range(MON, MON))],
      axis,
      index
    )
    expect([...rows.keys()].sort()).toEqual(['__unassigned__', 'ann'])
  })

  it('collects the items without a day with their whole load', () => {
    const { axis, index } = setup('week')
    const { rows } = computeWorkload(
      [entry('a', 'ann', 5, unscheduled), entry('b', 'ann', 7.5, unscheduled), entry('c', 'ann', 2, range(MON, MON))],
      axis,
      index
    )
    const ann = rows.get('ann')!
    expect(ann.unscheduledLoad).toBeCloseTo(12.5, 9)
    expect(ann.unscheduledCount).toBe(2)
    // The unscheduled load is not in any bucket
    expect(sum(ann.loads)).toBeCloseTo(2, 9)
  })

  it('counts the items without a load value and still shows them in the cells', () => {
    const { axis, index } = setup('week')
    const { rows } = computeWorkload(
      [entry('a', 'ann', 0, range(MON, MON + 4)), entry('b', 'ann', Number.NaN, unscheduled)],
      axis,
      index
    )
    const ann = rows.get('ann')!
    expect(ann.noLoadCount).toBe(2)
    expect(ann.counts[axis.todayIndex]).toBe(1)
    expect(ann.loads[axis.todayIndex]).toBe(0)
    expect(Number.isNaN(ann.unscheduledLoad)).toBe(false)
  })

  it('counts a scheduled item outside the axis as out of range, once', () => {
    const { axis, index } = setup('week')
    const { rows, outOfRange } = computeWorkload(
      [entry('a', 'ann', 10, range(axis.endDay + 40, axis.endDay + 50)), entry('b', 'ann', 1, range(MON, MON))],
      axis,
      index
    )
    expect(outOfRange).toBe(1)
    expect(rows.get('ann')!.itemCount).toBe(2)
  })

  it('returns nothing for no items', () => {
    const { axis, index } = setup('week')
    const res = computeWorkload([], axis, index)
    expect(res.rows.size).toBe(0)
    expect(res.outOfRange).toBe(0)
  })

  it('does not lose or add load over several people, spans and zoom levels', () => {
    for (const zoom of ['day', 'week', 'month'] as const) {
      const { axis, index } = setup(zoom, MON_TO_FRI, [MON, MON + 120])
      const entries: LoadEntry[] = []
      let expected = 0
      for (let i = 0; i < 60; i++) {
        const load = (i % 7) + 0.25
        expected += load
        entries.push(entry(`i${i}`, `p${i % 5}`, load, range(MON + i, MON + i + (i % 23))))
      }
      const { rows } = computeWorkload(entries, axis, index)
      let total = 0
      for (const row of rows.values()) total += sum(row.loads)
      expect(total).toBeCloseTo(expected, 6)
    }
  })

  it('gives the same totals in every zoom level for the same capacity of a person', () => {
    const entries = [entry('a', 'ann', 100, range(MON, MON + 40))]
    const totals = (['day', 'week', 'month'] as const).map((zoom) => {
      const { axis, index } = setup(zoom, MON_TO_FRI, [MON, MON + 40])
      return sum(computeWorkload(entries, axis, index).rows.get('ann')!.loads)
    })
    expect(totals[0]).toBeCloseTo(100, 9)
    expect(totals[1]).toBeCloseTo(100, 9)
    expect(totals[2]).toBeCloseTo(100, 9)
  })
})

describe('capacity and states', () => {
  it('has the capacity per day times the working days of the bucket', () => {
    const { axis, index } = setup('week')
    const caps = bucketCapacities(axis, index, 8)
    expect(caps[axis.todayIndex]).toBe(40)
    const holiday = setup('week', { weekdayMask: 31, holidays: [(MON + 1) * DAY_MS, (MON + 2) * DAY_MS] })
    expect(bucketCapacities(holiday.axis, holiday.index, 8)[holiday.axis.todayIndex]).toBe(24)
    expect(bucketCapacities(axis, index, 4)[axis.todayIndex]).toBe(20)
  })

  it('counts the weeks of a month in the capacity of the month', () => {
    const { axis, index } = setup('month')
    // October 2026 has 22 working days (Mon-Fri)
    expect(bucketCapacities(axis, index, 8)[axis.todayIndex]).toBe(22 * 8)
  })

  it('has no capacity for a bad number', () => {
    const { axis, index } = setup('week')
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      const caps = bucketCapacities(axis, index, bad)
      if (bad === Infinity) expect(caps[0]).toBe(0)
      else expect(sum(caps)).toBe(0)
    }
  })

  it('tells under, near and over capacity apart', () => {
    expect(loadState(0, 40)).toBe('empty')
    expect(loadState(10, 40)).toBe('under')
    expect(loadState(40 * NEAR_RATIO, 40)).toBe('near')
    expect(loadState(39.9, 40)).toBe('near')
    expect(loadState(40, 40)).toBe('near')
    expect(loadState(40.5, 40)).toBe('over')
  })

  it('does not call a sum of fractions that is exactly full over capacity', () => {
    let load = 0
    for (let i = 0; i < 10; i++) load += 0.1 * 4
    expect(loadState(load, 4)).toBe('near')
    expect(loadState(0.1 + 0.2, 0.3)).toBe('near')
  })

  it('treats load without any capacity as over', () => {
    expect(loadState(1, 0)).toBe('over')
    expect(loadState(0, 0)).toBe('empty')
    expect(loadState(1, Number.NaN)).toBe('over')
  })

  it('is safe for load that is not a number', () => {
    expect(loadState(Number.NaN, 40)).toBe('empty')
    expect(loadState(-3, 40)).toBe('empty')
    expect(loadState(Infinity, 40)).toBe('over')
  })

  it('reads the utilization as a share of the capacity', () => {
    expect(utilization(20, 40)).toBe(0.5)
    expect(utilization(60, 40)).toBe(1.5)
    expect(utilization(0, 40)).toBe(0)
    expect(utilization(5, 0)).toBeUndefined()
    expect(utilization(Number.NaN, 40)).toBeUndefined()
    expect(utilization(5, Infinity)).toBeUndefined()
  })
})

describe('summarizeRow', () => {
  it('measures a person over the weeks in which they have load', () => {
    const { axis, index } = setup('week')
    const caps = bucketCapacities(axis, index, 8)
    // Full for two weeks
    const { rows } = computeWorkload([entry('a', 'ann', 80, range(MON, MON + 11))], axis, index)
    const s = summarizeRow(rows.get('ann')!, caps)
    expect(s.total).toBeCloseTo(80, 9)
    expect(s.activeFrom).toBe(axis.todayIndex)
    expect(s.activeTo).toBe(axis.todayIndex + 1)
    expect(s.capacity).toBe(80)
    expect(s.utilization).toBeCloseTo(1, 9)
    expect(s.state).toBe('near')
    expect(s.overCount).toBe(0)
  })

  it('flags a row over capacity as soon as one bucket is, whatever the average is', () => {
    const { axis, index } = setup('week')
    const caps = bucketCapacities(axis, index, 8)
    const { rows } = computeWorkload(
      [entry('a', 'ann', 60, range(MON, MON + 4)), entry('b', 'ann', 5, range(MON + 14, MON + 18))],
      axis,
      index
    )
    const s = summarizeRow(rows.get('ann')!, caps)
    expect(s.overCount).toBe(1)
    expect(s.state).toBe('over')
    expect(s.utilization).toBeLessThan(1)
  })

  it('has no utilization without load', () => {
    const { axis, index } = setup('week')
    const caps = bucketCapacities(axis, index, 8)
    const { rows } = computeWorkload([entry('a', 'ann', 0, range(MON, MON + 4)), entry('b', 'ann', 9, unscheduled)], axis, index)
    const s = summarizeRow(rows.get('ann')!, caps)
    expect(s.total).toBe(0)
    expect(s.activeFrom).toBe(-1)
    expect(s.utilization).toBeUndefined()
    expect(s.state).toBe('empty')
  })

  it('is over when the load is on days without capacity', () => {
    // A weekend item is planned on the weekend, where nobody has capacity
    const { axis, index } = setup('day')
    const caps = bucketCapacities(axis, index, 8)
    const { rows } = computeWorkload([entry('a', 'ann', 6, range(MON + 5, MON + 6))], axis, index)
    const s = summarizeRow(rows.get('ann')!, caps)
    expect(s.state).toBe('over')
    expect(s.overCount).toBe(2)
  })
})

describe('cellItems', () => {
  const { axis, index } = setup('week')
  const entries = [
    entry('a', 'ann', 20, range(MON, MON + 4)),
    entry('b', 'ann', 30, range(MON + 2, MON + 9)),
    entry('c', 'bob', 99, range(MON, MON + 4)),
    entry('d', 'ann', 0, range(MON, MON)),
    entry('e', 'ann', 6, unscheduled),
    entry('f', 'ann', 1, range(MON + 21, MON + 22))
  ]

  it('lists the items of a person in a bucket with their share, the biggest first', () => {
    const items = cellItems(entries, axis, index, 'ann', axis.todayIndex)
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'd'])
    expect(items[0].share).toBeCloseTo(20, 9)
    // 3 of the 6 working days of b are in the first week
    expect(items[1].share).toBeCloseTo(15, 9)
    expect(items[2].share).toBe(0)
  })

  it('agrees with the cell total', () => {
    const { rows } = computeWorkload(entries, axis, index)
    for (const bucket of [axis.todayIndex, axis.todayIndex + 1, axis.todayIndex + 3]) {
      const total = sum(cellItems(entries, axis, index, 'ann', bucket).map((i) => i.share))
      expect(total).toBeCloseTo(rows.get('ann')!.loads[bucket], 9)
    }
  })

  it('lists the items without a day of a person with their whole load', () => {
    expect(cellItems(entries, axis, index, 'ann', 'unscheduled')).toEqual([{ id: 'e', share: 6 }])
    expect(cellItems(entries, axis, index, 'bob', 'unscheduled')).toEqual([])
  })

  it('is empty for a cell without items', () => {
    expect(cellItems(entries, axis, index, 'ann', axis.todayIndex + 10)).toEqual([])
    expect(cellItems(entries, axis, index, 'nobody', axis.todayIndex)).toEqual([])
  })

  it('has a stable order for equal shares', () => {
    const same = [entry('z', 'ann', 5, marker(MON)), entry('m', 'ann', 5, marker(MON))]
    expect(cellItems(same, axis, index, 'ann', axis.todayIndex).map((i) => i.id)).toEqual(['m', 'z'])
  })
})

describe('rows without items and reassigning', () => {
  it('has an empty row for a person without work', () => {
    const { axis, index } = setup('week')
    const row = emptyRowLoad('idle', axis.buckets.length)
    expect(row.loads).toHaveLength(axis.buckets.length)
    expect(sum(row.loads)).toBe(0)
    const s = summarizeRow(row, bucketCapacities(axis, index, 8))
    expect(s.state).toBe('empty')
    expect(s.utilization).toBeUndefined()
  })

  it('moves the load from one row to the other when an item is reassigned', () => {
    const { axis, index } = setup('week')
    const issue = { assignee: 'ann' as string | null }
    const make = (): LoadEntry[] => [entry('a', rowKeyOf(issue.assignee), 40, range(MON, MON + 4))]
    const before = computeWorkload(make(), axis, index).rows
    expect(before.get('ann')!.loads[axis.todayIndex]).toBeCloseTo(40, 9)
    const plan = planReassign(issue, 'bob', { readonly: false })
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    issue.assignee = plan.assignee
    const after = computeWorkload(make(), axis, index).rows
    expect(after.has('ann')).toBe(false)
    expect(after.get('bob')!.loads[axis.todayIndex]).toBeCloseTo(40, 9)
    // Dropping on the unassigned row clears the assignee and keeps the load in that row
    const cleared = planReassign(issue, '__unassigned__', { readonly: false })
    if (cleared.ok === false) return
    issue.assignee = cleared.assignee
    expect(computeWorkload(make(), axis, index).rows.get('__unassigned__')!.loads[axis.todayIndex]).toBeCloseTo(40, 9)
  })
})

describe('time zones', () => {
  it('plans the same working days whatever the zone of the viewer is', () => {
    // The days are the local calendar dates, so a date picked at 23:30 is still the same day
    const late = new Date(2026, 9, 5, 23, 30).getTime()
    const early = new Date(2026, 9, 9, 0, 15).getTime()
    expect(toDay(late)).toBe(MON)
    expect(toDay(early)).toBe(MON + 4)
    const { axis, index } = setup('day')
    const shares = new Map<number, number>()
    distribute(range(toDay(late), toDay(early)), 40, axis, index, (b, s) => shares.set(axis.buckets[b].start, s))
    expect(shares.size).toBe(5)
    for (const v of shares.values()) expect(v).toBeCloseTo(8, 9)
  })

  it('has weeks of seven days over a daylight saving change', () => {
    // Between the end of March and the end of October the clocks change in many zones
    const around = (y: number, m: number, d: number): number => dayOf(y, m, d)
    for (const day of [around(2026, 2, 29), around(2026, 9, 25), around(2026, 10, 1), around(2026, 2, 8)]) {
      const axis = computeAxis('week', [], day, 1)
      for (const b of axis.buckets) expect(b.end - b.start).toBe(7)
    }
  })
})

describe('performance', () => {
  it('plans 5000 items over 52 weeks quickly', () => {
    const axis = computeAxis('week', [TODAY, TODAY + 364 + 40], TODAY, 1)
    const index = WorkdayIndex.around(TODAY, MON_TO_FRI)
    const entries: LoadEntry[] = []
    let seed = 7
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    let expected = 0
    for (let i = 0; i < 5000; i++) {
      const start = TODAY + Math.floor(next() * 364)
      const length = Math.floor(next() * 40)
      const load = Math.floor(next() * 40)
      expected += load
      entries.push(entry(`i${i}`, `p${i % 60}`, load, i % 20 === 0 ? unscheduled : range(start, start + length)))
    }
    const started = Date.now()
    const { rows } = computeWorkload(entries, axis, index)
    const elapsed = Date.now() - started
    expect(rows.size).toBe(60)
    let total = 0
    for (const row of rows.values()) total += sum(row.loads) + row.unscheduledLoad
    // The axis covers every item, so nothing is lost
    expect(total).toBeCloseTo(expected, 4)
    expect(elapsed).toBeLessThan(2000)
    const cells = Date.now()
    cellItems(entries, axis, index, 'p3', axis.todayIndex + 5)
    expect(Date.now() - cells).toBeLessThan(500)
  })

  it('plans 5000 items at day zoom too', () => {
    const axis = computeAxis('day', [TODAY, TODAY + 330], TODAY, 1)
    const index = WorkdayIndex.around(TODAY, MON_TO_FRI)
    const entries: LoadEntry[] = []
    for (let i = 0; i < 5000; i++) entries.push(entry(`i${i}`, `p${i % 60}`, 8, range(TODAY + (i % 300), TODAY + (i % 300) + 30)))
    const started = Date.now()
    computeWorkload(entries, axis, index)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
