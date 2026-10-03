//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType } from '@hcengineering/tracker'
import {
  buildDateSources,
  iterationDays,
  makeSourceId,
  parseSourceId,
  partitionBySchedule,
  readSourceDay,
  resolveSchedule,
  scheduleDays,
  type DateLookups
} from '../dates'
import { toDay } from '../timeScale'

const local = (y: number, m: number, d: number, h = 0): number => new Date(y, m - 1, d, h).getTime()
const day = (y: number, m: number, d: number): number => toDay(local(y, m, d))

const lookups: DateLookups = {
  milestone: (id) =>
    id === 'm1'
      ? { startDate: local(2026, 11, 1), targetDate: local(2026, 11, 30) }
      : id === 'm2'
        ? { startDate: null, targetDate: local(2026, 12, 15) }
        : undefined,
  iterations: (key) =>
    key === 'sprint'
      ? [
          { _id: 'i1', startDate: local(2026, 10, 5), duration: 14 },
          { _id: 'i2', startDate: local(2026, 10, 19), duration: 7 }
        ]
      : []
}

describe('source ids', () => {
  it('round trips and rejects unknown ones', () => {
    for (const ref of [
      { kind: 'issue', key: 'dueDate' },
      { kind: 'milestone', key: 'targetDate' },
      { kind: 'field', key: 'releaseDate' },
      { kind: 'iteration', key: 'sprint' }
    ] as const) {
      expect(parseSourceId(makeSourceId(ref))).toEqual(ref)
    }
    expect(parseSourceId('issue:title')).toBeUndefined()
    expect(parseSourceId('milestone:label')).toBeUndefined()
    expect(parseSourceId('whatever')).toBeUndefined()
    expect(parseSourceId('field:')).toBeUndefined()
    expect(parseSourceId('sprint:x')).toBeUndefined()
  })

  it('keeps colons inside a field key', () => {
    expect(parseSourceId('field:a:b')).toEqual({ kind: 'field', key: 'a:b' })
  })
})

describe('buildDateSources', () => {
  const labels = {
    startDate: 'Start date',
    dueDate: 'Due date',
    deadline: 'Deadline',
    milestoneStart: 'Milestone start',
    milestoneTarget: 'Milestone target'
  }

  it('lists issue dates, milestone dates, then Date and Iteration fields only', () => {
    const sources = buildDateSources(
      [
        { key: 'release', label: 'Release', type: ProjectFieldType.Date },
        { key: 'notes', label: 'Notes', type: ProjectFieldType.Text },
        { key: 'sprint', label: 'Sprint', type: ProjectFieldType.Iteration },
        { key: 'size', label: 'Size', type: ProjectFieldType.SingleSelect }
      ],
      labels
    )
    expect(sources.map((s) => s.id)).toEqual([
      'issue:startDate',
      'issue:dueDate',
      'issue:deadline',
      'milestone:startDate',
      'milestone:targetDate',
      'field:release',
      'iteration:sprint'
    ])
  })

  it('marks the milestone dates as read only', () => {
    const sources = buildDateSources([], labels)
    expect(sources.filter((s) => !s.writable).map((s) => s.kind)).toEqual(['milestone', 'milestone'])
  })
})

describe('readSourceDay', () => {
  it('reads built-in and custom dates', () => {
    const issue = { startDate: local(2026, 10, 5, 14), dueDate: null, customFields: { release: local(2026, 12, 24) } }
    expect(readSourceDay(issue, { kind: 'issue', key: 'startDate' }, 'start', lookups)).toBe(day(2026, 10, 5))
    expect(readSourceDay(issue, { kind: 'issue', key: 'dueDate' }, 'target', lookups)).toBeUndefined()
    expect(readSourceDay(issue, { kind: 'field', key: 'release' }, 'target', lookups)).toBe(day(2026, 12, 24))
    expect(readSourceDay(issue, { kind: 'field', key: 'other' }, 'target', lookups)).toBeUndefined()
  })

  it('ignores values that are not timestamps', () => {
    const issue = { customFields: { release: 'soon', nan: Number.NaN } }
    expect(readSourceDay(issue, { kind: 'field', key: 'release' }, 'start', lookups)).toBeUndefined()
    expect(readSourceDay(issue, { kind: 'field', key: 'nan' }, 'start', lookups)).toBeUndefined()
  })

  it('reads the dates of the milestone of the issue', () => {
    expect(readSourceDay({ milestone: 'm1' }, { kind: 'milestone', key: 'startDate' }, 'start', lookups)).toBe(day(2026, 11, 1))
    expect(readSourceDay({ milestone: 'm1' }, { kind: 'milestone', key: 'targetDate' }, 'target', lookups)).toBe(
      day(2026, 11, 30)
    )
    // An open-ended milestone has no start
    expect(readSourceDay({ milestone: 'm2' }, { kind: 'milestone', key: 'startDate' }, 'start', lookups)).toBeUndefined()
    expect(readSourceDay({ milestone: 'gone' }, { kind: 'milestone', key: 'targetDate' }, 'target', lookups)).toBeUndefined()
    expect(readSourceDay({ milestone: null }, { kind: 'milestone', key: 'targetDate' }, 'target', lookups)).toBeUndefined()
  })

  it('gives the first day of the iteration as start and the last day as target', () => {
    const issue = { customFields: { sprint: 'i1' } }
    const ref = { kind: 'iteration', key: 'sprint' } as const
    expect(readSourceDay(issue, ref, 'start', lookups)).toBe(day(2026, 10, 5))
    // 14 days from Oct 5 end on Oct 18
    expect(readSourceDay(issue, ref, 'target', lookups)).toBe(day(2026, 10, 18))
  })

  it('has no value for an unknown iteration', () => {
    const ref = { kind: 'iteration', key: 'sprint' } as const
    expect(readSourceDay({ customFields: { sprint: 'gone' } }, ref, 'start', lookups)).toBeUndefined()
    expect(readSourceDay({}, ref, 'start', lookups)).toBeUndefined()
  })

  it('counts a one day iteration as one day', () => {
    expect(iterationDays({ startDate: local(2026, 10, 5), duration: 1 })).toEqual({
      start: day(2026, 10, 5),
      end: day(2026, 10, 5)
    })
  })
})

describe('resolveSchedule', () => {
  const selection = { start: 'issue:startDate', target: 'issue:dueDate' }

  it('is a range when both dates are known', () => {
    const s = resolveSchedule({ startDate: local(2026, 10, 5), dueDate: local(2026, 10, 9) }, selection, lookups)
    expect(s).toEqual({ kind: 'range', start: day(2026, 10, 5), target: day(2026, 10, 9), inverted: false })
  })

  it('is a one day range when both dates are the same day', () => {
    const s = resolveSchedule({ startDate: local(2026, 10, 5, 9), dueDate: local(2026, 10, 5, 18) }, selection, lookups)
    expect(s).toEqual({ kind: 'range', start: day(2026, 10, 5), target: day(2026, 10, 5), inverted: false })
  })

  it('is a marker when only one date is known', () => {
    expect(resolveSchedule({ startDate: local(2026, 10, 5) }, selection, lookups)).toEqual({
      kind: 'marker',
      day: day(2026, 10, 5),
      role: 'start'
    })
    expect(resolveSchedule({ startDate: null, dueDate: local(2026, 10, 9) }, selection, lookups)).toEqual({
      kind: 'marker',
      day: day(2026, 10, 9),
      role: 'target'
    })
  })

  it('is unscheduled without dates', () => {
    expect(resolveSchedule({ startDate: null, dueDate: null }, selection, lookups)).toEqual({ kind: 'unscheduled' })
    expect(resolveSchedule({}, { start: 'junk', target: 'junk2' }, lookups)).toEqual({ kind: 'unscheduled' })
  })

  it('draws a start after the target from the earlier to the later day and flags it', () => {
    const s = resolveSchedule({ startDate: local(2026, 10, 9), dueDate: local(2026, 10, 5) }, selection, lookups)
    expect(s).toEqual({ kind: 'range', start: day(2026, 10, 5), target: day(2026, 10, 9), inverted: true })
  })

  it('spans an iteration field used for both dates', () => {
    const sel = { start: 'iteration:sprint', target: 'iteration:sprint' }
    const s = resolveSchedule({ customFields: { sprint: 'i2' } }, sel, lookups)
    expect(s).toEqual({ kind: 'range', start: day(2026, 10, 19), target: day(2026, 10, 25), inverted: false })
  })

  it('mixes a date field with an iteration', () => {
    const sel = { start: 'iteration:sprint', target: 'field:release' }
    const s = resolveSchedule({ customFields: { sprint: 'i1', release: local(2026, 11, 20) } }, sel, lookups)
    expect(s).toEqual({ kind: 'range', start: day(2026, 10, 5), target: day(2026, 11, 20), inverted: false })
  })

  it('takes the dates of the milestone', () => {
    const sel = { start: 'milestone:startDate', target: 'milestone:targetDate' }
    expect(resolveSchedule({ milestone: 'm1' }, sel, lookups)).toMatchObject({ kind: 'range', start: day(2026, 11, 1) })
    // Open-ended milestone: only the target is known
    expect(resolveSchedule({ milestone: 'm2' }, sel, lookups)).toEqual({
      kind: 'marker',
      day: day(2026, 12, 15),
      role: 'target'
    })
    expect(resolveSchedule({}, sel, lookups)).toEqual({ kind: 'unscheduled' })
  })
})

describe('schedule helpers', () => {
  it('lists the days of a schedule', () => {
    expect(scheduleDays({ kind: 'range', start: 1, target: 5, inverted: false })).toEqual([1, 5])
    expect(scheduleDays({ kind: 'marker', day: 3, role: 'start' })).toEqual([3])
    expect(scheduleDays({ kind: 'unscheduled' })).toEqual([])
  })

  it('splits scheduled from unscheduled items and keeps their order', () => {
    const items = [
      { id: 'a', dueDate: 1 },
      { id: 'b' },
      { id: 'c', dueDate: 2 },
      { id: 'd' }
    ]
    const split = partitionBySchedule(items, (it) =>
      it.dueDate !== undefined ? { kind: 'marker', day: it.dueDate, role: 'target' } : { kind: 'unscheduled' }
    )
    expect(split.scheduled.map((i) => i.id)).toEqual(['a', 'c'])
    expect(split.unscheduled.map((i) => i.id)).toEqual(['b', 'd'])
  })
})
