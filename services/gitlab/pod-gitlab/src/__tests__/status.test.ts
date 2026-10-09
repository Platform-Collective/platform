// SPDX-License-Identifier: EPL-2.0
import core, { type Ref, type Status, type StatusCategory } from '@hcengineering/core'
import task from '@hcengineering/task'
import {
  mergeRequestStateOfStatus,
  mergeRequestSyncState,
  stateOfStatus,
  statusForMergeRequestState,
  statusForState
} from '../sync/status'

function status (id: string, category: Ref<StatusCategory>): Status {
  return { _id: id as Ref<Status>, _class: core.class.Status, category, name: id } as unknown as Status
}

const statuses = [
  status('backlog', task.statusCategory.UnStarted),
  status('todo', task.statusCategory.ToDo),
  status('progress', task.statusCategory.Active),
  status('done', task.statusCategory.Won),
  status('canceled', task.statusCategory.Lost)
]

describe('status mapping', () => {
  it('maps open categories to opened and Won/Lost to closed', () => {
    expect(stateOfStatus('backlog' as Ref<Status>, statuses)).toBe('opened')
    expect(stateOfStatus('progress' as Ref<Status>, statuses)).toBe('opened')
    expect(stateOfStatus('done' as Ref<Status>, statuses)).toBe('closed')
    expect(stateOfStatus('canceled' as Ref<Status>, statuses)).toBe('closed')
    expect(stateOfStatus('unknown' as Ref<Status>, statuses)).toBeUndefined()
  })

  it('puts new open issues in the backlog, reopened ones in progress and closed ones in done', () => {
    expect(statusForState('opened', false, statuses)).toBe('backlog')
    expect(statusForState('opened', true, statuses)).toBe('progress')
    expect(statusForState('closed', false, statuses)).toBe('done')
  })

  it('falls back to the next open category when one is missing', () => {
    const noBacklog = statuses.filter((it) => it._id !== 'backlog')
    expect(statusForState('opened', false, noBacklog)).toBe('todo')
  })

  it('throws when the project has no status for the state', () => {
    expect(() => statusForState('closed', false, statuses.slice(0, 3))).toThrow('No Huly status for GitLab state closed')
  })
})

describe('merge request status mapping', () => {
  const mr = [
    status('mr-open', task.statusCategory.Active),
    status('mr-merged', task.statusCategory.Won),
    status('mr-closed', task.statusCategory.Lost)
  ]

  it('treats a locked merge request as open', () => {
    expect(mergeRequestSyncState('locked')).toBe('opened')
    expect(mergeRequestSyncState('merged')).toBe('merged')
  })

  it('maps open categories to opened, Won to merged and Lost to closed', () => {
    expect(mergeRequestStateOfStatus('mr-open' as Ref<Status>, mr)).toBe('opened')
    expect(mergeRequestStateOfStatus('mr-merged' as Ref<Status>, mr)).toBe('merged')
    expect(mergeRequestStateOfStatus('mr-closed' as Ref<Status>, mr)).toBe('closed')
    expect(mergeRequestStateOfStatus('backlog' as Ref<Status>, statuses)).toBe('opened')
    expect(mergeRequestStateOfStatus('unknown' as Ref<Status>, mr)).toBeUndefined()
  })

  it('picks the first status of the matching category', () => {
    expect(statusForMergeRequestState('opened', mr)).toBe('mr-open')
    expect(statusForMergeRequestState('merged', mr)).toBe('mr-merged')
    expect(statusForMergeRequestState('closed', mr)).toBe('mr-closed')
  })

  it('throws when the task type has no status for the state', () => {
    expect(() => statusForMergeRequestState('closed', mr.slice(0, 2))).toThrow('No Huly status for GitLab merge request state closed')
  })
})
