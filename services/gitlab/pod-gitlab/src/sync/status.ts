// SPDX-License-Identifier: EPL-2.0

import type { Ref, Status, StatusCategory } from '@hcengineering/core'
import task from '@hcengineering/task'

export type GitlabIssueState = 'opened' | 'closed'

const OPEN: Array<Ref<StatusCategory>> = [task.statusCategory.UnStarted, task.statusCategory.ToDo, task.statusCategory.Active]
const CLOSED: Array<Ref<StatusCategory>> = [task.statusCategory.Won, task.statusCategory.Lost]

/** GitLab state of a Huly status; undefined for a status outside the given list or category. */
export function stateOfStatus (status: Ref<Status>, statuses: Status[]): GitlabIssueState | undefined {
  const category = statuses.find((it) => it._id === status)?.category
  if (category === undefined) return undefined
  if (CLOSED.includes(category)) return 'closed'
  if (OPEN.includes(category)) return 'opened'
  return undefined
}

function firstOf (statuses: Status[], categories: Array<Ref<StatusCategory>>): Ref<Status> | undefined {
  for (const category of categories) {
    const found = statuses.find((it) => it.category === category)
    if (found !== undefined) return found._id
  }
  return undefined
}

/**
 * Huly status for a GitLab state: a new open issue goes to the backlog, a reopened one to the first Active status,
 * a closed one to the first Won status (GitLab has no "not planned" reason).
 */
export function statusForState (state: GitlabIssueState, reopened: boolean, statuses: Status[]): Ref<Status> {
  const { UnStarted, ToDo, Active, Won } = task.statusCategory
  const result =
    state === 'closed'
      ? firstOf(statuses, [Won])
      : firstOf(statuses, reopened ? [Active, ToDo, UnStarted] : [UnStarted, ToDo, Active])
  if (result === undefined) {
    throw new Error(`No Huly status for GitLab state ${state}`)
  }
  return result
}
