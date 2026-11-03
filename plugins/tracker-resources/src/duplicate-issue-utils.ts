// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref, Status, StatusCategory } from '@hcengineering/core'
import type { TaskType } from '@hcengineering/task'

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

/** Encode an issue reference for use as a parameter in an activity message. */
export function createDuplicateReference (issue: {
  _id: Ref<Doc>
  _class: Ref<Class<Doc>>
  identifier: string
}): string {
  const escape = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  const id = escape(issue._id)
  const objectClass = escape(issue._class)
  const label = escape(issue.identifier)
  return `<span data-type="reference" data-id="${id}" data-objectclass="${objectClass}" data-label="${label}">@${label}</span>`
}
