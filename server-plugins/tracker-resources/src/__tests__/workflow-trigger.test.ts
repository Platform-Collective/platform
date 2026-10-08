//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { TxFactory, type Ref, type Tx } from '@hcengineering/core'
import task from '@hcengineering/task'
import tracker, {
  MAX_WORKFLOW_ITEMS_PER_RUN,
  ProjectFieldType,
  WorkflowKind,
  type Project
} from '@hcengineering/tracker'

import { OnIssueWorkflow, OnWorkflowEvaluate, WORKFLOW_RUN_INTERVAL_MS } from '../workflow/triggers'
import { makeControl } from './mockControl'

const PROJECT = 'project-1' as Ref<Project>
const OTHER = 'project-2' as Ref<Project>
const DAY = 24 * 60 * 60 * 1000
const user = 'person-1' as any
const userTx = new TxFactory(user)

const statuses = [
  { _id: 'st-todo', _class: tracker.class.IssueStatus, name: 'Todo', category: task.statusCategory.UnStarted },
  { _id: 'st-prog', _class: tracker.class.IssueStatus, name: 'In Progress', category: task.statusCategory.Active },
  { _id: 'st-done', _class: tracker.class.IssueStatus, name: 'Done', category: task.statusCategory.Won },
  { _id: 'st-canceled', _class: tracker.class.IssueStatus, name: 'Canceled', category: task.statusCategory.Lost }
]

const statusField = {
  _id: 'f-status',
  _class: tracker.class.ProjectField,
  space: PROJECT,
  key: 'status',
  label: 'Status',
  type: ProjectFieldType.SingleSelect,
  position: 0,
  options: [
    { value: 'o-todo', label: 'Todo' },
    { value: 'o-prog', label: 'In progress' },
    { value: 'o-done', label: 'Done' }
  ]
}

function workflow (kind: WorkflowKind, props: Record<string, any> = {}, space = PROJECT): any {
  return {
    _id: `wf-${kind}-${space}`,
    _class: tracker.class.Workflow,
    space,
    kind,
    name: kind,
    enabled: true,
    createdOn: 1,
    ...props
  }
}

function issue (id: string, props: Record<string, any> = {}): any {
  return {
    _id: id,
    _class: tracker.class.Issue,
    space: PROJECT,
    status: 'st-todo',
    attachedTo: tracker.ids.NoParent,
    modifiedOn: Date.now(),
    ...props
  }
}

describe('OnIssueWorkflow', () => {
  function createIssueTx (props: Record<string, any> = {}): Tx {
    const tx = userTx.createTxCreateDoc(tracker.class.Issue, PROJECT, { status: 'st-todo', title: 'New', ...props } as any, 'i1' as any)
    tx.modifiedOn = 1000
    return tx
  }
  function statusTx (next: string, at = 3000): Tx {
    const tx = userTx.createTxUpdateDoc(tracker.class.Issue, PROJECT, 'i1' as any, { status: next } as any)
    tx.modifiedOn = at
    return tx
  }

  it('sets the default open value on a new issue', async () => {
    const control = makeControl({ docs: { [tracker.class.ProjectField]: [statusField], [tracker.class.IssueStatus]: statuses } })
    const res: any[] = await OnIssueWorkflow([createIssueTx()], control)
    expect(res).toHaveLength(1)
    expect(res[0].operations).toEqual({ customFields: { status: 'o-todo' } })
    // Authored by the system account, which is what marks it as automation
    expect(res[0].modifiedBy).toBe(core.account.System)
  })

  it('keeps a value the issue was created with', async () => {
    const control = makeControl({ docs: { [tracker.class.ProjectField]: [statusField], [tracker.class.IssueStatus]: statuses } })
    expect(await OnIssueWorkflow([createIssueTx({ customFields: { status: 'o-prog' } })], control)).toEqual([])
  })

  it('sets Done when an issue is closed and does nothing when it was closed already', async () => {
    const history = [createIssueTx(), statusTx('st-done')]
    const docs: Record<string, any[]> = {
      [tracker.class.ProjectField]: [statusField],
      [tracker.class.IssueStatus]: statuses,
      [tracker.class.Issue]: [issue('i1', { status: 'st-done', customFields: { status: 'o-prog' } })],
      [core.class.TxCUD]: history
    }
    const res: any[] = await OnIssueWorkflow([history[1]], makeControl({ docs }))
    expect(res).toHaveLength(1)
    expect(res[0].operations).toEqual({ customFields: { status: 'o-done' } })

    // Repeated: the value is there, nothing is written
    docs[tracker.class.Issue] = [issue('i1', { status: 'st-done', customFields: { status: 'o-done' } })]
    expect(await OnIssueWorkflow([history[1]], makeControl({ docs }))).toEqual([])
  })

  it('does not act on a move between closed statuses', async () => {
    const history = [createIssueTx({ status: 'st-done' }), statusTx('st-canceled')]
    const docs = {
      [tracker.class.ProjectField]: [statusField],
      [tracker.class.IssueStatus]: statuses,
      [tracker.class.Issue]: [issue('i1', { status: 'st-canceled', customFields: { status: 'o-prog' } })],
      [core.class.TxCUD]: history
    }
    expect(await OnIssueWorkflow([history[1]], makeControl({ docs }))).toEqual([])
  })

  it('sets the open value when a closed issue is reopened', async () => {
    const history = [createIssueTx({ status: 'st-done' }), statusTx('st-prog')]
    const docs = {
      [tracker.class.ProjectField]: [statusField],
      [tracker.class.IssueStatus]: statuses,
      [tracker.class.Issue]: [issue('i1', { status: 'st-prog', customFields: { status: 'o-done' } })],
      [core.class.TxCUD]: history
    }
    const res: any[] = await OnIssueWorkflow([history[1]], makeControl({ docs }))
    expect(res[0].operations).toEqual({ customFields: { status: 'o-todo' } })
  })

  it('does not act on a move between open statuses', async () => {
    const history = [createIssueTx(), statusTx('st-prog')]
    const docs = {
      [tracker.class.ProjectField]: [statusField],
      [tracker.class.IssueStatus]: statuses,
      [tracker.class.Issue]: [issue('i1', { status: 'st-prog', customFields: { status: 'o-done' } })],
      [core.class.TxCUD]: history
    }
    expect(await OnIssueWorkflow([history[1]], makeControl({ docs }))).toEqual([])
  })

  it('never reacts to a change made by the automation (loop protection)', async () => {
    const sys = new TxFactory(core.account.System, true)
    const tx = sys.createTxUpdateDoc(tracker.class.Issue, PROJECT, 'i1' as any, { status: 'st-done' } as any)
    const docs = {
      [tracker.class.ProjectField]: [statusField],
      [tracker.class.IssueStatus]: statuses,
      [tracker.class.Issue]: [issue('i1', { status: 'st-done' })],
      [core.class.TxCUD]: [tx]
    }
    expect(await OnIssueWorkflow([tx], makeControl({ docs }))).toEqual([])
    const created = sys.createTxCreateDoc(tracker.class.Issue, PROJECT, { status: 'st-todo' } as any)
    expect(await OnIssueWorkflow([created], makeControl({ docs }))).toEqual([])
  })

  it('respects a disabled workflow, a missing field and a configured target', async () => {
    const base = { [tracker.class.IssueStatus]: statuses }
    const off = workflow(WorkflowKind.ItemAdded, { enabled: false })
    expect(
      await OnIssueWorkflow(
        [createIssueTx()],
        makeControl({ docs: { ...base, [tracker.class.ProjectField]: [statusField], [tracker.class.Workflow]: [off] } })
      )
    ).toEqual([])
    expect(await OnIssueWorkflow([createIssueTx()], makeControl({ docs: { ...base, [tracker.class.ProjectField]: [] } }))).toEqual([])

    const stage = { ...statusField, _id: 'f-stage', key: 'stage', label: 'Stage' }
    const target = workflow(WorkflowKind.ItemAdded, { config: { target: { field: 'stage', option: 'o-prog' } } })
    const res: any[] = await OnIssueWorkflow(
      [createIssueTx()],
      makeControl({ docs: { ...base, [tracker.class.ProjectField]: [statusField, stage], [tracker.class.Workflow]: [target] } })
    )
    expect(res[0].operations).toEqual({ customFields: { stage: 'o-prog' } })
  })

  it('ignores updates that do not change the status and other classes', async () => {
    const control = makeControl({ docs: { [tracker.class.ProjectField]: [statusField], [tracker.class.IssueStatus]: statuses } })
    const title = userTx.createTxUpdateDoc(tracker.class.Issue, PROJECT, 'i1' as any, { title: 'x' } as any)
    expect(await OnIssueWorkflow([title], control)).toEqual([])
    const other = userTx.createTxUpdateDoc(tracker.class.Milestone, PROJECT, 'm1' as any, { status: 'x' } as any)
    expect(await OnIssueWorkflow([other], control)).toEqual([])
  })
})

describe('OnWorkflowEvaluate', () => {
  const NOW = Date.now()
  const workflowTx = (space = PROJECT): Tx => userTx.createTxUpdateDoc(tracker.class.Workflow, space, 'wf' as any, { enabled: true } as any)
  const issueTx = (space = PROJECT): Tx => userTx.createTxUpdateDoc(tracker.class.Issue, space, 'i1' as any, { title: 'x' } as any)
  const archiveWorkflow = (props: Record<string, any> = {}): any => workflow(WorkflowKind.AutoArchive, props)

  function docsOf (issues: any[], workflows: any[], extra: Record<string, any[]> = {}): Record<string, any[]> {
    return {
      [tracker.class.IssueStatus]: statuses,
      [tracker.class.Issue]: issues,
      [tracker.class.Workflow]: workflows,
      ...extra
    }
  }

  const old = (id: string, props: Record<string, any> = {}): any => issue(id, { modifiedOn: NOW - 30 * DAY, status: 'st-done', ...props })

  it('archives the closed issues that were not touched for two weeks, nothing else', async () => {
    const issues = [
      old('closed-old'),
      old('canceled-old', { status: 'st-canceled' }),
      issue('closed-new', { status: 'st-done', modifiedOn: NOW - DAY }),
      old('open-old', { status: 'st-prog' }),
      old('archived-already', { archivedAt: NOW - DAY }),
      old('other-project', { space: OTHER })
    ]
    const res: any[] = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs: docsOf(issues, [archiveWorkflow({ filter: 'is:closed updated:<@today-2w' })]) }))
    expect(res.map((r) => r.objectId).sort()).toEqual(['canceled-old', 'closed-old'])
    for (const tx of res) {
      expect(tx.operations.archivedAt).toBeGreaterThan(0)
      expect(tx.modifiedBy).toBe(core.account.System)
      expect(tx.objectSpace).toBe(PROJECT)
    }
  })

  it('uses the default filter of a project that never changed the workflow only once it is switched on', async () => {
    // A stored, enabled workflow without a filter text of its own has the empty filter: it does nothing
    const res = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs: docsOf([old('a')], [archiveWorkflow({ filter: '' })]) }))
    expect(res).toEqual([])
    // Not stored at all: disabled by default
    expect(await OnWorkflowEvaluate([workflowTx()], makeControl({ docs: docsOf([old('a')], []) }))).toEqual([])
  })

  it('is idempotent: a second run over the result archives nothing', async () => {
    const issues = [old('a'), old('b')]
    const docs = docsOf(issues, [archiveWorkflow({ filter: 'is:closed' })])
    const first: any[] = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs }))
    expect(first).toHaveLength(2)
    for (const tx of first) Object.assign(issues.find((i) => i._id === tx.objectId), tx.operations)
    expect(await OnWorkflowEvaluate([workflowTx()], makeControl({ docs }))).toEqual([])
  })

  it('archives at most the cap per run, oldest first, and finishes over several runs', async () => {
    const issues = Array.from({ length: 250 }, (_, i) => old(`i${String(i).padStart(3, '0')}`, { modifiedOn: NOW - (400 - i) * DAY }))
    const docs = docsOf(issues, [archiveWorkflow({ filter: 'is:closed' })])
    let runs = 0
    let total = 0
    for (;;) {
      const res: any[] = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs }))
      if (res.length === 0 || runs > 5) break
      runs++
      expect(res.length).toBeLessThanOrEqual(MAX_WORKFLOW_ITEMS_PER_RUN)
      if (runs === 1) expect(res.map((r) => r.objectId)).toEqual(issues.slice(0, MAX_WORKFLOW_ITEMS_PER_RUN).map((i) => i._id))
      total += res.length
      for (const tx of res) Object.assign(issues.find((i) => i._id === tx.objectId), tx.operations)
    }
    expect(runs).toBe(3)
    expect(total).toBe(250)
  })

  it('skips a filter that does not parse, asks for archived items or is empty', async () => {
    for (const filter of ['bogus-field:x', 'is:archived', '   ', '(is:closed']) {
      const res = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs: docsOf([old('a')], [archiveWorkflow({ filter })]) }))
      expect(res).toEqual([])
    }
  })

  it('evaluates what the database could not take on the client', async () => {
    const issues = [old('a', { customFields: { size: 'o-l' } }), old('b', { customFields: { size: 'o-s' } })]
    const size = {
      _id: 'f-size',
      _class: tracker.class.ProjectField,
      space: PROJECT,
      key: 'size',
      label: 'Size',
      type: ProjectFieldType.SingleSelect,
      position: 1,
      options: [
        { value: 'o-s', label: 'S' },
        { value: 'o-l', label: 'L' }
      ]
    }
    const docs = docsOf(issues, [archiveWorkflow({ filter: 'is:closed size:L' })], { [tracker.class.ProjectField]: [size] })
    const res: any[] = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs }))
    expect(res.map((r) => r.objectId)).toEqual(['a'])
  })

  it('names priorities in English', async () => {
    const issues = [old('a', { priority: 1 }), old('b', { priority: 4 })]
    const res: any[] = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs: docsOf(issues, [archiveWorkflow({ filter: 'priority:urgent' })]) }))
    expect(res.map((r) => r.objectId)).toEqual(['a'])
  })

  it('restores archived issues that match the auto-add filter, but not those the archive filter would take again', async () => {
    const issues = [
      old('keep-archived', { archivedAt: NOW - DAY }),
      old('back', { archivedAt: NOW - DAY, status: 'st-prog', priority: 1 }),
      old('back-too', { archivedAt: NOW - DAY, status: 'st-done', priority: 1, modifiedOn: NOW - DAY }),
      old('not-matching', { archivedAt: NOW - DAY, priority: 3 }),
      old('active', { priority: 1 })
    ]
    issues[0].priority = 1 // matches the add filter, and is closed and old: archive wins
    const workflows = [
      archiveWorkflow({ filter: 'is:closed updated:<@today-2w' }),
      workflow(WorkflowKind.AutoAddFromQuery, { filter: 'priority:urgent' })
    ]
    const res: any[] = await OnWorkflowEvaluate([workflowTx()], makeControl({ docs: docsOf(issues, workflows) }))
    const restored = res.filter((r) => r.operations.archivedAt === null).map((r) => r.objectId).sort()
    const archived = res.filter((r) => r.operations.archivedAt !== null).map((r) => r.objectId)
    expect(restored).toEqual(['back', 'back-too'])
    // The active closed old issues of the project are archived; 'active' matches the archive filter
    expect(archived).toEqual(['active'])
    // Nothing is both archived and restored
    expect(new Set([...restored, ...archived]).size).toBe(restored.length + archived.length)
  })

  it('does nothing for a project without enabled filter workflows', async () => {
    const calls: any[] = []
    const res = await OnWorkflowEvaluate(
      [workflowTx()],
      makeControl({
        docs: docsOf([old('a')], [archiveWorkflow({ filter: 'is:closed', enabled: false }), workflow(WorkflowKind.ItemAdded)]),
        calls
      })
    )
    expect(res).toEqual([])
    expect(calls.filter((c) => c._class === tracker.class.Issue)).toEqual([])
  })

  it('never reacts to a change made by the automation (loop protection)', async () => {
    const sys = new TxFactory(core.account.System, true)
    const own = sys.createTxUpdateDoc(tracker.class.Issue, PROJECT, 'i1' as any, { archivedAt: NOW } as any)
    const own2 = sys.createTxUpdateDoc(tracker.class.Workflow, PROJECT, 'wf' as any, { enabled: true } as any)
    const docs = docsOf([old('a')], [archiveWorkflow({ filter: 'is:closed' })])
    expect(await OnWorkflowEvaluate([own, own2], makeControl({ docs }))).toEqual([])
  })

  it('evaluates after issue changes at most once per interval, a workflow change always', async () => {
    const cache = new Map<string, any>()
    const docs = docsOf([old('a')], [archiveWorkflow({ filter: 'is:closed' })])
    const first = await OnWorkflowEvaluate([issueTx()], makeControl({ docs, cache }))
    expect(first).toHaveLength(1)
    // Within the interval: skipped
    expect(await OnWorkflowEvaluate([issueTx()], makeControl({ docs, cache }))).toEqual([])
    // A workflow change forces it
    expect(await OnWorkflowEvaluate([workflowTx()], makeControl({ docs, cache }))).toHaveLength(1)
    // After the interval it runs again
    cache.set(`tracker:workflow:last-run:${PROJECT}`, Date.now() - WORKFLOW_RUN_INTERVAL_MS - 1)
    expect(await OnWorkflowEvaluate([issueTx()], makeControl({ docs, cache }))).toHaveLength(1)
  })

  it('keeps one failing project from stopping the others', async () => {
    const issues = [old('a'), old('b', { space: OTHER })]
    const docs = docsOf(issues, [archiveWorkflow({ filter: 'is:closed' }), workflow(WorkflowKind.AutoArchive, { filter: 'is:closed' }, OTHER)])
    const control = makeControl({ docs })
    const findAll = control.findAll
    control.findAll = async (ctx: unknown, cls: string, query: any, options: any) => {
      if (cls === tracker.class.Workflow && query.space === PROJECT) throw new Error('boom')
      return await findAll(ctx, cls, query, options)
    }
    const res: any[] = await OnWorkflowEvaluate([workflowTx(PROJECT), workflowTx(OTHER)], control)
    expect(res.map((r) => r.objectId)).toEqual(['b'])
  })

  it('ignores transactions of other documents', async () => {
    const other = userTx.createTxUpdateDoc(tracker.class.Milestone, PROJECT, 'm' as any, { label: 'x' } as any)
    const calls: any[] = []
    expect(await OnWorkflowEvaluate([other], makeControl({ docs: docsOf([old('a')], [archiveWorkflow({ filter: 'is:closed' })]), calls }))).toEqual([])
    expect(calls).toEqual([])
  })
})
