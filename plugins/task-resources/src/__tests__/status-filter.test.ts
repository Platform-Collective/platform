// SPDX-License-Identifier: EPL-2.0

import type { IdMap, Ref, Status } from '@hcengineering/core'
import { getTaskTypeStatuses } from '../components/status-filter'

describe('getTaskTypeStatuses', () => {
  const missingIds = ['missing-a', 'missing-b', 'missing-c'] as Ref<Status>[]
  const todo = { _id: 'todo', name: 'Todo' } as unknown as Status
  const done = { _id: 'done', name: 'Done' } as unknown as Status

  it('omits three dangling status IDs instead of producing placeholder rows', () => {
    expect(getTaskTypeStatuses(missingIds, new Map())).toStrictEqual([])
  })

  it('keeps resolved statuses in task-type order while omitting missing ones', () => {
    const statuses: IdMap<Status> = new Map([
      [todo._id, todo],
      [done._id, done]
    ])

    const statusIds = [missingIds[0], done._id, missingIds[1], todo._id, missingIds[2]]

    expect(getTaskTypeStatuses(statusIds, statuses)).toStrictEqual([done, todo])
  })

  it('does not offer statuses outside the task type', () => {
    expect(getTaskTypeStatuses([todo._id], new Map([[done._id, done]]))).toStrictEqual([])
  })

  it('returns no options for a task type with no statuses', () => {
    expect(getTaskTypeStatuses([], new Map([[todo._id, todo]]))).toStrictEqual([])
  })

  it('returns resolved options once an initially empty status store is populated', () => {
    const statuses: IdMap<Status> = new Map()
    const statusIds = [todo._id, ...missingIds]

    expect(getTaskTypeStatuses(statusIds, statuses)).toStrictEqual([])

    statuses.set(todo._id, todo)

    expect(getTaskTypeStatuses(statusIds, statuses)).toStrictEqual([todo])
  })
})
