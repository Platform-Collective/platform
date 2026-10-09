// SPDX-License-Identifier: EPL-2.0

import { type Doc, type DocData, type Ref, type Space, type TxOperations } from '@hcengineering/core'
import { type DocCreatePhase, getClient } from '@hcengineering/presentation'
import tracker, { type Issue } from '@hcengineering/tracker'
import { issueLinkFor, type RepositoryChoice } from './repository-choice'
import gitlab from './plugin'

/** The "Merge requests" navigation entry is shown for GitLab-linked projects only. */
export async function showForRepositoryOnly (spaces: Space[]): Promise<boolean> {
  const hierarchy = getClient().getHierarchy()
  return spaces.some((it) => hierarchy.hasMixin(it, gitlab.mixin.GitlabProject))
}

/**
 * Issue-create extension: stores the picked repository as the `GitlabIssue` mixin after the issue exists ('post');
 * the GitLab service then creates the GitLab issue there.
 */
export async function updateIssue (
  client: TxOperations,
  id: Ref<Doc>,
  space: Space,
  _document: DocData<Doc>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- extension state is untyped by DocCreateFunction
  extraData: Record<string, any>,
  phase: DocCreatePhase
): Promise<void> {
  if (phase !== 'post' || !client.getHierarchy().hasMixin(space, gitlab.mixin.GitlabProject)) return
  const link = issueLinkFor(extraData as RepositoryChoice)
  if (link !== undefined) {
    await client.createMixin(id as Ref<Issue>, tracker.class.Issue, space._id, gitlab.mixin.GitlabIssue, link)
  }
}
