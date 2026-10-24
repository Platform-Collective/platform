// SPDX-License-Identifier: EPL-2.0

import type { IdMap, Status, WithLookup } from '@hcengineering/core'
import task from '@hcengineering/task'
import type { Issue } from '@hcengineering/tracker'

/** Returns whether a completed issue should suppress overdue due-date styling. */
export function shouldIgnoreIssueOverdue (value: WithLookup<Issue>, statuses: IdMap<Status>): boolean {
  const category = statuses.get(value.status)?.category ?? value.$lookup?.status?.category
  return category === task.statusCategory.Won || category === task.statusCategory.Lost
}
