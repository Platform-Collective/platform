// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import { permissionsStore } from '@hcengineering/contact-resources'
import core, { AccountRole, getCurrentAccount, type Doc, type Ref } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import task from '@hcengineering/task'
import { type Issue } from '@hcengineering/tracker'
import { canChangeDoc } from '@hcengineering/view-resources'
import { get } from 'svelte/store'
import { createDuplicateComment, DUPLICATE_ISSUE_PLACEHOLDER, selectCanceledStatus } from './duplicate-issue-utils'
import { updateIssueRelation } from './issues'
import tracker from './plugin'
import { canEditIssue } from './utils'

/** Apply both space permissions and tracker guest edit rules. Also used by the action menu. */
export async function canMarkIssueDuplicate (doc?: Doc | Doc[]): Promise<boolean> {
  if (doc === undefined || Array.isArray(doc)) return false
  if (getCurrentAccount().role === AccountRole.ReadOnlyGuest) return false
  return canChangeDoc(doc._class, doc.space, get(permissionsStore)) && (await canEditIssue(doc as Issue))
}

/** Action visibility: editable issues that are not already in a canceled status category. */
export async function canShowMarkIssueDuplicate (doc?: Doc | Doc[]): Promise<boolean> {
  if (!(await canMarkIssueDuplicate(doc))) return false
  const status = await getClient().findOne(core.class.Status, { _id: (doc as Issue).status })
  return status?.category !== task.statusCategory.Lost
}

/** Link and close a duplicate without moving its existing comments or attachments. */
export async function markIssueDuplicate (duplicateId: Ref<Issue>, originalId: Ref<Issue>): Promise<void> {
  const client = getClient()
  const [duplicate, original] = await Promise.all([
    client.findOne(tracker.class.Issue, { _id: duplicateId }),
    client.findOne(tracker.class.Issue, { _id: originalId })
  ])
  if (duplicate === undefined || original === undefined || duplicateId === originalId) {
    throw new Error(await translate(tracker.string.MarkDuplicateFailed, {}))
  }
  const editable = await Promise.all([canMarkIssueDuplicate(duplicate), canMarkIssueDuplicate(original)])
  if (editable.some((allowed) => !allowed)) {
    throw new Error(await translate(tracker.string.DuplicateEditRequired, {}))
  }

  const [project, taskType, statuses, collaborators] = await Promise.all([
    client.findOne(tracker.class.Project, { _id: duplicate.space }),
    client.findOne(task.class.TaskType, { _id: duplicate.kind }),
    client.findAll(core.class.Status, { category: task.statusCategory.Lost }),
    client.findAll(core.class.Collaborator, { attachedTo: { $in: [duplicateId, originalId] } })
  ])
  const canceled = selectCanceledStatus(
    project !== undefined && taskType?.parent === project.type ? taskType : undefined,
    statuses,
    duplicate.status,
    task.statusCategory.Lost
  )
  if (canceled === undefined) {
    throw new Error(await translate(tracker.string.DuplicateNoCanceledStatus, {}))
  }
  const [duplicateText, originalText] = await Promise.all([
    translate(tracker.string.DuplicateOf, { issue: DUPLICATE_ISSUE_PLACEHOLDER }),
    translate(tracker.string.MarkedAsDuplicateOfThis, { issue: DUPLICATE_ISSUE_PLACEHOLDER })
  ])

  const ops = client.apply(duplicateId)
  // Reject stale selections and concurrent edits rather than overwriting them.
  for (const issue of [duplicate, original]) {
    ops.match(tracker.class.Issue, { _id: issue._id, modifiedOn: issue.modifiedOn })
  }
  if (!(duplicate.relations ?? []).some((relation) => relation._id === originalId)) {
    await updateIssueRelation(ops, duplicate, original, 'relations', '$push')
  }
  if (!(original.relations ?? []).some((relation) => relation._id === duplicateId)) {
    await updateIssueRelation(ops, original, duplicate, 'relations', '$push')
  }
  for (const [issue, text, other] of [
    [duplicate, duplicateText, original],
    [original, originalText, duplicate]
  ] as const) {
    await ops.addCollection(chunter.class.ChatMessage, issue.space, issue._id, issue._class, 'comments', {
      message: createDuplicateComment(text, other)
    })
  }
  await ops.update(duplicate, { status: canceled._id })

  const subscribed = new Set(collaborators.filter((c) => c.attachedTo === originalId).map((c) => c.collaborator))
  for (const collaborator of collaborators.filter((c) => c.attachedTo === duplicateId)) {
    if (subscribed.has(collaborator.collaborator)) continue
    await ops.addCollection(core.class.Collaborator, original.space, original._id, original._class, 'collaborators', {
      collaborator: collaborator.collaborator
    })
    subscribed.add(collaborator.collaborator)
  }
  if (!(await ops.commit()).result) {
    throw new Error(await translate(tracker.string.MarkDuplicateFailed, {}))
  }
}
