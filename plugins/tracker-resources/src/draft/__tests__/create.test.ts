//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { IssuePriority } from '@hcengineering/tracker'

import { buildDraftIssue, createDraftItem, pickDefaultKind, type DraftTarget } from '../create'

const target = (props: Record<string, any> = {}): DraftTarget =>
  ({
    project: { _id: 'p1', identifier: 'PROJ', type: 'type1', defaultIssueStatus: undefined },
    kind: 'kind1',
    status: 'todo',
    ...props
  }) as any

describe('buildDraftIssue', () => {
  it('makes a draft with number 0, a placeholder identifier and the defaults of the project', () => {
    const doc = buildDraftIssue(target(), 'Think about it')
    expect(doc.isDraft).toBe(true)
    expect(doc.number).toBe(0)
    expect(doc.identifier).toBe('PROJ-Draft')
    expect(doc.title).toBe('Think about it')
    expect(doc.status).toBe('todo')
    expect(doc.kind).toBe('kind1')
    expect(doc.priority).toBe(IssuePriority.NoPriority)
    expect(doc.assignee).toBeNull()
    expect(doc.parents).toEqual([])
    expect(doc.customFields).toBeUndefined()
  })

  it('has no assignee unless one is given, not even the default assignee of the project', () => {
    const withDefault = target({ project: { _id: 'p1', identifier: 'P', type: 't', defaultAssignee: 'emp1' } })
    expect(buildDraftIssue(withDefault, 'a').assignee).toBeNull()
    expect(buildDraftIssue(withDefault, 'a', { assignee: null }).assignee).toBeNull()
    expect(buildDraftIssue(withDefault, 'a', { assignee: 'emp2' as any }).assignee).toBe('emp2')
  })

  it('starts with the values of the column and the lane it is added from', () => {
    const doc = buildDraftIssue(target(), 'a', {
      status: 'doing' as any,
      priority: IssuePriority.High,
      component: 'c1' as any,
      milestone: 'm1' as any,
      customFields: { sprint: 'it1' }
    })
    expect(doc.status).toBe('doing')
    expect(doc.priority).toBe(IssuePriority.High)
    expect(doc.component).toBe('c1')
    expect(doc.milestone).toBe('m1')
    expect(doc.customFields).toEqual({ sprint: 'it1' })
  })

  it('starts with the dates it is given, e.g. the day of a calendar cell', () => {
    const doc = buildDraftIssue(target(), 'a', { startDate: 100, dueDate: 200, deadline: 300 })
    expect(doc.startDate).toBe(100)
    expect(doc.dueDate).toBe(200)
    expect(doc.deadline).toBe(300)
    const plain = buildDraftIssue(target(), 'a')
    expect(plain.startDate).toBeNull()
    expect(plain.dueDate).toBeNull()
    expect('deadline' in plain).toBe(false)
  })

  it('leaves out an empty custom field record', () => {
    expect('customFields' in buildDraftIssue(target(), 'a', { customFields: {} })).toBe(false)
  })
})

describe('createDraftItem', () => {
  it('adds the draft as a top level issue of the project without touching the sequence', async () => {
    const calls: any[][] = []
    const client: any = {
      addCollection: async (...args: any[]) => {
        calls.push(args)
        return args[args.length - 1]
      }
    }
    const id = await createDraftItem(client, target(), 'Idea')
    expect(calls).toHaveLength(1)
    const [, space, attachedTo, , collection, data, createdId] = calls[0]
    expect(space).toBe('p1')
    expect(attachedTo).toBeDefined()
    expect(collection).toBe('subIssues')
    expect(data.isDraft).toBe(true)
    expect(createdId).toBe(id)
    expect(typeof id).toBe('string')
  })
})

describe('pickDefaultKind', () => {
  const types = [
    { _id: 'other', parent: 'type2' },
    { _id: 'epic', parent: 'type1' },
    { _id: 'task', parent: 'type1' }
  ] as any[]

  it('takes the first task type of the project type that can be created', () => {
    expect(pickDefaultKind(types, 'type1' as any, (t) => t._id !== 'epic')).toBe('task')
    expect(pickDefaultKind(types, 'type1' as any, () => true)).toBe('epic')
  })

  it('finds nothing for a project type without a creatable task type', () => {
    expect(pickDefaultKind(types, 'type3' as any, () => true)).toBeUndefined()
    expect(pickDefaultKind(types, 'type1' as any, () => false)).toBeUndefined()
  })
})
