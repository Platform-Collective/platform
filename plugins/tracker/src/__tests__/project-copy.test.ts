//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import tracker from '../index'
import view from '@hcengineering/view'
import { buildProjectCopyPlan, type ProjectCopySource } from '../projectCopy'
import { MAX_PROJECT_FIELDS, ProjectFieldType } from '../projectField'
import { WorkflowKind } from '../workflow'

const SOURCE = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const TARGET = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const FIELD_SPRINT = 'f0000000000000000000sprint'
const FIELD_STATUS = 'f0000000000000000000status'
const IT1 = 'i00000000000000000000001'
const IT2 = 'i00000000000000000000002'
const IT3 = 'i00000000000000000000003'
const NOW = new Date(2026, 5, 10, 15, 30).getTime()
const DAY = 86400000

function day (y: number, m: number, d: number): number {
  return new Date(y, m, d).getTime()
}

function ids (): () => string {
  let n = 0
  return () => `new-${String(++n).padStart(4, '0')}-xxxxxxxx`
}

function source (): ProjectCopySource {
  return {
    project: { _id: SOURCE as any, shortDescription: 'Short', readme: '{"type":"doc"}', workingDaysConfig: { weekdayMask: 31 } },
    fields: [
      {
        _id: FIELD_SPRINT,
        label: 'Sprint',
        key: 'sprint',
        type: ProjectFieldType.Iteration,
        position: 2
      },
      {
        _id: FIELD_STATUS,
        label: 'Status',
        key: 'status',
        type: ProjectFieldType.SingleSelect,
        position: 1,
        defaultValue: 'o-todo',
        options: [
          { value: 'o-todo', label: 'Todo', color: 1 },
          { value: 'o-done', label: 'Done', color: 2 }
        ]
      }
    ] as any,
    iterations: [
      { _id: IT2, field: FIELD_SPRINT, label: 'Break', number: 0, startDate: day(2026, 0, 15), duration: 7, isBreak: true },
      { _id: IT1, field: FIELD_SPRINT, label: 'Iteration 1', number: 1, startDate: day(2026, 0, 1), duration: 14 },
      { _id: IT3, field: FIELD_SPRINT, label: 'Iteration 2', number: 2, startDate: day(2026, 0, 22), duration: 7 }
    ] as any,
    views: [
      {
        _id: 'v2',
        name: 'Board',
        location: { path: ['workbench', 'ws', 'tracker', SOURCE, 'issues'] },
        filters: '[]',
        viewOptions: { columnLimits: { [IT1]: 3, 'o-todo': 5 }, groupBy: ['customFields.sprint'] },
        viewletId: 'viewlet-kanban',
        filterClass: tracker.class.Issue,
        config: ['title', 'customFields.status'],
        extra: `[{"field":"${FIELD_STATUS}"}]`,
        filterQuery: 'sprint:@current',
        order: 2,
        users: ['old-user'],
        createdBy: 'old-person',
        attachedTo: SOURCE,
        project: SOURCE
      },
      {
        _id: 'v1',
        name: 'Table',
        location: { path: ['workbench', 'ws', 'tracker', SOURCE, 'issues'] },
        filters: '[]',
        order: 1,
        users: [],
        createdBy: 'old-person',
        attachedTo: SOURCE,
        project: SOURCE
      }
    ] as any,
    workflows: [
      { _id: 'w1', kind: WorkflowKind.SetStatusDoneOnClose, name: 'Item closed', enabled: false, createdOn: 1, config: { target: { field: 'status', option: 'o-done' } } },
      { _id: 'w2', kind: WorkflowKind.AutoArchive, name: 'Auto-archive items', enabled: true, createdOn: 2, filter: 'is:closed' },
      { _id: 'w3', kind: WorkflowKind.AutoArchive, name: 'Auto-archive items', enabled: false, createdOn: 3, filter: 'duplicate' }
    ] as any,
    charts: [
      { _id: 'c2', name: 'B', layout: 'bar', xField: 'customFields.status', yAggregate: { type: 'count' }, filter: '', position: 2 },
      { _id: 'c1', name: 'A', layout: 'line', xField: 'dueDate', xBucket: 'week', groupField: 'customFields.status', yAggregate: { type: 'sum', field: 'estimation' }, filter: 'is:open', position: 1 }
    ] as any
  }
}

function build (src = source()): ReturnType<typeof buildProjectCopyPlan> {
  return buildProjectCopyPlan(src, {
    target: TARGET as any,
    now: NOW,
    generateId: ids(),
    classes: {
      field: tracker.class.ProjectField,
      iteration: tracker.class.Iteration,
      view: view.class.FilteredView,
      workflow: tracker.class.Workflow,
      chart: tracker.class.InsightChart
    },
    author: { account: 'new-user' as any, person: 'new-person' as any }
  })
}

function ofClass (plan: ReturnType<typeof build>, cls: string): any[] {
  return plan.ops.filter((op) => op._class === cls)
}

describe('buildProjectCopyPlan', () => {
  it('creates everything in the target project, in a usable order', () => {
    const plan = build()
    expect(plan.ops.every((op) => op.space === TARGET)).toBe(true)
    const order = plan.ops.map((op) => op._class)
    const last = (cls: string): number => order.lastIndexOf(cls as any)
    const first = (cls: string): number => order.indexOf(cls as any)
    expect(last(tracker.class.ProjectField)).toBeLessThan(first(tracker.class.Iteration))
    expect(last(tracker.class.Iteration)).toBeLessThan(first(view.class.FilteredView))
    // all new ids are unique
    expect(new Set(plan.ops.map((op) => op.id)).size).toBe(plan.ops.length)
  })

  it('copies the fields with new ids and the same keys and options', () => {
    const plan = build()
    const fields = ofClass(plan, tracker.class.ProjectField)
    expect(fields.map((f) => f.data.key)).toEqual(['status', 'sprint'])
    const status = fields[0]
    expect(status.id).toBe(plan.fieldIds.get(FIELD_STATUS))
    expect(status.id).not.toBe(FIELD_STATUS)
    expect(status.data.options).toEqual(source().fields[1].options)
    expect(status.data.defaultValue).toBe('o-todo')
    expect(status.data).not.toHaveProperty('_id')
    // the options are copies, not shared with the source
    const src = source()
    const plan2 = build(src)
    ofClass(plan2, tracker.class.ProjectField)[0].data.options[0].label = 'changed'
    expect(src.fields[1].options?.[0].label).toBe('Todo')
  })

  it('recreates the iterations for the new field, the first one starting today', () => {
    const plan = build()
    const its = ofClass(plan, tracker.class.Iteration)
    expect(its).toHaveLength(3)
    const newField = plan.fieldIds.get(FIELD_SPRINT)
    expect(its.every((it) => it.data.field === newField)).toBe(true)
    const byLabel = (label: string): any => its.find((it) => it.data.label === label).data
    const today = day(2026, 5, 10)
    expect(byLabel('Iteration 1').startDate).toBe(today)
    // gaps, durations and breaks stay as they were: the break starts 14 days after the first, the next one 21
    expect(byLabel('Break').startDate).toBe(day(2026, 5, 24))
    expect(byLabel('Break').isBreak).toBe(true)
    expect(byLabel('Iteration 2').startDate).toBe(day(2026, 6, 1))
    expect(byLabel('Iteration 1').duration).toBe(14)
    expect(plan.iterationIds.size).toBe(3)
  })

  it('shifts each iteration field on its own', () => {
    const src = source()
    src.fields = [
      ...src.fields,
      { _id: 'f0000000000000000000second', label: 'Phase', key: 'phase', type: ProjectFieldType.Iteration, position: 3 } as any
    ]
    src.iterations = [
      ...src.iterations,
      { _id: 'i00000000000000000000009', field: 'f0000000000000000000second', label: 'Phase 1', number: 1, startDate: day(2025, 2, 3), duration: 7 } as any
    ]
    const plan = build(src)
    const phase = ofClass(plan, tracker.class.Iteration).find((it) => it.data.label === 'Phase 1')
    expect(phase.data.startDate).toBe(day(2026, 5, 10))
  })

  it('does not move an iteration that already starts today', () => {
    const src = source()
    src.iterations = [{ _id: IT1, field: FIELD_SPRINT, label: 'I', number: 1, startDate: day(2026, 5, 10), duration: 7 } as any]
    const plan = build(src)
    expect(ofClass(plan, tracker.class.Iteration)[0].data.startDate).toBe(day(2026, 5, 10))
  })

  it('keeps the shift in whole days across a daylight saving change', () => {
    const src = source()
    // A winter start moved to a summer day must still be local midnight
    src.iterations = [{ _id: IT1, field: FIELD_SPRINT, label: 'I', number: 1, startDate: day(2026, 0, 5), duration: 7 } as any]
    const plan = build(src)
    const start = ofClass(plan, tracker.class.Iteration)[0].data.startDate
    expect(new Date(start).getHours()).toBe(0)
    expect(Math.abs(start - day(2026, 5, 10))).toBeLessThan(DAY)
  })

  it('drops the iterations of a field that was not copied', () => {
    const src = source()
    src.iterations = [...src.iterations, { _id: 'i00000000000000000000008', field: 'unknown-field-id', label: 'Lost', number: 1, startDate: 1, duration: 1 } as any]
    const plan = build(src)
    expect(ofClass(plan, tracker.class.Iteration)).toHaveLength(3)
    expect(plan.iterationIds.has('i00000000000000000000008')).toBe(false)
  })

  it('copies the views in tab order with the ids they mention remapped', () => {
    const plan = build()
    const views = ofClass(plan, view.class.FilteredView)
    expect(views.map((v) => v.data.name)).toEqual(['Table', 'Board'])
    const board = views[1].data
    const newIt1 = plan.iterationIds.get(IT1) as string
    expect(board.viewOptions.columnLimits).toEqual({ [newIt1]: 3, 'o-todo': 5 })
    expect(board.viewOptions.groupBy).toEqual(['customFields.sprint'])
    expect(board.extra).toBe(`[{"field":"${plan.fieldIds.get(FIELD_STATUS)}"}]`)
    expect(board.location.path).toEqual(['workbench', 'ws', 'tracker', TARGET, 'issues'])
    expect(board.config).toEqual(['title', 'customFields.status'])
    expect(board.filterQuery).toBe('sprint:@current')
    expect(board.viewletId).toBe('viewlet-kanban')
    expect(board.project).toBe(TARGET)
    expect(board.attachedTo).toBe(TARGET)
    expect(board.users).toEqual(['new-user'])
    expect(board.createdBy).toBe('new-person')
    expect(board.sharable).toBe(true)
    expect(board.order).toBe(2)
    expect(JSON.stringify(plan.ops)).not.toContain(SOURCE)
    expect(plan.viewIds.size).toBe(2)
  })

  it('leaves out what a view does not have', () => {
    const table = ofClass(build(), view.class.FilteredView)[0].data
    expect(table).not.toHaveProperty('viewOptions')
    expect(table).not.toHaveProperty('extra')
    expect(table).not.toHaveProperty('config')
  })

  it('copies the workflows with their state, one per kind', () => {
    const wfs = ofClass(build(), tracker.class.Workflow)
    expect(wfs.map((w) => w.data.kind)).toEqual([WorkflowKind.SetStatusDoneOnClose, WorkflowKind.AutoArchive])
    expect(wfs[0].data).toEqual({
      name: 'Item closed',
      enabled: false,
      kind: WorkflowKind.SetStatusDoneOnClose,
      config: { target: { field: 'status', option: 'o-done' } }
    })
    // the oldest of two workflows of a kind is the one that counts
    expect(wfs[1].data.filter).toBe('is:closed')
    expect(wfs[1].data.enabled).toBe(true)
    expect(wfs[1].data).not.toHaveProperty('runRequestedAt')
  })

  it('copies the Insights charts in order', () => {
    const charts = ofClass(build(), tracker.class.InsightChart)
    expect(charts.map((c) => c.data.name)).toEqual(['A', 'B'])
    expect(charts[0].data).toEqual({
      name: 'A',
      layout: 'line',
      xField: 'dueDate',
      xBucket: 'week',
      groupField: 'customFields.status',
      yAggregate: { type: 'sum', field: 'estimation' },
      filter: 'is:open',
      position: 1
    })
    expect(charts[1].data).not.toHaveProperty('xBucket')
  })

  it('gives the details the new project starts with', () => {
    const plan = build()
    expect(plan.projectData).toEqual({
      shortDescription: 'Short',
      readme: '{"type":"doc"}',
      workingDaysConfig: { weekdayMask: 31 }
    })
    expect(build({ ...source(), project: { _id: SOURCE as any } }).projectData).toEqual({})
  })

  it('never copies issues', () => {
    const plan = build()
    expect(plan.ops.some((op) => op._class === tracker.class.Issue)).toBe(false)
  })

  it('keeps at most the field limit', () => {
    const src = source()
    src.fields = Array.from({ length: MAX_PROJECT_FIELDS + 5 }, (_, i) => ({
      _id: `field-id-${i}-xxxxxxxx`,
      label: `F${i}`,
      key: `f${i}`,
      type: ProjectFieldType.Text,
      position: i
    })) as any
    src.iterations = []
    const plan = build(src)
    expect(ofClass(plan, tracker.class.ProjectField)).toHaveLength(MAX_PROJECT_FIELDS)
  })

  it('copies an empty project to an empty plan', () => {
    const plan = build({ project: { _id: SOURCE as any }, fields: [], iterations: [], views: [], workflows: [], charts: [] })
    expect(plan.ops).toEqual([])
    expect(plan.projectData).toEqual({})
  })

  it('does not touch the source documents', () => {
    const src = source()
    const before = JSON.stringify(src)
    build(src)
    expect(JSON.stringify(src)).toBe(before)
  })
})
