// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import core, { type AttachedData, type Ref, SortingOrder, type TxOperations } from '@hcengineering/core'
import { calcRank } from '@hcengineering/task'
import tracker, { type Issue, IssuePriority, type Project } from '@hcengineering/tracker'
import type { GitlabUserRef } from '../gitlab/types'
import type { PersonMapping } from './persons'

export interface IssueNumber {
  number: number
  rank: string
  identifier: string
}

/** Number, rank (after the last task) and identifier of a new task in `project`. */
export async function allocateIssueNumber (
  client: TxOperations,
  project: Pick<Project, '_id' | 'identifier'>
): Promise<IssueNumber> {
  const lastOne = await client.findOne(
    tracker.class.Issue,
    { space: project._id },
    { sort: { rank: SortingOrder.Descending } }
  )
  const incResult = await client.updateDoc(
    tracker.class.Project,
    core.space.Space,
    project._id,
    { $inc: { sequence: 1 } },
    true
  )
  const number = (incResult as unknown as { object: { sequence: number } }).object.sequence
  return { number, rank: calcRank(lastOne, undefined), identifier: `${project.identifier}-${number}` }
}

export type EmptyIssueFields = Pick<
AttachedData<Issue>,
| 'component'
| 'milestone'
| 'priority'
| 'comments'
| 'subIssues'
| 'startDate'
| 'dueDate'
| 'parents'
| 'reportedTime'
| 'remainingTime'
| 'estimation'
| 'reports'
| 'relations'
| 'childInfo'
>

/** The issue fields GitLab has no counterpart for. */
export function emptyIssueFields (): EmptyIssueFields {
  return {
    component: null,
    milestone: null,
    priority: IssuePriority.NoPriority,
    comments: 0,
    subIssues: 0,
    startDate: null,
    dueDate: null,
    parents: [],
    reportedTime: 0,
    remainingTime: 0,
    estimation: 0,
    reports: 0,
    relations: [],
    childInfo: []
  }
}

/** GitLab `assignee_ids` for a Huly assignee change; undefined when nothing is to be pushed. */
export async function assigneeIdsFor (
  persons: PersonMapping,
  host: string,
  assignee: Ref<Person> | null,
  current: GitlabUserRef[]
): Promise<number[] | undefined> {
  if (assignee === null) return current.length > 0 ? [0] : undefined
  // A person without a GitLab identity on this host is kept in Huly only
  const id = await persons.gitlabUserIdFor(assignee, host)
  return id !== undefined && current[0]?.id !== id ? [id] : undefined
}
