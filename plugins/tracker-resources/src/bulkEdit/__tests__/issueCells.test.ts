//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Issue, ProjectField } from '@hcengineering/tracker'
import { IssuePriority, ProjectFieldType } from '@hcengineering/tracker'
import { tableEdit } from '@hcengineering/view-resources'

import { createIssueCellColumns, runIssueOps, type IssueCellLookups, type IssueLabelRef } from '../issueCells'

const issue = (over: Record<string, any> & { _id: string }): Issue =>
  ({
    _class: 'tracker:class:Issue',
    space: 'proj',
    attachedTo: 'no-parent',
    attachedToClass: 'tracker:class:Issue',
    collection: 'subIssues',
    title: 'Title',
    status: 'st-todo',
    priority: IssuePriority.NoPriority,
    assignee: null,
    component: null,
    milestone: null,
    dueDate: null,
    estimation: 0,
    ...over
  }) as unknown as Issue

const field = (over: Partial<ProjectField> & { key: string, type: ProjectFieldType }): ProjectField =>
  ({ _id: over.key, label: over.key, position: 0, ...over }) as unknown as ProjectField

const fields = [
  field({ key: 'note', type: ProjectFieldType.Text }),
  field({ key: 'points', type: ProjectFieldType.Number }),
  field({ key: 'due', type: ProjectFieldType.Date }),
  field({
    key: 'size',
    type: ProjectFieldType.SingleSelect,
    options: [
      { value: 's', label: 'Small' },
      { value: 'l', label: 'Large' }
    ]
  }),
  field({
    key: 'areas',
    type: ProjectFieldType.MultiSelect,
    options: [
      { value: 'ui', label: 'UI' },
      { value: 'api', label: 'API' }
    ]
  }),
  field({ key: 'sprint', type: ProjectFieldType.Iteration })
]

const day = (m: number, d: number): number => new Date(2026, m - 1, d).getTime()
const iterations: any[] = [
  { _id: 'it1', label: 'Sprint 1', number: 1, startDate: day(1, 5), duration: 7 },
  { _id: 'it2', label: 'Sprint 2', number: 2, startDate: day(1, 12), duration: 7 },
  { _id: 'brk', label: 'Holiday', number: 0, startDate: day(1, 19), duration: 7, isBreak: true }
]

let refs: Record<string, IssueLabelRef[]> = {}
let allowed = true

const lookups: IssueCellLookups = {
  statuses: () => [
    { id: 'st-todo', label: 'Todo' },
    { id: 'st-done', label: 'Done' }
  ],
  priorities: [
    { id: IssuePriority.NoPriority, label: 'No priority' },
    { id: IssuePriority.High, label: 'High' }
  ],
  assignees: [{ id: 'p1', label: 'Ann' }],
  components: [{ id: 'c1', label: 'Core' }],
  milestones: [{ id: 'm1', label: 'v1' }],
  labels: [
    { id: 'l-bug', title: 'bug', color: 3 },
    { id: 'l-ux', title: 'ux', color: 5 }
  ],
  labelRefs: (id) => refs[id] ?? [],
  fields: new Map(fields.map((f) => [f.key, f])),
  iterations: () => iterations,
  canEdit: () => allowed,
  now: () => new Date(2026, 0, 10, 12).getTime()
}

const column = createIssueCellColumns(() => lookups)

const edit = (key: string, doc: Issue, text: string): tableEdit.ParseResult<tableEdit.EditOp[]> => {
  const col = column(key)
  if (col?.edit === undefined) throw new Error(`no editable column ${key}`)
  return col.edit(doc, text)
}

beforeEach(() => {
  refs = {}
  allowed = true
})

describe('iteration cells', () => {
  // The lookups pin "now" to 2026-01-10, which is in Sprint 1
  it('shows the title and parses titles case-insensitively', () => {
    const d = issue({ _id: 'i1', customFields: { sprint: 'it2' } })
    expect(column('cf_sprint')?.format(d)).toBe('Sprint 2')
    expect(edit('cf_sprint', d, 'sprint 1')).toMatchObject({
      ok: true,
      value: [{ kind: 'update', after: { customFields: { sprint: 'it1' } } }]
    })
  })

  it('understands the filter keywords', () => {
    const d = issue({ _id: 'i1' })
    const after = (text: string): unknown => {
      const res = edit('cf_sprint', d, text)
      return res.ok ? (res.value[0] as any).after.customFields : res
    }
    expect(after('@current')).toEqual({ sprint: 'it1' })
    expect(after('@next')).toEqual({ sprint: 'it2' })
    expect(after('@current+1')).toEqual({ sprint: 'it2' })
    expect(edit('cf_sprint', d, '@previous')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('refuses breaks and unknown titles, and clears on empty text', () => {
    const d = issue({ _id: 'i1', customFields: { sprint: 'it1', other: 1 } })
    expect(edit('cf_sprint', d, 'Holiday')).toEqual({ ok: false, reason: 'unknown' })
    expect(edit('cf_sprint', d, 'nope')).toEqual({ ok: false, reason: 'unknown' })
    expect(edit('cf_sprint', d, '')).toMatchObject({ ok: true, value: [{ after: { customFields: { other: 1 } } }] })
  })
})

describe('issue cell columns', () => {
  it('has no column for read-only cells', () => {
    expect(column('issue')).toBeUndefined()
    expect(column('modified')).toBeUndefined()
    expect(column('cf_missing')).toBeUndefined()
    expect(column('cf_sprint')).toBeDefined()
  })

  it('sets the status by name and refuses to clear it', () => {
    const d = issue({ _id: 'i1' })
    expect(column('status')?.format(d)).toBe('Todo')
    expect(edit('status', d, 'done')).toMatchObject({
      ok: true,
      value: [{ kind: 'update', before: { status: 'st-todo' }, after: { status: 'st-done' } }]
    })
    expect(edit('status', d, '')).toEqual({ ok: false, reason: 'notClearable' })
    expect(edit('status', d, 'Blocked')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('sets and clears the priority', () => {
    const d = issue({ _id: 'i1', priority: IssuePriority.High })
    expect(column('priority')?.format(d)).toBe('High')
    expect(edit('priority', d, '')).toMatchObject({ ok: true, value: [{ after: { priority: IssuePriority.NoPriority } }] })
    expect(edit('priority', issue({ _id: 'i2' }), 'high')).toMatchObject({
      ok: true,
      value: [{ after: { priority: IssuePriority.High } }]
    })
  })

  it('sets and clears the assignee, component and milestone', () => {
    const d = issue({ _id: 'i1', assignee: 'p1' as any })
    expect(column('assignee')?.format(d)).toBe('Ann')
    expect(edit('assignee', d, '')).toMatchObject({ ok: true, value: [{ before: { assignee: 'p1' }, after: { assignee: null } }] })
    expect(edit('component', issue({ _id: 'i2' }), 'core')).toMatchObject({ ok: true, value: [{ after: { component: 'c1' } }] })
    expect(edit('milestone', issue({ _id: 'i2' }), 'v2')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('parses due dates and estimation', () => {
    const d = issue({ _id: 'i1' })
    expect(edit('dueDate', d, '2026-02-01')).toMatchObject({
      ok: true,
      value: [{ after: { dueDate: new Date(2026, 1, 1).getTime() } }]
    })
    expect(edit('dueDate', d, '@today+2d')).toMatchObject({
      ok: true,
      value: [{ after: { dueDate: new Date(2026, 0, 12).getTime() } }]
    })
    expect(edit('dueDate', d, 'soon')).toEqual({ ok: false, reason: 'invalid' })
    expect(edit('estimation', d, '3.5')).toMatchObject({ ok: true, value: [{ after: { estimation: 3.5 } }] })
    expect(edit('estimation', issue({ _id: 'i2', estimation: 4 }), '')).toMatchObject({
      ok: true,
      value: [{ before: { estimation: 4 }, after: { estimation: 0 } }]
    })
    expect(edit('estimation', d, '-1')).toEqual({ ok: false, reason: 'invalid' })
    expect(column('estimation')?.format(d)).toBe('')
  })

  it('does not clear the title', () => {
    const d = issue({ _id: 'i1' })
    expect(edit('title', d, '  New title ')).toMatchObject({ ok: true, value: [{ after: { title: 'New title' } }] })
    expect(edit('title', d, ' ')).toEqual({ ok: false, reason: 'notClearable' })
  })

  it('reads and writes custom fields of every type', () => {
    const d = issue({ _id: 'i1', customFields: { note: 'x', size: 'l', areas: ['ui', 'api'], due: new Date(2026, 5, 1).getTime() } })
    expect(column('cf_note')?.format(d)).toBe('x')
    expect(column('cf_size')?.format(d)).toBe('Large')
    expect(column('cf_areas')?.format(d)).toBe('UI, API')
    expect(column('cf_due')?.format(d)).toBe('2026-06-01')
    expect(column('cf_points')?.format(d)).toBe('')

    expect(edit('cf_points', d, '8')).toMatchObject({
      ok: true,
      value: [{ after: { customFields: { note: 'x', size: 'l', areas: ['ui', 'api'], due: expect.any(Number), points: 8 } } }]
    })
    expect(edit('cf_size', d, 'small')).toMatchObject({ ok: true, value: [{ after: { customFields: expect.objectContaining({ size: 's' }) } }] })
    expect(edit('cf_size', d, 'huge')).toEqual({ ok: false, reason: 'unknown' })
    expect(edit('cf_areas', d, 'api')).toMatchObject({ ok: true, value: [{ after: { customFields: expect.objectContaining({ areas: ['api'] }) } }] })
    expect(edit('cf_points', d, 'many')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('removes the key when a custom field is cleared and restores an empty record on undo', () => {
    const d = issue({ _id: 'i1', customFields: { note: 'x' } })
    const res = edit('cf_note', d, '')
    expect(res).toMatchObject({ ok: true, value: [{ before: { customFields: { note: 'x' } }, after: { customFields: {} } }] })
    const bare = issue({ _id: 'i2' })
    const set = edit('cf_note', bare, 'y')
    expect(set).toMatchObject({ ok: true, value: [{ before: { customFields: {} }, after: { customFields: { note: 'y' } } }] })
  })

  it('sets labels by adding and removing references', () => {
    refs.i1 = [
      { _id: 'r1', tag: 'l-bug', title: 'bug', color: 3 },
      { _id: 'r2', tag: 'l-ux', title: 'ux', color: 5 }
    ]
    const d = issue({ _id: 'i1' })
    expect(column('labels')?.format(d)).toBe('bug, ux')

    const res = edit('labels', d, 'ux')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toHaveLength(1)
      expect(res.value[0]).toMatchObject({
        kind: 'remove',
        target: { _id: 'r1', attachedTo: 'i1', collection: 'labels' },
        attributes: { tag: 'l-bug', title: 'bug', color: 3 }
      })
    }

    const fresh = edit('labels', issue({ _id: 'i2' }), 'bug, ux')
    expect(fresh.ok && fresh.value.map((o) => o.kind)).toEqual(['add', 'add'])
    expect(fresh.ok && fresh.value[0]).toMatchObject({ attributes: { tag: 'l-bug', title: 'bug', color: 3 }, target: { attachedTo: 'i2' } })
    // Clearing removes every label
    expect(edit('labels', d, '')).toMatchObject({ ok: true, value: [{ kind: 'remove' }, { kind: 'remove' }] })
    // An unknown label rejects the cell
    expect(edit('labels', d, 'bug, nope')).toEqual({ ok: false, reason: 'unknown' })
    // Same labels: nothing to do
    expect(edit('labels', d, 'bug, ux')).toEqual({ ok: true, value: [] })
  })

  it('is read-only where the user may not change the attribute', () => {
    allowed = false
    expect(edit('status', issue({ _id: 'i1' }), 'done')).toEqual({ ok: false, reason: 'readonly' })
    expect(edit('cf_note', issue({ _id: 'i1' }), 'x')).toEqual({ ok: false, reason: 'readonly' })
  })

  it('plans a whole paste: valid cells apply, the others are counted', () => {
    const docs = [issue({ _id: 'i1' }), issue({ _id: 'i2' })]
    const adapter = { column }
    const plan = tableEdit.planEdits(
      [
        { doc: docs[0], key: 'status', text: 'Done' },
        { doc: docs[0], key: 'cf_points', text: '5' },
        { doc: docs[1], key: 'status', text: 'Nope' },
        { doc: docs[1], key: 'priority', text: 'High' }
      ],
      adapter
    )
    expect(plan.applied).toBe(3)
    expect(plan.skipped).toBe(1)
    expect(plan.items).toBe(2)
    // The two cells of the first issue are one update
    expect(plan.ops.filter((o) => o.target._id === 'i1')).toHaveLength(1)
  })
})

describe('runIssueOps', () => {
  function fakeClient (result = true): { client: any, calls: any[][] } {
    const calls: any[][] = []
    const batch: any = {
      updateCollection: async (...args: any[]) => calls.push(['update', ...args]),
      addCollection: async (...args: any[]) => calls.push(['add', ...args]),
      removeCollection: async (...args: any[]) => calls.push(['remove', ...args]),
      commit: async () => ({ result })
    }
    return { client: { apply: () => batch }, calls }
  }

  const target = { _id: 'i1', _class: 'cls', space: 'sp', attachedTo: 'p', attachedToClass: 'pc', collection: 'subIssues' }

  it('sends every operation in one batch', async () => {
    const { client, calls } = fakeClient()
    await runIssueOps(client, [
      { kind: 'update', target, before: { a: 1 }, after: { a: 2 } },
      { kind: 'add', target: { ...target, _id: 't1' }, attributes: { tag: 'x' } },
      { kind: 'remove', target: { ...target, _id: 't2' }, attributes: {} }
    ])
    expect(calls.map((c) => c[0])).toEqual(['update', 'add', 'remove'])
    expect(calls[0].slice(1)).toEqual(['cls', 'sp', 'i1', 'p', 'pc', 'subIssues', { a: 2 }])
    // The id of an added document is kept, so that undo can remove it
    expect(calls[1].slice(-1)).toEqual(['t1'])
  })

  it('fails when the batch is rejected', async () => {
    const { client } = fakeClient(false)
    await expect(runIssueOps(client, [{ kind: 'update', target, before: {}, after: {} }])).rejects.toThrow('rejected')
  })
})
