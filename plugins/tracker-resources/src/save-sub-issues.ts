// SPDX-License-Identifier: EPL-2.0

import core, { makeCollabId, RateLimiter } from '@hcengineering/core'
import type { AttachedData, Doc, Ref, Status, TxOperations } from '@hcengineering/core'
import { createMarkup } from '@hcengineering/presentation'
import tags from '@hcengineering/tags'
import { isEmptyMarkup } from '@hcengineering/text'
import tracker from '@hcengineering/tracker'
import type { Issue, IssueDraft, IssueParentInfo, Project } from '@hcengineering/tracker'

const MAX_PARALLEL_DESCRIPTION_UPLOADS = 4

/** Save template children while retaining their draft IDs and displayed order. */
export async function saveSubIssues (
  client: TxOperations,
  project: Project,
  subIssues: IssueDraft[],
  parents: IssueParentInfo[],
  parentId: Ref<Doc>,
  statuses: Status[] = []
): Promise<void> {
  if (subIssues.length === 0) return

  const incResult = await client.updateDoc(
    tracker.class.Project,
    core.space.Space,
    project._id,
    {
      $inc: { sequence: subIssues.length }
    },
    true
  )
  // The atomic increment returns the end of our range, including concurrent reservations.
  const firstNumber = (incResult as { object: Project }).object.sequence - subIssues.length + 1
  const limiter = new RateLimiter(MAX_PARALLEL_DESCRIPTION_UPLOADS)
  const descriptions = await Promise.all(
    subIssues.map(async (subIssue) => {
      if (isEmptyMarkup(subIssue.description)) return null
      const collabId = makeCollabId(tracker.class.Issue, subIssue._id, 'description')
      return await limiter.exec(async () => await createMarkup(collabId, subIssue.description))
    })
  )

  const operations = client.apply()
  for (const [index, subIssue] of subIssues.entries()) {
    const number = firstNumber + index
    const childId = subIssue._id
    const cvalue: AttachedData<Issue> = {
      title: subIssue.title.trim(),
      description: descriptions[index],
      assignee: subIssue.assignee,
      component: subIssue.component,
      milestone: subIssue.milestone,
      number,
      status: subIssue.status ?? project.defaultIssueStatus ?? statuses[0]?._id,
      priority: subIssue.priority,
      rank: '',
      comments: 0,
      subIssues: 0,
      startDate: subIssue.startDate ?? null,
      dueDate: null,
      parents,
      reportedTime: 0,
      remainingTime: 0,
      estimation: subIssue.estimation,
      reports: 0,
      relations: [],
      childInfo: [],
      kind: subIssue.kind,
      identifier: `${project.identifier}-${number}`
    }

    await operations.addCollection(
      tracker.class.Issue,
      project._id,
      parentId,
      tracker.class.Issue,
      'subIssues',
      cvalue,
      childId
    )
    if ((subIssue.labels?.length ?? 0) > 0) {
      for (const label of subIssue.labels) {
        await operations.addCollection(tags.class.TagReference, project._id, childId, tracker.class.Issue, 'labels', {
          title: label.title,
          color: label.color,
          tag: label.tag
        })
      }
    }
  }
  const result = await operations.commit()
  if (!result.result) {
    throw new Error('Failed to save sub-issues')
  }
}
