// SPDX-License-Identifier: EPL-2.0
import type { Employee } from '@hcengineering/contact'
import type { DocumentQuery, Ref } from '@hcengineering/core'
import type { Issue, IssueStatus } from '@hcengineering/tracker'

export function getDueQuery (
  employee: Ref<Employee> | null,
  statuses: IssueStatus[],
  weekEnd: number
): DocumentQuery<Issue> {
  return {
    assignee: { $in: employee === null ? [] : [employee] },
    status: { $in: statuses.map(({ _id }) => _id) },
    dueDate: { $exists: true, $ne: null, $lte: weekEnd }
  }
}

/** Calendar arithmetic keeps the refresh at midnight on 23- and 25-hour days. */
export function nextDayDelay (now: Date): number {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return next.getTime() - now.getTime()
}
