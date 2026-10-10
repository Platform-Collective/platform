// SPDX-License-Identifier: EPL-2.0

import { type Person } from '@hcengineering/contact'
import { type Ref, type TxOperations } from '@hcengineering/core'
import type { GitlabMergeRequest, GitlabViewedFile } from '@hcengineering/gitlab'
import gitlab from './plugin'

/** The viewed files after one tick or untick; a file counts as viewed per version (sha). */
export function toggleViewed (
  files: GitlabViewedFile[],
  fileName: string,
  sha: string,
  viewed: boolean
): GitlabViewedFile[] {
  const rest = files.filter((it) => !(it.fileName === fileName && it.sha === sha))
  return viewed ? [...rest, { fileName, sha }] : rest
}

/**
 * Runs tasks one after another in call order, so each viewed-file toggle reads what the previous one wrote. A failed
 * task rejects its own call only.
 */
export function createSerialQueue (): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return async (task) => {
    const run = tail.then(task)
    // The next task waits for this one, failed or not
    tail = run.catch(() => {})
    await run
  }
}

export interface ViewedFileChange {
  fileName: string
  sha: string
  viewed: boolean
}

/** Ticks or unticks one file version in this user's review doc, creating the doc on the first tick. */
export async function saveViewedFile (
  client: Pick<TxOperations, 'findOne' | 'update' | 'addCollection'>,
  mergeRequest: Pick<GitlabMergeRequest, '_id' | '_class' | 'space'>,
  author: Ref<Person>,
  change: ViewedFileChange
): Promise<void> {
  const current = await client.findOne(gitlab.class.GitlabMergeRequestReview, { attachedTo: mergeRequest._id, author })
  const files = toggleViewed(current?.files ?? [], change.fileName, change.sha, change.viewed)
  if (current !== undefined) {
    await client.update(current, { files })
  } else {
    await client.addCollection(
      gitlab.class.GitlabMergeRequestReview,
      mergeRequest.space,
      mergeRequest._id,
      mergeRequest._class,
      'viewedFiles',
      { author, files }
    )
  }
}
