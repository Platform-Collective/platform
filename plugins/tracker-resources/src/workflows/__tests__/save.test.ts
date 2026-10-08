//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import { resolveWorkflows, WorkflowKind, type Project, type Workflow } from '@hcengineering/tracker'

import { planWorkflowSave, requestWorkflowRun, workflowsToKick } from '../save'

const PROJECT = 'project-1' as Ref<Project>

function stored (kind: WorkflowKind, props: Partial<Workflow> = {}): Workflow {
  return {
    _id: `wf-${kind}` as Ref<Workflow>,
    _class: 'tracker:class:Workflow' as any,
    space: PROJECT,
    modifiedOn: 0,
    modifiedBy: 'u' as any,
    createdBy: 'u' as any,
    createdOn: 0,
    name: kind,
    enabled: true,
    kind,
    ...props
  }
}

describe('planWorkflowSave', () => {
  const defaults = resolveWorkflows([])
  const byKind = (list: ReturnType<typeof resolveWorkflows>, kind: WorkflowKind): (typeof list)[number] => list.find((w) => w.kind === kind) as any

  it('creates the doc of a workflow that was never stored, with the patch applied to the defaults', () => {
    const add = byKind(defaults, WorkflowKind.ItemAdded)
    expect(planWorkflowSave(add, { enabled: false })).toEqual({
      type: 'create',
      data: { name: 'Item added to project', kind: WorkflowKind.ItemAdded, enabled: false, config: {} }
    })
    const archive = byKind(defaults, WorkflowKind.AutoArchive)
    expect(planWorkflowSave(archive, { enabled: true })).toEqual({
      type: 'create',
      data: { name: 'Auto-archive items', kind: WorkflowKind.AutoArchive, enabled: true, filter: 'is:closed updated:<@today-2w' }
    })
  })

  it('trims and bounds the filter', () => {
    const archive = byKind(defaults, WorkflowKind.AutoArchive)
    const op: any = planWorkflowSave(archive, { filter: `  is:closed  ` })
    expect(op.data.filter).toBe('is:closed')
    const long: any = planWorkflowSave(archive, { filter: 'x'.repeat(5000) })
    expect(long.data.filter).toHaveLength(1000)
  })

  it('does not keep a filter for a workflow that has none', () => {
    const closed = byKind(defaults, WorkflowKind.SetStatusDoneOnClose)
    const op: any = planWorkflowSave(closed, { filter: 'is:closed' })
    expect(op.data.filter).toBeUndefined()
  })

  it('updates only what changed of a stored workflow', () => {
    const list = resolveWorkflows([stored(WorkflowKind.AutoArchive, { enabled: false, filter: 'is:closed' })])
    const archive = byKind(list, WorkflowKind.AutoArchive)
    expect(planWorkflowSave(archive, { enabled: true })).toEqual({ type: 'update', id: 'wf-autoArchive', ops: { enabled: true } })
    expect(planWorkflowSave(archive, { filter: 'is:closed status:Done' })).toEqual({
      type: 'update',
      id: 'wf-autoArchive',
      ops: { filter: 'is:closed status:Done' }
    })
    expect(planWorkflowSave(archive, { enabled: true, filter: 'is:closed status:Done' })).toEqual({
      type: 'update',
      id: 'wf-autoArchive',
      ops: { enabled: true, filter: 'is:closed status:Done' }
    })
  })

  it('writes nothing for a patch that changes nothing', () => {
    const list = resolveWorkflows([stored(WorkflowKind.AutoArchive, { enabled: false, filter: 'is:closed' }), stored(WorkflowKind.ItemAdded)])
    expect(planWorkflowSave(byKind(list, WorkflowKind.AutoArchive), { enabled: false, filter: ' is:closed ' })).toBeUndefined()
    expect(planWorkflowSave(byKind(list, WorkflowKind.ItemAdded), {})).toBeUndefined()
  })

  it('stores a chosen target and tells the default from a choice', () => {
    const list = resolveWorkflows([stored(WorkflowKind.SetStatusDoneOnClose, { config: {} })])
    const closed = byKind(list, WorkflowKind.SetStatusDoneOnClose)
    const target = { target: { field: 'stage', option: 'o-done' } }
    expect(planWorkflowSave(closed, { config: target })).toEqual({ type: 'update', id: 'wf-setStatusDoneOnClose', ops: { config: target } })
    const chosen = byKind(resolveWorkflows([stored(WorkflowKind.SetStatusDoneOnClose, { config: target })]), WorkflowKind.SetStatusDoneOnClose)
    expect(planWorkflowSave(chosen, { config: target })).toBeUndefined()
    // Back to automatic
    expect(planWorkflowSave(chosen, { config: {} })).toEqual({ type: 'update', id: 'wf-setStatusDoneOnClose', ops: { config: {} } })
  })
})

describe('requestWorkflowRun', () => {
  it('asks for the stored, enabled filter workflows only', () => {
    const list = resolveWorkflows([
      stored(WorkflowKind.AutoArchive, { enabled: true, filter: 'is:closed' }),
      stored(WorkflowKind.AutoAddFromQuery, { enabled: false, filter: 'is:closed' }),
      stored(WorkflowKind.ItemAdded)
    ])
    expect(workflowsToKick(list)).toEqual(['wf-autoArchive'])
    expect(workflowsToKick(resolveWorkflows([]))).toEqual([])
  })

  it('touches the workflow once per session and project, and tolerates a refusal', async () => {
    const updates: any[] = []
    const client: any = {
      updateDoc: async (...args: any[]) => {
        updates.push(args)
      }
    }
    const list = resolveWorkflows([stored(WorkflowKind.AutoArchive, { enabled: true, filter: 'is:closed' })])
    await requestWorkflowRun(client, 'p-once' as Ref<Project>, list)
    await requestWorkflowRun(client, 'p-once' as Ref<Project>, list)
    expect(updates).toHaveLength(1)
    expect(updates[0][3]).toEqual({ runRequestedAt: expect.any(Number) })

    const refusing: any = {
      updateDoc: async () => {
        throw new Error('forbidden')
      }
    }
    await expect(requestWorkflowRun(refusing, 'p-refused' as Ref<Project>, list)).resolves.toBeUndefined()
    // Nothing stored: nothing to ask
    await requestWorkflowRun(client, 'p-empty' as Ref<Project>, resolveWorkflows([]))
    expect(updates).toHaveLength(1)
  })
})
