//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType } from '@hcengineering/tracker'
import { draftValuesForDay } from '../addItem'
import { dragDelta } from '../drag'
import { buildDateSources, resolveSchedule, type DateIssue, type DateLookups, type DateSelection } from '../../roadmap/dates'
import { buildIssuePatch, planReschedule, planSchedule, previewSchedule, type PlanContext } from '../../roadmap/reschedule'
import { toDay } from '../../roadmap/timeScale'

const local = (y: number, m: number, d: number, h = 0): number => new Date(y, m - 1, d, h).getTime()
const day = (y: number, m: number, d: number): number => toDay(local(y, m, d))

const iterations = [
  { _id: 'i1', startDate: local(2026, 10, 5), duration: 7 },
  { _id: 'i2', startDate: local(2026, 10, 12), duration: 7 }
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

function ctx (issue: DateIssue, selection: DateSelection): PlanContext {
  return { issue, selection, sources, lookups, schedule: resolveSchedule(issue, selection, lookups) }
}

const dates: DateSelection = { start: 'issue:startDate', target: 'issue:dueDate' }

describe('dragDelta', () => {
  const range = { kind: 'range' as const, start: 10, target: 14, inverted: false }

  it('moves by the distance between the grabbed day and the day under the pointer', () => {
    // Grabbed the bar by its third day (12), dropped on day 20: both dates move by 8 and keep the duration
    expect(dragDelta('move', range, 12, 20)).toBe(8)
    expect(dragDelta('move', range, 12, 5)).toBe(-7)
    expect(dragDelta('move', { kind: 'marker', day: 3, role: 'target' }, 3, 3)).toBe(0)
  })

  it('moves the dragged edge to the day under the pointer', () => {
    expect(dragDelta('resize-start', range, 10, 8)).toBe(-2)
    expect(dragDelta('resize-end', range, 14, 20)).toBe(6)
  })

  it('cannot resize what is not a range', () => {
    const marker = { kind: 'marker' as const, day: 3, role: 'target' as const }
    expect(dragDelta('resize-start', marker, 3, 9)).toBe(0)
    expect(dragDelta('resize-end', { kind: 'unscheduled' }, 3, 9)).toBe(0)
  })
})

describe('rescheduling an event', () => {
  it('keeps the duration when a bar is moved to another day', () => {
    const issue: DateIssue = { startDate: local(2026, 10, 12), dueDate: local(2026, 10, 14) }
    const schedule = resolveSchedule(issue, dates, lookups)
    const delta = dragDelta('move', schedule, day(2026, 10, 13), day(2026, 10, 27))
    const plan = planReschedule(ctx(issue, dates), 'move', delta)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    const patch = buildIssuePatch(issue, plan.writes)
    expect(patch).toEqual({ startDate: local(2026, 10, 26), dueDate: local(2026, 10, 28) })
    // The preview shows the same days
    expect(previewSchedule(schedule, 'move', delta)).toMatchObject({ start: day(2026, 10, 26), target: day(2026, 10, 28) })
  })

  it('keeps the time of day and moves a bar across the end of daylight saving time', () => {
    const issue: DateIssue = { startDate: local(2026, 10, 22, 9), dueDate: local(2026, 10, 24, 17) }
    const plan = planReschedule(ctx(issue, dates), 'move', 5)
    expect(plan.ok).toBe(true)
    if (plan.ok === false) return
    const patch = buildIssuePatch(issue, plan.writes)
    expect(patch).toEqual({ startDate: local(2026, 10, 27, 9), dueDate: local(2026, 10, 29, 17) })
  })

  it('writes only the edge that is dragged', () => {
    const issue: DateIssue = { startDate: local(2026, 10, 12), dueDate: local(2026, 10, 14) }
    const end = planReschedule(ctx(issue, dates), 'resize-end', 3)
    expect(end.ok && buildIssuePatch(issue, end.writes)).toEqual({ dueDate: local(2026, 10, 17) })
    const start = planReschedule(ctx(issue, dates), 'resize-start', -2)
    expect(start.ok && buildIssuePatch(issue, start.writes)).toEqual({ startDate: local(2026, 10, 10) })
  })

  it('never lets the start pass the end when an edge is dragged over the other', () => {
    const issue: DateIssue = { startDate: local(2026, 10, 12), dueDate: local(2026, 10, 14) }
    const schedule = resolveSchedule(issue, dates, lookups)
    const delta = dragDelta('resize-end', schedule, day(2026, 10, 14), day(2026, 10, 1))
    const plan = planReschedule(ctx(issue, dates), 'resize-end', delta)
    expect(plan.ok && buildIssuePatch(issue, plan.writes)).toEqual({ dueDate: local(2026, 10, 12) })
  })

  it('moves a chip with one date', () => {
    const issue: DateIssue = { dueDate: local(2026, 10, 14) }
    const plan = planReschedule(ctx(issue, dates), 'move', -4)
    expect(plan.ok && buildIssuePatch(issue, plan.writes)).toEqual({ dueDate: local(2026, 10, 10) })
  })

  it('does not write a milestone date', () => {
    const issue: DateIssue = { milestone: 'm', dueDate: local(2026, 11, 3) }
    const selection = { start: 'milestone:startDate', target: 'issue:dueDate' }
    const move = planReschedule(ctx(issue, selection), 'move', 2)
    expect(move).toEqual({ ok: false, reason: 'readonly' })
    // The other edge can still be dragged
    const resize = planReschedule(ctx(issue, selection), 'resize-end', 2)
    expect(resize.ok && buildIssuePatch(issue, resize.writes)).toEqual({ dueDate: local(2026, 11, 5) })
  })

  it('moves an item to the iteration the new day belongs to', () => {
    const issue: DateIssue = { customFields: { sprint: 'i1' } }
    const selection = { start: 'iteration:sprint', target: 'iteration:sprint' }
    const plan = planReschedule(ctx(issue, selection), 'move', 7)
    expect(plan.ok && buildIssuePatch(issue, plan.writes)).toEqual({ customFields: { sprint: 'i2' } })
  })

  it('writes custom date fields without losing the other custom fields', () => {
    const issue: DateIssue = { customFields: { release: local(2026, 10, 20), other: 'x' } }
    const selection = { start: 'none', target: 'field:release' }
    const plan = planReschedule(ctx(issue, selection), 'move', 2)
    expect(plan.ok && buildIssuePatch(issue, plan.writes)).toEqual({
      customFields: { release: local(2026, 10, 22), other: 'x' }
    })
  })

  it('reports no change for a drop on the same day', () => {
    const issue: DateIssue = { dueDate: local(2026, 10, 14) }
    expect(planReschedule(ctx(issue, dates), 'move', 0)).toEqual({ ok: false, reason: 'unchanged' })
  })

  it('puts an item without a day on the day it is dropped on', () => {
    const plan = planSchedule({ issue: {}, selection: dates, sources, lookups }, day(2026, 10, 9))
    expect(plan.ok && buildIssuePatch({}, plan.writes)).toEqual({
      startDate: local(2026, 10, 9),
      dueDate: local(2026, 10, 9)
    })
  })

  it('only sets the date that is switched on when the other one is none', () => {
    const plan = planSchedule({ issue: {}, selection: { start: 'none', target: 'issue:dueDate' }, sources, lookups }, day(2026, 10, 9))
    expect(plan.ok && buildIssuePatch({}, plan.writes)).toEqual({ dueDate: local(2026, 10, 9) })
  })
})

describe('draftValuesForDay', () => {
  const base = { selection: dates, sources, lookups }

  it('gives the day in both date fields', () => {
    const res = draftValuesForDay(base, day(2026, 10, 9))
    expect(res).toEqual({ ok: true, values: { startDate: local(2026, 10, 9), dueDate: local(2026, 10, 9) } })
  })

  it('gives the day in a custom date field and the deadline', () => {
    const res = draftValuesForDay({ ...base, selection: { start: 'field:release', target: 'issue:deadline' } }, day(2026, 10, 9))
    expect(res).toEqual({
      ok: true,
      values: { deadline: local(2026, 10, 9), customFields: { release: local(2026, 10, 9) } }
    })
  })

  it('gives the iteration of the day for an iteration field', () => {
    const res = draftValuesForDay({ ...base, selection: { start: 'iteration:sprint', target: 'iteration:sprint' } }, day(2026, 10, 14))
    expect(res).toEqual({ ok: true, values: { customFields: { sprint: 'i2' } } })
  })

  it('fails when the dates cannot be written', () => {
    const res = draftValuesForDay(
      { ...base, selection: { start: 'milestone:startDate', target: 'milestone:targetDate' } },
      day(2026, 10, 9)
    )
    expect(res).toEqual({ ok: false, reason: 'readonly' })
  })

  it('writes only the writable one of a milestone and an issue date', () => {
    const res = draftValuesForDay(
      { ...base, selection: { start: 'milestone:startDate', target: 'issue:dueDate' } },
      day(2026, 10, 9)
    )
    expect(res).toEqual({ ok: true, values: { dueDate: local(2026, 10, 9) } })
  })
})
