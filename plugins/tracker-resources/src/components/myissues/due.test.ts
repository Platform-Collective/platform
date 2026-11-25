// SPDX-License-Identifier: EPL-2.0
import type { Employee } from '@hcengineering/contact'
import type { Ref } from '@hcengineering/core'
import task from '@hcengineering/task'
import type { IssueStatus } from '@hcengineering/tracker'
import { getDueQuery, nextDayDelay } from './due'

const employee = 'creator-person' as Ref<Employee>
const statuses = [
  ['backlog', task.statusCategory.UnStarted],
  ['todo', task.statusCategory.ToDo],
  ['active', task.statusCategory.Active]
].map(([_id, category]) => ({ _id, category })) as IssueStatus[]

it('queries the scoped assignee, every open category and all dated issues through the inclusive week end', () => {
  const weekEnd = new Date('2026-03-29T23:59:59.999').getTime()
  expect(getDueQuery(employee, statuses, weekEnd)).toEqual({
    assignee: { $in: [employee] },
    status: { $in: ['backlog', 'todo', 'active'] },
    dueDate: { $exists: true, $ne: null, $lte: weekEnd }
  })
})

it('does not include unassigned issues when no employee is available', () => {
  expect(getDueQuery(null, statuses, 123).assignee).toEqual({ $in: [] })
})

it('uses the current results of the open-status query', () => {
  const changed = statuses.filter((status) => status._id !== 'active')
  expect(getDueQuery(employee, changed, 123).status).toEqual({ $in: ['backlog', 'todo'] })
  expect(getDueQuery(employee, [], 123).status).toEqual({ $in: [] })
})

it.each([
  ['2026-03-29T00:00:00', '2026-03-30T00:00:00'],
  ['2026-10-25T00:00:00', '2026-10-26T00:00:00'],
  ['2026-11-05T23:59:59.999', '2026-11-06T00:00:00']
])('refreshes at the next local midnight starting at %s', (now, midnight) => {
  // Literal local endpoints cover 23/25-hour DST days and the final millisecond.
  expect(nextDayDelay(new Date(now))).toBe(new Date(midnight).getTime() - new Date(now).getTime())
})
