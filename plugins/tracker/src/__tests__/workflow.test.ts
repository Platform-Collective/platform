//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import type { Project } from '../index'
import { ProjectFieldType, type ProjectField } from '../projectField'
import {
  DEFAULT_AUTO_ARCHIVE_FILTER,
  fieldWorkflowApplies,
  isAutomationAuthor,
  isWorkflowFilterUsable,
  MAX_WORKFLOW_ITEMS_PER_RUN,
  planFieldWorkflow,
  planIssueWorkflows,
  resolveFieldTarget,
  resolveWorkflows,
  restoreCandidates,
  selectWorkflowItems,
  statusTransition,
  validateWorkflow,
  WorkflowKind,
  type EffectiveWorkflow,
  type Workflow
} from '../workflow'

const SPACE = 'project-1' as Ref<Project>

function doc (kind: WorkflowKind, props: Partial<Workflow> = {}): Workflow {
  return {
    _id: `wf-${kind}-${props.createdOn ?? 0}` as any,
    _class: 'tracker:class:Workflow' as any,
    space: SPACE,
    modifiedOn: 0,
    modifiedBy: 'u' as any,
    createdBy: 'u' as any,
    createdOn: 0,
    name: 'x',
    enabled: true,
    kind,
    ...props
  }
}

const statusField = {
  key: 'status',
  label: 'Status',
  type: ProjectFieldType.SingleSelect,
  position: 0,
  options: [
    { value: 'o-todo', label: 'Todo' },
    { value: 'o-prog', label: 'In progress' },
    { value: 'o-done', label: 'Done' }
  ]
} as unknown as ProjectField

const closed = new Set(['st-done', 'st-canceled'])

describe('resolveWorkflows', () => {
  it('lists every kind with the defaults of a project that never changed one', () => {
    const list = resolveWorkflows([])
    expect(list.map((w) => w.kind)).toEqual([
      WorkflowKind.SetStatusDoneOnClose,
      WorkflowKind.ItemReopened,
      WorkflowKind.ItemAdded,
      WorkflowKind.AutoArchive,
      WorkflowKind.AutoAddFromQuery
    ])
    expect(list.map((w) => w.enabled)).toEqual([true, true, true, false, false])
    expect(list[3].filter).toBe(DEFAULT_AUTO_ARCHIVE_FILTER)
    expect(list[4].filter).toBe('')
    expect(list.every((w) => w.doc === undefined)).toBe(true)
  })

  it('uses the stored doc of a kind', () => {
    const stored = doc(WorkflowKind.AutoArchive, { enabled: true, filter: 'is:closed', name: 'Mine' })
    const archive = resolveWorkflows([stored])[3]
    expect(archive).toMatchObject({ enabled: true, filter: 'is:closed', name: 'Mine', doc: stored })
  })

  it('lets the oldest doc of a kind win, and ignores unknown kinds', () => {
    const older = doc(WorkflowKind.ItemAdded, { createdOn: 1, enabled: false })
    const newer = doc(WorkflowKind.ItemAdded, { createdOn: 2, enabled: true })
    const unknown = doc('weird' as WorkflowKind)
    expect(resolveWorkflows([newer, unknown, older])[2].enabled).toBe(false)
    expect(resolveWorkflows([older, newer])[2].doc).toBe(older)
  })
})

describe('resolveFieldTarget', () => {
  it('finds the Status field and the option of the kind', () => {
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, undefined, [statusField])?.option.value).toBe('o-done')
    expect(resolveFieldTarget(WorkflowKind.ItemReopened, {}, [statusField])?.option.value).toBe('o-todo')
    expect(resolveFieldTarget(WorkflowKind.ItemAdded, {}, [statusField])?.option.value).toBe('o-todo')
  })

  it('does nothing without a Status single select with the option', () => {
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, undefined, [])).toBeUndefined()
    const text = { ...statusField, type: ProjectFieldType.Text } as ProjectField
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, undefined, [text])).toBeUndefined()
    const noDone = { ...statusField, options: [{ value: 'o-todo', label: 'Todo' }] } as ProjectField
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, undefined, [noDone])).toBeUndefined()
    const other = { ...statusField, label: 'Stage' } as ProjectField
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, undefined, [other])).toBeUndefined()
  })

  it('uses a configured target and never falls back when it is gone', () => {
    const stage = { ...statusField, key: 'stage', label: 'Stage' } as ProjectField
    const config = { target: { field: 'stage', option: 'o-prog' } }
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, config, [statusField, stage])?.option.value).toBe('o-prog')
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, { target: { field: 'gone', option: 'o-done' } }, [statusField])).toBeUndefined()
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, { target: { field: 'status', option: 'gone' } }, [statusField])).toBeUndefined()
  })

  it('prefers the first Status field by position', () => {
    const second = { ...statusField, key: 'status2', position: 5 } as ProjectField
    const first = { ...statusField, key: 'status1', position: 1 } as ProjectField
    expect(resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, undefined, [second, first])?.field.key).toBe('status1')
  })
})

describe('statusTransition', () => {
  it('detects closing and reopening', () => {
    expect(statusTransition('st-todo', 'st-done', closed)).toBe('closed')
    expect(statusTransition(undefined, 'st-canceled', closed)).toBe('closed')
    expect(statusTransition('st-done', 'st-todo', closed)).toBe('reopened')
    expect(statusTransition('st-todo', 'st-progress', closed)).toBe('none')
    expect(statusTransition('st-done', 'st-canceled', closed)).toBe('none')
    expect(statusTransition(undefined, 'st-progress', closed)).toBe('none')
  })
})

describe('fieldWorkflowApplies', () => {
  it('maps changes to workflows', () => {
    const toDone = { type: 'status', prev: 'st-todo', next: 'st-done' } as const
    const reopen = { type: 'status', prev: 'st-done', next: 'st-todo' } as const
    expect(fieldWorkflowApplies(WorkflowKind.SetStatusDoneOnClose, toDone, closed)).toBe(true)
    expect(fieldWorkflowApplies(WorkflowKind.ItemReopened, toDone, closed)).toBe(false)
    expect(fieldWorkflowApplies(WorkflowKind.ItemReopened, reopen, closed)).toBe(true)
    expect(fieldWorkflowApplies(WorkflowKind.ItemAdded, toDone, closed)).toBe(false)
    expect(fieldWorkflowApplies(WorkflowKind.ItemAdded, { type: 'created' }, closed)).toBe(true)
    expect(fieldWorkflowApplies(WorkflowKind.SetStatusDoneOnClose, { type: 'created' }, closed)).toBe(false)
  })
})

describe('planFieldWorkflow (idempotency)', () => {
  const target = resolveFieldTarget(WorkflowKind.SetStatusDoneOnClose, undefined, [statusField])
  if (target === undefined) throw new Error('target')

  it('writes the value once', () => {
    const first = planFieldWorkflow(WorkflowKind.SetStatusDoneOnClose, { other: 1 }, target)
    expect(first).toEqual({ other: 1, status: 'o-done' })
    expect(planFieldWorkflow(WorkflowKind.SetStatusDoneOnClose, first, target)).toBeUndefined()
  })

  it('does not modify its input', () => {
    const input = { a: 1 }
    planFieldWorkflow(WorkflowKind.SetStatusDoneOnClose, input, target)
    expect(input).toEqual({ a: 1 })
  })

  it('"item added" only fills an empty value', () => {
    expect(planFieldWorkflow(WorkflowKind.ItemAdded, undefined, target)).toEqual({ status: 'o-done' })
    expect(planFieldWorkflow(WorkflowKind.ItemAdded, { status: null }, target)).toEqual({ status: 'o-done' })
    expect(planFieldWorkflow(WorkflowKind.ItemAdded, { status: 'o-prog' }, target)).toBeUndefined()
  })
})

describe('planIssueWorkflows', () => {
  const workflows = resolveWorkflows([])
  const fields = [statusField]

  it('sets Done when an item is closed', () => {
    const res = planIssueWorkflows(workflows, { type: 'status', prev: 'st-todo', next: 'st-done' }, { customFields: { status: 'o-prog' } }, closed, fields)
    expect(res).toEqual({ status: 'o-done' })
  })

  it('sets the default open value when an item is reopened and when it is added', () => {
    expect(
      planIssueWorkflows(workflows, { type: 'status', prev: 'st-done', next: 'st-progress' }, { customFields: { status: 'o-done' } }, closed, fields)
    ).toEqual({ status: 'o-todo' })
    expect(planIssueWorkflows(workflows, { type: 'created' }, {}, closed, fields)).toEqual({ status: 'o-todo' })
  })

  it('does nothing when a workflow is disabled, has no target or nothing changes', () => {
    const off = workflows.map((w) => ({ ...w, enabled: false }))
    expect(planIssueWorkflows(off, { type: 'created' }, {}, closed, fields)).toBeUndefined()
    expect(planIssueWorkflows(workflows, { type: 'created' }, {}, closed, [])).toBeUndefined()
    expect(planIssueWorkflows(workflows, { type: 'status', prev: 'st-todo', next: 'st-done' }, { customFields: { status: 'o-done' } }, closed, fields)).toBeUndefined()
    expect(planIssueWorkflows(workflows, { type: 'status', prev: 'st-todo', next: 'st-progress' }, {}, closed, fields)).toBeUndefined()
  })

  it('ignores the filter workflows', () => {
    const filterOnly: EffectiveWorkflow[] = [{ kind: WorkflowKind.AutoArchive, name: 'a', enabled: true, filter: 'is:closed', config: {} }]
    expect(planIssueWorkflows(filterOnly, { type: 'created' }, {}, closed, fields)).toBeUndefined()
  })
})

describe('selectWorkflowItems (caps)', () => {
  const items = Array.from({ length: 250 }, (_, i) => ({ _id: `i${i}`, n: i }))

  it('takes the first matches up to the cap', () => {
    expect(selectWorkflowItems(items, () => true)).toHaveLength(MAX_WORKFLOW_ITEMS_PER_RUN)
    expect(selectWorkflowItems(items, (i) => i.n % 2 === 0, { cap: 3 }).map((i) => i._id)).toEqual(['i0', 'i2', 'i4'])
  })

  it('never exceeds the global cap, whatever is asked', () => {
    expect(selectWorkflowItems(items, () => true, { cap: 10_000 })).toHaveLength(MAX_WORKFLOW_ITEMS_PER_RUN)
    expect(selectWorkflowItems(items, () => true, { cap: 0 })).toEqual([])
    expect(selectWorkflowItems(items, () => true, { cap: -5 })).toEqual([])
  })

  it('takes an id once and leaves excluded ids alone', () => {
    const dup = [{ _id: 'a' }, { _id: 'a' }, { _id: 'b' }, { _id: 'c' }]
    expect(selectWorkflowItems(dup, () => true).map((i) => i._id)).toEqual(['a', 'b', 'c'])
    expect(selectWorkflowItems(dup, () => true, { exclude: new Set(['b']) }).map((i) => i._id)).toEqual(['a', 'c'])
  })

  it('works the backlog off in order over several runs', () => {
    let rest = items
    let runs = 0
    while (rest.length > 0 && runs < 10) {
      const taken = new Set(selectWorkflowItems(rest, () => true).map((i) => i._id))
      rest = rest.filter((i) => !taken.has(i._id))
      runs++
    }
    expect(runs).toBe(3)
    expect(rest).toEqual([])
  })

  it('does not modify its input', () => {
    const copy = [...items]
    selectWorkflowItems(items, () => true)
    expect(items).toEqual(copy)
  })
})

describe('restoreCandidates', () => {
  it('leaves out what the archive filter would archive again', () => {
    const archived = [{ _id: 'a', closed: true }, { _id: 'b', closed: false }, { _id: 'c', closed: false }]
    const res = restoreCandidates(archived, () => true, (i) => i.closed)
    expect(res.map((i) => i._id)).toEqual(['b', 'c'])
    expect(restoreCandidates(archived, (i) => i._id === 'c', undefined).map((i) => i._id)).toEqual(['c'])
  })
})

describe('automation marker', () => {
  it('recognises the system author only', () => {
    expect(isAutomationAuthor('sys', 'sys')).toBe(true)
    expect(isAutomationAuthor('person-1', 'sys')).toBe(false)
    expect(isAutomationAuthor(undefined, 'sys')).toBe(false)
  })
})

describe('filter validation', () => {
  it('needs a usable filter', () => {
    expect(isWorkflowFilterUsable(undefined)).toBe(false)
    expect(isWorkflowFilterUsable('   ')).toBe(false)
    expect(isWorkflowFilterUsable('is:closed')).toBe(true)
    expect(isWorkflowFilterUsable('x'.repeat(1001))).toBe(false)
  })

  it('validates what can be enabled', () => {
    const [done, , , archive] = resolveWorkflows([])
    expect(validateWorkflow(done, [statusField])).toBeUndefined()
    expect(validateWorkflow({ ...archive, filter: '' }, [])).toBe('filterRequired')
    expect(validateWorkflow({ ...archive, filter: 'x'.repeat(1001) }, [])).toBe('filterTooLong')
    expect(validateWorkflow(archive, [])).toBeUndefined()
    expect(validateWorkflow({ ...done, config: { target: { field: 'gone', option: 'x' } } }, [statusField])).toBe('targetMissing')
  })
})
