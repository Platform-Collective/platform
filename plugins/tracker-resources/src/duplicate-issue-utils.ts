// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Markup, Ref, Status, StatusCategory } from '@hcengineering/core'
import type { TaskType } from '@hcengineering/task'
import { jsonToMarkup, type MarkupNode, nodeDoc, nodeParagraph, nodeReference, nodeText } from '@hcengineering/text'

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

/** Placeholder passed as the translated `{issue}` parameter and replaced by an issue reference. */
export const DUPLICATE_ISSUE_PLACEHOLDER = '\u2063issue\u2063'

/**
 * Build a comment from translated text, turning the issue placeholder into a clickable reference.
 * Translated text is stored as text nodes so it cannot inject markup.
 */
export function createDuplicateComment (
  text: string,
  issue: { _id: Ref<Doc>, _class: Ref<Class<Doc>>, identifier: string }
): Markup {
  const content: MarkupNode[] = []
  text.split(DUPLICATE_ISSUE_PLACEHOLDER).forEach((part, index) => {
    if (index > 0) content.push(nodeReference({ id: issue._id, label: issue.identifier, objectclass: issue._class }))
    if (part.length > 0) content.push(nodeText(part))
  })
  return jsonToMarkup(nodeDoc(nodeParagraph(...content)))
}
