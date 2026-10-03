//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { groupAgenda } from '../agenda'
import {
  buildCalendarEvents,
  compareEvents,
  eventsInRange,
  eventsOnDay,
  isMultiDay,
  layoutWeek,
  type CalendarEvent
} from '../events'
import type { ItemSchedule } from '../../roadmap/dates'

interface Item {
  id: string
  schedule: ItemSchedule
}

const range = (id: string, start: number, target: number, inverted = false): Item => ({
  id,
  schedule: { kind: 'range', start, target, inverted }
})
const marker = (id: string, day: number): Item => ({ id, schedule: { kind: 'marker', day, role: 'target' } })
const none = (id: string): Item => ({ id, schedule: { kind: 'unscheduled' } })

function build (items: Item[]): { events: Array<CalendarEvent<Item>>, unscheduled: Item[] } {
  return buildCalendarEvents(
    items,
    (i) => i.id,
    (i) => i.schedule
  )
}

// A week that starts on day 100
const W = 100

describe('buildCalendarEvents', () => {
  it('makes bars, chips and sets aside the items without a day, keeping the order', () => {
    const { events, unscheduled } = build([range('a', 101, 103), none('b'), marker('c', 105), range('d', 102, 102)])
    expect(events.map((e) => e.id)).toEqual(['a', 'c', 'd'])
    expect(events.map((e) => e.order)).toEqual([0, 2, 3])
    expect(unscheduled.map((i) => i.id)).toEqual(['b'])
    expect(events.map(isMultiDay)).toEqual([true, false, false])
  })

  it('carries the inverted flag of a range', () => {
    const { events } = build([range('a', 101, 103, true)])
    expect(events[0]).toMatchObject({ start: 101, end: 103, inverted: true })
  })
})

describe('event queries', () => {
  const { events } = build([range('a', 98, 102), marker('b', 105), range('c', 110, 112), marker('d', 101)])

  it('finds the events that touch a range', () => {
    expect(eventsInRange(events, { start: 100, end: 107 }).map((e) => e.id)).toEqual(['a', 'b', 'd'])
    expect(eventsInRange(events, { start: 103, end: 105 }).map((e) => e.id)).toEqual([])
    expect(eventsInRange(events, { start: 112, end: 113 }).map((e) => e.id)).toEqual(['c'])
  })

  it('lists the events of a day with bars first', () => {
    expect(eventsOnDay(events, 101).map((e) => e.id)).toEqual(['a', 'd'])
    expect(eventsOnDay(events, 111).map((e) => e.id)).toEqual(['c'])
    expect(eventsOnDay(events, 120)).toEqual([])
  })

  it('orders bars by start then length and chips by the sort order', () => {
    const list = build([marker('chip1', 101), range('long', 101, 105), range('short', 101, 102), range('early', 99, 101), marker('chip0', 101)])
      .events
    const ids = [...list].sort(compareEvents).map((e) => e.id)
    expect(ids).toEqual(['early', 'long', 'short', 'chip1', 'chip0'])
  })
})

describe('layoutWeek', () => {
  it('splits a bar at the edges of the week and flags the continuation', () => {
    const { events } = build([range('a', 97, 102), range('b', 104, 110)])
    const layout = layoutWeek(events, W)
    const a = layout.segments.find((s) => s.event.id === 'a')
    const b = layout.segments.find((s) => s.event.id === 'b')
    expect(a).toMatchObject({ col: 0, span: 3, continuesBefore: true, continuesAfter: false })
    expect(b).toMatchObject({ col: 4, span: 3, continuesBefore: false, continuesAfter: true })
    // The next week has the rest of both
    const next = layoutWeek(events, W + 7)
    expect(next.segments.map((s) => s.event.id)).toEqual(['b'])
    expect(next.segments[0]).toMatchObject({ col: 0, span: 4, continuesBefore: true, continuesAfter: false })
  })

  it('packs overlapping bars into separate lanes and reuses a lane after a bar ended', () => {
    const { events } = build([range('a', 100, 102), range('b', 101, 103), range('c', 103, 105), range('d', 104, 106)])
    const lanes = Object.fromEntries(layoutWeek(events, W).segments.map((s) => [s.event.id, s.lane]))
    expect(lanes).toEqual({ a: 0, b: 1, c: 0, d: 1 })
    expect(layoutWeek(events, W).laneCount).toBe(2)
  })

  it('never puts two segments over the same column in one lane', () => {
    const items: Item[] = []
    for (let i = 0; i < 40; i++) {
      const start = W - 2 + ((i * 3) % 9)
      items.push(i % 3 === 0 ? marker(`m${i}`, start) : range(`r${i}`, start, start + (i % 5)))
    }
    const layout = layoutWeek(build(items).events, W)
    const used = new Set<string>()
    for (const s of layout.segments) {
      for (let c = s.col; c < s.col + s.span; c++) {
        const key = `${s.lane}:${c}`
        expect(used.has(key)).toBe(false)
        used.add(key)
      }
    }
  })

  it('gives the chips of a day lanes in the sort order, below the bars', () => {
    const { events } = build([marker('c0', 101), marker('c1', 101), range('bar', 100, 103), marker('c2', 101)])
    const layout = layoutWeek(events, W)
    const laneOf = (id: string): number => layout.segments.find((s) => s.event.id === id)?.lane ?? -1
    expect(laneOf('bar')).toBe(0)
    expect(laneOf('c0')).toBe(1)
    expect(laneOf('c1')).toBe(2)
    expect(laneOf('c2')).toBe(3)
  })

  it('shows everything when there is no limit or enough room', () => {
    const { events } = build([marker('a', 100), marker('b', 100), marker('c', 100)])
    const unlimited = layoutWeek(events, W)
    expect(unlimited.visibleLanes).toBe(3)
    expect(unlimited.segments.every((s) => !s.hidden)).toBe(true)
    expect(layoutWeek(events, W, 3).hiddenByColumn).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('hides what does not fit, keeps the last row for "+N more" and counts the hidden per day', () => {
    const { events } = build([
      marker('a', 100),
      marker('b', 100),
      marker('c', 100),
      marker('d', 100),
      range('wide', 100, 102),
      marker('e', 102)
    ])
    const layout = layoutWeek(events, W, 3)
    // The bar takes lane 0, then a, b, c, d on lanes 1-4, and e on lane 1 of column 2
    expect(layout.laneCount).toBe(5)
    expect(layout.visibleLanes).toBe(2)
    const hidden = layout.segments.filter((s) => s.hidden).map((s) => s.event.id)
    expect(hidden).toEqual(['b', 'c', 'd'])
    expect(layout.hiddenByColumn).toEqual([3, 0, 0, 0, 0, 0, 0])
    expect(layout.segments.filter((s) => !s.hidden).map((s) => s.event.id)).toEqual(['wide', 'a', 'e'])
  })

  it('counts a hidden bar on each day it covers', () => {
    const { events } = build([marker('a', 100), marker('b', 101), range('x', 100, 101), range('y', 100, 101), range('z', 100, 101)])
    const layout = layoutWeek(events, W, 2)
    expect(layout.visibleLanes).toBe(1)
    expect(layout.hiddenByColumn[0]).toBe(layout.segments.filter((s) => s.hidden && s.col <= 0 && s.col + s.span > 0).length)
    expect(layout.hiddenByColumn[0]).toBeGreaterThan(0)
    expect(layout.hiddenByColumn[1]).toBeGreaterThan(0)
  })

  it('shows only the "+N more" row when a single row fits', () => {
    const { events } = build([marker('a', 100), marker('b', 100)])
    const layout = layoutWeek(events, W, 1)
    expect(layout.visibleLanes).toBe(0)
    expect(layout.hiddenByColumn[0]).toBe(2)
  })

  it('handles a week without events', () => {
    const layout = layoutWeek([], W, 3)
    expect(layout).toMatchObject({ laneCount: 0, visibleLanes: 0, segments: [] })
  })
})

describe('groupAgenda', () => {
  it('groups by day in date order with bars before chips, listing a bar on each of its days', () => {
    const { events } = build([marker('chip', 102), range('bar', 101, 103), marker('early', 101), marker('outside', 200)])
    const days = groupAgenda(events, { start: 100, end: 110 })
    expect(days.map((d) => d.day)).toEqual([101, 102, 103])
    expect(days[0].entries.map((e) => e.event.id)).toEqual(['bar', 'early'])
    expect(days[1].entries.map((e) => e.event.id)).toEqual(['bar', 'chip'])
    expect(days[2].entries.map((e) => e.event.id)).toEqual(['bar'])
  })

  it('marks the first and the last day of an event', () => {
    const { events } = build([range('bar', 101, 103)])
    const days = groupAgenda(events, { start: 100, end: 110 })
    expect(days.map((d) => [d.entries[0].first, d.entries[0].last])).toEqual([
      [true, false],
      [false, false],
      [false, true]
    ])
  })

  it('clips an event to the range', () => {
    const { events } = build([range('bar', 95, 105)])
    const days = groupAgenda(events, { start: 100, end: 103 })
    expect(days.map((d) => d.day)).toEqual([100, 101, 102])
    expect(days[0].entries[0].first).toBe(false)
    expect(days[2].entries[0].last).toBe(false)
  })

  it('is empty without events in the range', () => {
    expect(groupAgenda([], { start: 0, end: 10 })).toEqual([])
    expect(groupAgenda(build([marker('a', 50)]).events, { start: 0, end: 10 })).toEqual([])
  })
})
