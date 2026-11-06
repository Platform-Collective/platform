// SPDX-License-Identifier: EPL-2.0

import type { Ref } from '@hcengineering/core'
import type { ToDo, WorkSlot } from '@hcengineering/time'
import type { Issue } from '@hcengineering/tracker'

import { getPlannerMarkers, getPlannerMonthRange } from '../components/planner-markers'

const TODO_ID = 'todo' as Ref<ToDo>
const ISSUE_ID = 'issue' as Ref<Issue>
const month = new Date(2025, 0, 15)
const todo = { _id: TODO_ID, attachedTo: ISSUE_ID }

function date (day: number, hour = 0): number {
  return new Date(2025, 0, day, hour).getTime()
}

describe('planner calendar markers', () => {
  it('uses local month boundaries, including the year transition', () => {
    expect(getPlannerMonthRange(new Date(2024, 11, 31))).toEqual({
      start: new Date(2024, 11, 1).getTime(),
      end: date(1)
    })
    expect(getPlannerMonthRange(month)).toEqual({ start: date(1), end: date(32) })
  })

  it('marks both action item and linked issue due dates, once per local day', () => {
    const markers = getPlannerMarkers(
      month,
      [
        { ...todo, dueDate: date(5, 23) },
        { ...todo, dueDate: date(5, 12) }
      ],
      [{ _id: ISSUE_ID, dueDate: date(8, 12) }],
      []
    )

    expect(markers.due).toEqual(new Set([date(5), date(8)]))
    expect(markers.scheduled.size).toBe(0)
  })

  it('ignores missing, unrelated and out-of-month due dates', () => {
    const markers = getPlannerMarkers(
      month,
      [
        { ...todo, dueDate: null },
        { ...todo, dueDate: date(0) },
        { ...todo, dueDate: date(32) }
      ],
      [{ _id: 'unrelated' as Ref<Issue>, dueDate: date(8) }],
      []
    )

    expect(markers.due.size).toBe(0)
  })

  it('marks each scheduled day and excludes the exclusive end and other users’ action items', () => {
    const markers = getPlannerMarkers(
      month,
      [todo],
      [],
      [
        { attachedTo: TODO_ID, date: date(5, 23), dueDate: date(7) },
        { attachedTo: TODO_ID, date: date(6, 12), dueDate: date(6, 13) },
        { attachedTo: 'other' as Ref<ToDo>, date: date(8), dueDate: date(9) }
      ]
    )

    expect(markers.scheduled).toEqual(new Set([date(5), date(6)]))
  })

  it('clips workslots to the visible month, including slots spanning a month boundary', () => {
    const slots = [
      { attachedTo: TODO_ID, date: date(0, 23), dueDate: date(1, 1) },
      { attachedTo: TODO_ID, date: date(31, 23), dueDate: date(32, 1) },
      { attachedTo: TODO_ID, date: date(-1), dueDate: date(1) },
      { attachedTo: TODO_ID, date: date(32), dueDate: date(33) }
    ]

    expect(getPlannerMarkers(month, [todo], [], slots).scheduled).toEqual(new Set([date(1), date(31)]))
    expect(getPlannerMarkers(new Date(2025, 1, 1), [todo], [], slots).scheduled).toEqual(new Set([date(32)]))
  })

  it('rebuilds markers when deadlines or workslots change or are removed', () => {
    const slots: Pick<WorkSlot, 'attachedTo' | 'date' | 'dueDate'>[] = [
      { attachedTo: TODO_ID, date: date(5, 12), dueDate: date(5, 13) }
    ]
    expect(getPlannerMarkers(month, [todo], [], slots).scheduled).toEqual(new Set([date(5)]))

    slots[0] = { attachedTo: TODO_ID, date: date(8, 12), dueDate: date(8, 13) }
    const markers = getPlannerMarkers(month, [{ ...todo, dueDate: date(8) }], [], slots)
    expect(markers.due).toEqual(new Set([date(8)]))
    expect(markers.scheduled).toEqual(new Set([date(8)]))
    expect(getPlannerMarkers(month, [], [], slots).scheduled.size).toBe(0)
    expect(getPlannerMarkers(month, [todo], [], []).due.size).toBe(0)
    expect(getPlannerMarkers(month, [todo], [], []).scheduled.size).toBe(0)
  })

  it('uses calendar days across daylight saving changes', () => {
    const start = new Date(2025, 2, 8, 23).getTime()
    const end = new Date(2025, 2, 11).getTime()
    const markers = getPlannerMarkers(
      new Date(2025, 2, 1),
      [todo],
      [],
      [{ attachedTo: TODO_ID, date: start, dueDate: end }]
    )

    expect(markers.scheduled).toEqual(
      new Set([new Date(2025, 2, 8).getTime(), new Date(2025, 2, 9).getTime(), new Date(2025, 2, 10).getTime()])
    )
  })
})
