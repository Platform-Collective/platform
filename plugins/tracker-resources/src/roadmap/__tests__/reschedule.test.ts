//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { buildDateSources, resolveSchedule, type DateIssue, type DateLookups, type DateSelection } from '../dates'
import {
  applyDelta,
  buildIssuePatch,
  iterationAt,
  planReschedule,
  planSchedule,
  previewSchedule,
  snapIteration
} from '../reschedule'
import { toDay } from '../timeScale'
import { ProjectFieldType } from '@hcengineering/tracker'

const local = (y: number, m: number, d: number, h = 0): number => new Date(y, m - 1, d, h).getTime()
const day = (y: number, m: number, d: number): number => toDay(local(y, m, d))

const iterations = [
  { _id: 'i1', startDate: local(2026, 10, 5), duration: 7 },
  { _id: 'brk', startDate: local(2026, 10, 12), duration: 7, isBreak: true },
  { _id: 'i2', startDate: local(2026, 10, 19), duration: 7 },
  { _id: 'i3', startDate: local(2026, 10, 26), duration: 7 }
]

const lookups: DateLookups = {
  milestone: (id) => (id === 'm' ? { startDate: local(2026, 11, 1), targetDate: local(2026, 11, 30) } : undefined),
  iterations: (key) => (key === 'sprint' ? iterations : [])
}

const sources = new Map(
  buildDateSources(
    [
      { key: 'release', label: 'Release', type: ProjectFieldType.Date },
      { key: 'sprint', label: 'Sprint', type: ProjectFieldType.Iteration }
    ],
    { startDate: 'S', dueDate: 'D', deadline: 'DL', milestoneStart: 'MS', milestoneTarget: 'MT' }
  ).map((s) => [s.id, s])
)

function ctx (issue: DateIssue, selection: DateSelection) {
  return { issue, selection, sources, lookups, schedule: resolveSchedule(issue, selection, lookups) }
}

const dates: DateSelection = { start: 'issue:startDate', target: 'issue:dueDate' }

describe('applyDelta', () => {
  const range = { start: 10, target: 14 }

  it('moves both dates and keeps the duration', () => {
    expect(applyDelta(range, 'move', 3)).toEqual({ start: 13, target: 17 })
    expect(applyDelta(range, 'move', -20)).toEqual({ start: -10, target: -6 })
  })

  it('resizes one edge', () => {
    expect(applyDelta(range, 'resize-start', -2)).toEqual({ start: 8, target: 14 })
    expect(applyDelta(range, 'resize-end', 5)).toEqual({ start: 10, target: 19 })
  })

  it('stops an edge at the other one so that the range keeps one day', () => {
    expect(applyDelta(range, 'resize-start', 10)).toEqual({ start: 14, target: 14 })
    expect(applyDelta(range, 'resize-end', -10)).toEqual({ start: 10, target: 10 })
  })
})

describe('previewSchedule', () => {
  it('previews moves of ranges and markers', () => {
    expect(previewSchedule({ kind: 'range', start: 1, target: 3, inverted: false }, 'move', 2)).toEqual({
      kind: 'range',
      start: 3,
      target: 5,
      inverted: false
    })
    expect(previewSchedule({ kind: 'marker', day: 4, role: 'target' }, 'move', -1)).toEqual({
      kind: 'marker',
      day: 3,
      role: 'target'
    })
  })

  it('does not resize markers, inverted ranges or unscheduled items', () => {
    const marker = { kind: 'marker', day: 4, role: 'target' } as const
    expect(previewSchedule(marker, 'resize-end', 3)).toBe(marker)
    const inverted = { kind: 'range', start: 1, target: 3, inverted: true } as const
    expect(previewSchedule(inverted, 'resize-start', 3)).toBe(inverted)
    expect(previewSchedule({ kind: 'unscheduled' }, 'move', 3)).toEqual({ kind: 'unscheduled' })
  })
})

describe('iterations', () => {
  it('finds the iteration that contains a day, skipping breaks', () => {
    expect(iterationAt(iterations, day(2026, 10, 6))?._id).toBe('i1')
    expect(iterationAt(iterations, day(2026, 10, 27))?._id).toBe('i3')
    // Inside a break: the closest real iteration
    expect(iterationAt(iterations, day(2026, 10, 13))?._id).toBe('i1')
    expect(iterationAt(iterations, day(2026, 10, 17))?._id).toBe('i2')
    expect(iterationAt(iterations, day(2030, 1, 1))?._id).toBe('i3')
    expect(iterationAt([], day(2026, 10, 6))).toBeUndefined()
  })

  it('snaps a start to the iteration that starts closest and a target to the one that ends closest', () => {
    expect(snapIteration(iterations, day(2026, 10, 21), 'start')?._id).toBe('i2')
    expect(snapIteration(iterations, day(2026, 10, 23), 'start')?._id).toBe('i3')
    // Ends: i1 Oct 11, i2 Oct 25, i3 Nov 1
    expect(snapIteration(iterations, day(2026, 10, 30), 'target')?._id).toBe('i3')
    expect(snapIteration(iterations, day(2026, 10, 24), 'target')?._id).toBe('i2')
  })
})

describe('planReschedule with date fields', () => {
  const issue = { startDate: local(2026, 10, 5, 9), dueDate: local(2026, 10, 9, 17) }

  it('moves both dates by the same days and keeps their time of day', () => {
    const plan = planReschedule(ctx(issue, dates), 'move', 7)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    const byKey = Object.fromEntries(plan.writes.map((w) => [w.key, w.value as number]))
    expect(new Date(byKey.startDate).getDate()).toBe(12)
    expect(new Date(byKey.startDate).getHours()).toBe(9)
    expect(new Date(byKey.dueDate).getDate()).toBe(16)
    expect(new Date(byKey.dueDate).getHours()).toBe(17)
  })

  it('keeps the duration across a month boundary', () => {
    const plan = planReschedule(ctx(issue, dates), 'move', 30)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    const start = plan.writes.find((w) => w.key === 'startDate')?.value as number
    const due = plan.writes.find((w) => w.key === 'dueDate')?.value as number
    expect(toDay(due) - toDay(start)).toBe(4)
    expect(toDay(start) - day(2026, 10, 5)).toBe(30)
  })

  it('writes only the start when its edge is dragged', () => {
    const plan = planReschedule(ctx(issue, dates), 'resize-start', -3)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes.map((w) => w.key)).toEqual(['startDate'])
    expect(toDay(plan.writes[0].value as number)).toBe(day(2026, 10, 2))
  })

  it('writes only the target when its edge is dragged and clamps it at the start', () => {
    const plan = planReschedule(ctx(issue, dates), 'resize-end', -20)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes.map((w) => w.key)).toEqual(['dueDate'])
    expect(toDay(plan.writes[0].value as number)).toBe(day(2026, 10, 5))
  })

  it('does nothing for a zero delta or a clamped resize', () => {
    expect(planReschedule(ctx(issue, dates), 'move', 0)).toEqual({ ok: false, reason: 'unchanged' })
    const oneDay = { startDate: local(2026, 10, 5), dueDate: local(2026, 10, 5) }
    expect(planReschedule(ctx(oneDay, dates), 'resize-end', -3)).toEqual({ ok: false, reason: 'unchanged' })
  })

  it('moves a marker', () => {
    const plan = planReschedule(ctx({ dueDate: local(2026, 10, 9) }, dates), 'move', -2)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]).toMatchObject({ sourceId: 'issue:dueDate', kind: 'issue', key: 'dueDate' })
    expect(toDay(plan.writes[0].value as number)).toBe(day(2026, 10, 7))
  })

  it('cannot resize a marker, an inverted range or an item without dates', () => {
    expect(planReschedule(ctx({ dueDate: local(2026, 10, 9) }, dates), 'resize-end', 2)).toEqual({
      ok: false,
      reason: 'unsupported'
    })
    const inverted = { startDate: local(2026, 10, 9), dueDate: local(2026, 10, 5) }
    expect(planReschedule(ctx(inverted, dates), 'resize-start', 2)).toEqual({ ok: false, reason: 'unsupported' })
    expect(planReschedule(ctx({}, dates), 'move', 2)).toEqual({ ok: false, reason: 'noSchedule' })
  })

  it('moves an inverted range with each date keeping its own side', () => {
    const inverted = { startDate: local(2026, 10, 9), dueDate: local(2026, 10, 5) }
    const plan = planReschedule(ctx(inverted, dates), 'move', 2)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    const start = plan.writes.find((w) => w.key === 'startDate')?.value as number
    const due = plan.writes.find((w) => w.key === 'dueDate')?.value as number
    expect(toDay(start)).toBe(day(2026, 10, 11))
    expect(toDay(due)).toBe(day(2026, 10, 7))
  })

  it('writes custom Date fields', () => {
    const sel = { start: 'issue:startDate', target: 'field:release' }
    const i = { startDate: local(2026, 10, 5), customFields: { release: local(2026, 10, 20) } }
    const plan = planReschedule(ctx(i, sel), 'resize-end', 5)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes[0]).toMatchObject({ kind: 'field', key: 'release' })
    expect(toDay(plan.writes[0].value as number)).toBe(day(2026, 10, 25))
  })
})

describe('planReschedule with read only sources', () => {
  const sel = { start: 'issue:startDate', target: 'milestone:targetDate' }
  const issue = { startDate: local(2026, 11, 10), milestone: 'm' }

  it('refuses to move an item that takes a date from its milestone', () => {
    expect(planReschedule(ctx(issue, sel), 'move', 3)).toEqual({ ok: false, reason: 'readonly' })
    expect(planReschedule(ctx(issue, sel), 'resize-end', 3)).toEqual({ ok: false, reason: 'readonly' })
  })

  it('still resizes the edge that comes from a writable source', () => {
    const plan = planReschedule(ctx(issue, sel), 'resize-start', -3)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes.map((w) => w.key)).toEqual(['startDate'])
  })
})

describe('planReschedule with iterations', () => {
  const sel = { start: 'iteration:sprint', target: 'iteration:sprint' }

  it('moves the item to the iteration the bar is dragged to', () => {
    const issue = { customFields: { sprint: 'i1' } }
    // The bar covers Oct 5-11; one iteration further is Oct 19-25 (a break lies between)
    const plan = planReschedule(ctx(issue, sel), 'move', 14)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes).toEqual([{ sourceId: 'iteration:sprint', kind: 'iteration', key: 'sprint', value: 'i2' }])
  })

  it('keeps the iteration for a small movement', () => {
    expect(planReschedule(ctx({ customFields: { sprint: 'i2' } }, sel), 'move', 2)).toEqual({
      ok: false,
      reason: 'unchanged'
    })
  })

  it('moves back to an earlier iteration', () => {
    const plan = planReschedule(ctx({ customFields: { sprint: 'i3' } }, sel), 'move', -7)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes[0].value).toBe('i2')
  })

  it('never lands in a break', () => {
    // The start lands on Oct 15, inside the break that starts on Oct 12
    const plan = planReschedule(ctx({ customFields: { sprint: 'i1' } }, sel), 'move', 10)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes[0].value).toBe('i2')
  })

  it('resizes only the iteration of the edge that moved', () => {
    const mixed = { start: 'iteration:sprint', target: 'issue:dueDate' }
    const issue = { dueDate: local(2026, 11, 10), customFields: { sprint: 'i2' } }
    const plan = planReschedule(ctx(issue, mixed), 'resize-start', 7)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes).toEqual([{ sourceId: 'iteration:sprint', kind: 'iteration', key: 'sprint', value: 'i3' }])
  })
})

describe('planSchedule', () => {
  it('sets both dates of an item without dates', () => {
    const plan = planSchedule({ issue: {}, selection: dates, sources, lookups }, day(2026, 10, 14))
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes.map((w) => w.key).sort()).toEqual(['dueDate', 'startDate'])
    for (const w of plan.writes) expect(w.value).toBe(local(2026, 10, 14))
  })

  it('adds only the missing date to an item shown as a marker', () => {
    const plan = planSchedule({ issue: { dueDate: local(2026, 10, 9) }, selection: dates, sources, lookups }, day(2026, 10, 1))
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    expect(plan.writes.map((w) => w.key)).toEqual(['startDate'])
  })

  it('writes a single source once when start and target share it', () => {
    const sel = { start: 'field:release', target: 'field:release' }
    const plan = planSchedule({ issue: {}, selection: sel, sources, lookups }, day(2026, 10, 14))
    expect(plan.ok && plan.writes).toHaveLength(1)
  })

  it('assigns the iteration that contains the day', () => {
    const sel = { start: 'iteration:sprint', target: 'iteration:sprint' }
    const plan = planSchedule({ issue: {}, selection: sel, sources, lookups }, day(2026, 10, 21))
    expect(plan).toEqual({
      ok: true,
      writes: [{ sourceId: 'iteration:sprint', kind: 'iteration', key: 'sprint', value: 'i2' }]
    })
  })

  it('skips read only sources and fails when nothing can be written', () => {
    const sel = { start: 'milestone:startDate', target: 'issue:dueDate' }
    const plan = planSchedule({ issue: {}, selection: sel, sources, lookups }, day(2026, 10, 14))
    expect(plan.ok && plan.writes.map((w) => w.key)).toEqual(['dueDate'])
    const none = planSchedule(
      { issue: {}, selection: { start: 'milestone:startDate', target: 'milestone:targetDate' }, sources, lookups },
      day(2026, 10, 14)
    )
    expect(none).toEqual({ ok: false, reason: 'readonly' })
  })

  it('is unchanged when the item has all its dates', () => {
    const i = { startDate: local(2026, 10, 5), dueDate: local(2026, 10, 9) }
    expect(planSchedule({ issue: i, selection: dates, sources, lookups }, day(2026, 10, 14))).toEqual({
      ok: false,
      reason: 'unchanged'
    })
  })
})

describe('buildIssuePatch', () => {
  it('puts built-in dates at the top and merges custom values into one record', () => {
    const patch = buildIssuePatch({ customFields: { keep: 1 } }, [
      { sourceId: 'issue:dueDate', kind: 'issue', key: 'dueDate', value: 5 },
      { sourceId: 'field:release', kind: 'field', key: 'release', value: 6 },
      { sourceId: 'iteration:sprint', kind: 'iteration', key: 'sprint', value: 'i2' }
    ])
    expect(patch).toEqual({ dueDate: 5, customFields: { keep: 1, release: 6, sprint: 'i2' } })
  })

  it('does not touch the custom fields for built-in dates', () => {
    expect(buildIssuePatch({}, [{ sourceId: 'issue:startDate', kind: 'issue', key: 'startDate', value: 1 }])).toEqual({
      startDate: 1
    })
  })
})
