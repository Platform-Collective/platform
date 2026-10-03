//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { compareEvents, type CalendarEvent } from './events'
import type { DayRange } from './grid'

/** One entry of the agenda: an event on one of its days. */
export interface AgendaEntry<T> {
  event: CalendarEvent<T>
  // The first day of the event / the last one (a bar that spans days is listed on each of them)
  first: boolean
  last: boolean
}

export interface AgendaDay<T> {
  day: number
  entries: Array<AgendaEntry<T>>
}

/**
 * The days of the range that have events, in date order, each with its events (bars first, then the chips in the sort
 * order). An event that spans several days is listed on each of them, so the day a viewer looks at is complete.
 */
export function groupAgenda<T> (events: ReadonlyArray<CalendarEvent<T>>, range: DayRange): Array<AgendaDay<T>> {
  const byDay = new Map<number, Array<AgendaEntry<T>>>()
  for (const event of events) {
    const from = Math.max(event.start, range.start)
    const to = Math.min(event.end, range.end - 1)
    for (let day = from; day <= to; day++) {
      let list = byDay.get(day)
      if (list === undefined) {
        list = []
        byDay.set(day, list)
      }
      list.push({ event, first: day === event.start, last: day === event.end })
    }
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, entries]) => ({ day, entries: entries.sort((a, b) => compareEvents(a.event, b.event)) }))
}
