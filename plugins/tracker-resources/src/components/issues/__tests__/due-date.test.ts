// SPDX-License-Identifier: EPL-2.0

import type { IdMap, Ref, Status, WithLookup } from '@hcengineering/core'
import task from '@hcengineering/task'
import type { Issue, IssueStatus } from '@hcengineering/tracker'
import { shouldIgnoreIssueOverdue } from '../due-date'

const done = { _id: 'done' as Ref<IssueStatus>, category: task.statusCategory.Won } as unknown as IssueStatus
const canceled = { _id: 'canceled' as Ref<IssueStatus>, category: task.statusCategory.Lost } as unknown as IssueStatus
const active = { _id: 'active' as Ref<IssueStatus>, category: task.statusCategory.Active } as unknown as IssueStatus
const todo = { _id: 'todo' as Ref<IssueStatus>, category: task.statusCategory.ToDo } as unknown as IssueStatus
const backlog = {
  _id: 'backlog' as Ref<IssueStatus>,
  category: task.statusCategory.UnStarted
} as unknown as IssueStatus
const statuses: IdMap<Status> = new Map([done, canceled, active, todo, backlog].map((status) => [status._id, status]))

function issue (status: IssueStatus, lookupStatus?: IssueStatus): WithLookup<Issue> {
  return {
    status: status._id,
    dueDate: Date.UTC(2020, 0, 1),
    $lookup: lookupStatus === undefined ? undefined : { status: lookupStatus }
  } as unknown as WithLookup<Issue>
}

describe('issue due-date overdue suppression', () => {
  it.each([done, canceled])('suppresses a past due date for $_id without a status lookup', (status) => {
    expect(shouldIgnoreIssueOverdue(issue(status), statuses)).toBe(true)
  })

  it.each([active, todo, backlog])('keeps a past due date overdue for $_id without a status lookup', (status) => {
    expect(shouldIgnoreIssueOverdue(issue(status), statuses)).toBe(false)
  })

  it.each([done, canceled])('falls back to the status lookup for $_id while the store is empty', (status) => {
    expect(shouldIgnoreIssueOverdue(issue(status, status), new Map())).toBe(true)
  })

  it('keeps an active issue overdue when only its lookup is available', () => {
    expect(shouldIgnoreIssueOverdue(issue(active, active), new Map())).toBe(false)
  })

  it('keeps an unknown status overdue', () => {
    expect(shouldIgnoreIssueOverdue(issue(done), new Map())).toBe(false)
  })

  it('uses the current status when a completed issue has a stale active lookup', () => {
    expect(shouldIgnoreIssueOverdue(issue(done, active), statuses)).toBe(true)
  })

  it('keeps a reopened issue overdue when its lookup still refers to the completed status', () => {
    expect(shouldIgnoreIssueOverdue(issue(active, done), statuses)).toBe(false)
  })
})
