// SPDX-License-Identifier: EPL-2.0
import core, { type Ref, type Status, type StatusCategory } from '@hcengineering/core'
import task from '@hcengineering/task'
import { stateOfStatus, statusForState } from '../sync/status'

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
