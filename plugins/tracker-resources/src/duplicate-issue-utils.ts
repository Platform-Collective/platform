// SPDX-License-Identifier: EPL-2.0

import { createActivityInfoMessageReference } from '@hcengineering/activity'
import {
  matchQuery,
  type Account,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type Hierarchy,
  type PersonId,
  type Ref,
  SortingOrder,
  type Status,
  type StatusCategory
} from '@hcengineering/core'
import type { TaskType } from '@hcengineering/task'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

/** Select a canceled status in task-type order, preserving an already canceled status. */
export function selectCanceledStatus (
  taskType: Pick<TaskType, 'statuses'> | undefined,
  statuses: Status[],
  currentStatus: Ref<Status>,
  canceledCategory: Ref<StatusCategory>
): Status | undefined {
  const byId = new Map(statuses.map((status) => [status._id, status]))
  const canceled = (taskType?.statuses ?? [])
    .map((id) => byId.get(id))
    .filter((status): status is Status => status?.category === canceledCategory)
  return canceled.find((status) => status._id === currentStatus) ?? canceled[0]
}

interface DuplicatePickerScope {
  readonly source: Ref<Issue>
  readonly creators?: PersonId[]
  readonly eligible?: Ref<Issue>[]
}

/** Build the duplicate target query from cached statuses, editable projects and guest eligibility. */
export function createDuplicatePickerQuery (
  statuses: Status[],
  editableProjects: Array<Ref<Project>>,
  canceledCategory: Ref<StatusCategory>,
  scope?: DuplicatePickerScope
): DocumentQuery<Issue> {
  const query: DocumentQuery<Issue> = {
    status: { $in: statuses.filter((status) => status.category !== canceledCategory).map((status) => status._id) },
    space: { $in: editableProjects }
  }
  if (scope !== undefined) {
    const eligible = scope.eligible?.filter((id) => id !== scope.source)
    query._id = eligible === undefined ? { $nin: [scope.source] } : { $in: eligible }
    if (scope.creators !== undefined) query.createdBy = { $in: scope.creators }
  }
  return query
}

// Match the default list limit in ObjectPopup. Both queries use the same order to break timestamp ties.
export const DUPLICATE_PICKER_LIST_OPTIONS: FindOptions<Issue> = {
  limit: 200,
  sort: { modifiedOn: SortingOrder.Descending, _id: SortingOrder.Ascending }
}

export interface DuplicateTargetGuest {
  readonly socialIds: Account['socialIds']
  readonly collaboratorOf: ReadonlySet<Ref<Doc>>
}

/** Apply the base query and guest edit rules to normal and spotlight results. */
export function createDuplicateTargetFilter (
  query: DocumentQuery<Issue>,
  hierarchy: Hierarchy,
  guest?: DuplicateTargetGuest
): (doc: Doc) => boolean {
  return (doc) => {
    if (matchQuery([doc], query, tracker.class.Issue, hierarchy).length === 0) return false
    if (guest === undefined) return true
    return (
      (doc.createdBy !== undefined && Array.isArray(guest.socialIds) && guest.socialIds.includes(doc.createdBy)) ||
      guest.collaboratorOf.has(doc._id)
    )
  }
}

/** Encode an issue reference for use as a parameter in an activity message. */
export function createDuplicateReference (issue: {
  _id: Ref<Doc>
  _class: Ref<Class<Doc>>
  identifier: string
}): string {
  return createActivityInfoMessageReference({ id: issue._id, objectClass: issue._class, label: issue.identifier })
}
