//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { AccountRole } from '@hcengineering/core'
import { IssuePriority, MAX_PROJECT_ITEMS } from '@hcengineering/tracker'

import { addItemAvailability, classifySearchResult, draftValuesFromUpdate } from '../addItem'
import { resolveDraftTarget } from '../target'

describe('addItemAvailability', () => {
  const base = { readonly: false, role: AccountRole.User, canCreate: true, itemCount: 10 }

  it('takes input for somebody who can create issues in a project with room', () => {
    expect(addItemAvailability(base)).toBe('ok')
  })

  it('is read-only for read-only viewers and for those who may not create issues', () => {
    expect(addItemAvailability({ ...base, readonly: true })).toBe('readonly')
    expect(addItemAvailability({ ...base, role: AccountRole.ReadOnlyGuest })).toBe('readonly')
    expect(addItemAvailability({ ...base, canCreate: false })).toBe('readonly')
  })

  it('stops at the item limit', () => {
    expect(addItemAvailability({ ...base, itemCount: MAX_PROJECT_ITEMS - 1 })).toBe('ok')
    expect(addItemAvailability({ ...base, itemCount: MAX_PROJECT_ITEMS })).toBe('limit')
  })

  it('reports read-only before the limit', () => {
    expect(addItemAvailability({ ...base, readonly: true, itemCount: MAX_PROJECT_ITEMS })).toBe('readonly')
  })
})

describe('draftValuesFromUpdate', () => {
  it('has no values for no update', () => {
    expect(draftValuesFromUpdate(undefined)).toEqual({})
    expect(draftValuesFromUpdate({})).toEqual({})
  })

  it('takes what a draft has from the column and the swimlane', () => {
    expect(
      draftValuesFromUpdate({
        status: 'st1',
        priority: IssuePriority.High,
        assignee: null,
        component: 'c1',
        milestone: null,
        customFields: { sprint: 'it1' }
      })
    ).toEqual({
      status: 'st1',
      priority: IssuePriority.High,
      assignee: null,
      component: 'c1',
      milestone: null,
      customFields: { sprint: 'it1' }
    })
  })

  it('ignores everything else', () => {
    expect(draftValuesFromUpdate({ title: 'x', number: 5, isDraft: false, status: 7, priority: 99, customFields: [1] })).toEqual({})
  })

  it('copies the custom fields', () => {
    const custom = { a: 'b' }
    const values = draftValuesFromUpdate({ customFields: custom })
    expect(values.customFields).toEqual(custom)
    expect(values.customFields).not.toBe(custom)
  })
})

describe('classifySearchResult', () => {
  const ctx = (props: Record<string, any> = {}): any => ({
    project: 'p1',
    projectType: 'type1',
    typeOfProject: (p: string) => ({ p1: 'type1', p2: 'type1', p3: 'type2' })[p],
    canEdit: () => true,
    ...props
  })
  const issue = (props: Record<string, any> = {}): any => ({ _id: 'i1', space: 'p1', ...props })

  it('leaves an item of the project alone', () => {
    expect(classifySearchResult(issue(), ctx())).toBe('in-project')
  })

  it('restores an archived item of the project', () => {
    expect(classifySearchResult(issue({ archivedAt: 5 }), ctx())).toBe('restore')
    expect(classifySearchResult(issue({ archivedAt: null }), ctx())).toBe('in-project')
    expect(classifySearchResult(issue({ archivedAt: 5 }), ctx({ canEdit: () => false }))).toBe('not-movable')
  })

  it('moves an issue of another project of the same type', () => {
    expect(classifySearchResult(issue({ space: 'p2' }), ctx())).toBe('move')
  })

  it('does not move across project types, from a closed project, an archived issue or without permission', () => {
    expect(classifySearchResult(issue({ space: 'p3' }), ctx())).toBe('not-movable')
    expect(classifySearchResult(issue({ space: 'gone' }), ctx())).toBe('not-movable')
    expect(classifySearchResult(issue({ space: 'p2', archivedAt: 5 }), ctx())).toBe('not-movable')
    expect(classifySearchResult(issue({ space: 'p2' }), ctx({ canEdit: () => false }))).toBe('not-movable')
  })
})

describe('resolveDraftTarget', () => {
  const project: any = { _id: 'p1', identifier: 'P', type: 'type1' }
  const types: any[] = [
    { _id: 'other', parent: 'type2', statuses: ['x'] },
    { _id: 'epic', parent: 'type1', statuses: ['s1', 's2'] },
    { _id: 'task', parent: 'type1', statuses: ['s3'] }
  ]

  it('takes the first creatable task type and its first status', () => {
    expect(resolveDraftTarget(project, types, (t) => t._id !== 'epic')).toEqual({ project, kind: 'task', status: 's3' })
    expect(resolveDraftTarget(project, types, () => true)).toEqual({ project, kind: 'epic', status: 's1' })
  })

  it('prefers the default status of the project', () => {
    const withDefault = { ...project, defaultIssueStatus: 'sd' }
    expect(resolveDraftTarget(withDefault, types, () => true)?.status).toBe('sd')
  })

  it('finds nothing without a creatable task type or a status', () => {
    expect(resolveDraftTarget(project, types, () => false)).toBeUndefined()
    expect(resolveDraftTarget({ ...project, type: 'type3' }, types, () => true)).toBeUndefined()
    expect(resolveDraftTarget(project, [{ _id: 't', parent: 'type1', statuses: [] } as any], () => true)).toBeUndefined()
  })
})
