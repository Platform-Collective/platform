// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import { permissionsStore } from '@hcengineering/contact-resources'
import core, { AccountRole, getCurrentAccount, type Doc, type Ref, type Status } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import task from '@hcengineering/task'
import { type Issue } from '@hcengineering/tracker'
import { canChangeDoc } from '@hcengineering/view-resources'
import { get } from 'svelte/store'
import { createDuplicateReference, selectCanceledStatus } from './duplicate-issue-utils'
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
  const issue = doc as Issue
  const client = getClient()
  const [status, canceled] = await Promise.all([
    client.findOne(core.class.Status, { _id: issue.status }),
    findCanceledStatus(issue)
  ])
  return status !== undefined && status.category !== task.statusCategory.Lost && canceled !== undefined
}

async function findCanceledStatus (issue: Issue): Promise<Status | undefined> {
  const client = getClient()
  const [project, taskType] = await Promise.all([
    client.findOne(tracker.class.Project, { _id: issue.space }),
    client.findOne(task.class.TaskType, { _id: issue.kind })
  ])
  if (taskType === undefined || project === undefined || taskType.parent !== project.type) return undefined
  const statuses = await client.findAll(core.class.Status, {
    _id: { $in: taskType.statuses },
    category: task.statusCategory.Lost
  })
  return selectCanceledStatus(taskType, statuses, issue.status, task.statusCategory.Lost)
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

  const [canceled, duplicateStatus, originalStatus, collaborators] = await Promise.all([
    findCanceledStatus(duplicate),
    client.findOne(core.class.Status, { _id: duplicate.status }),
    client.findOne(core.class.Status, { _id: original.status }),
    client.findAll(core.class.Collaborator, { attachedTo: { $in: [duplicateId, originalId] } })
  ])
  if (
    duplicateStatus === undefined ||
    originalStatus === undefined ||
    duplicateStatus.category === task.statusCategory.Lost ||
    originalStatus.category === task.statusCategory.Lost
  ) {
    throw new Error(await translate(tracker.string.MarkDuplicateFailed, {}))
  }
  if (canceled === undefined) {
    throw new Error(await translate(tracker.string.DuplicateNoCanceledStatus, {}))
  }
  const ops = client.apply(duplicateId)
  // The apply is scoped to the duplicate; the matches protect both issues against concurrent edits.
  for (const issue of [duplicate, original]) {
    ops.match(tracker.class.Issue, { _id: issue._id, modifiedOn: issue.modifiedOn })
  }
  if (!(duplicate.relations ?? []).some((relation) => relation._id === originalId)) {
    await updateIssueRelation(ops, duplicate, original, 'relations', '$push')
  }
  if (!(original.relations ?? []).some((relation) => relation._id === duplicateId)) {
    await updateIssueRelation(ops, original, duplicate, 'relations', '$push')
  }
  for (const [issue, message, other] of [
    [duplicate, tracker.string.DuplicateOf, original],
    [original, tracker.string.MarkedAsDuplicateOfThis, duplicate]
  ] as const) {
    await ops.addCollection(activity.class.ActivityInfoMessage, issue.space, issue._id, issue._class, 'activity', {
      message,
      props: { issue: createDuplicateReference(other) }
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
