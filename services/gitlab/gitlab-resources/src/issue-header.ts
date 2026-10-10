// SPDX-License-Identifier: EPL-2.0

import { type Doc, type Hierarchy } from '@hcengineering/core'
import { type GitlabMergeRequest } from '@hcengineering/gitlab'
import gitlab from './plugin'
import { safeHttpUrl } from './safe-url'

export interface IssueHeaderInput {
  mergeRequest?: { syncError?: string | null }
  link?: { gitlabIid?: number, repository?: string | null, syncError?: string | null }
  linkedRepositories: number
  readonly: boolean
}

/** What the GitLab header of an issue shows. */
export interface IssueHeaderState {
  kind: 'mergeRequest' | 'linked' | 'creating' | 'failed' | 'pick' | 'none'
  // GitLab's last sync error for this issue; null when there is none
  error: string | null
}

export function issueHeaderState (input: IssueHeaderInput): IssueHeaderState {
  const { mergeRequest, link } = input
  if (mergeRequest !== undefined) return { kind: 'mergeRequest', error: mergeRequest.syncError ?? null }
  const error = link?.syncError ?? null
  if ((link?.gitlabIid ?? 0) > 0) return { kind: 'linked', error }
  // Picked: the GitLab service is creating the issue, or GitLab refused it
  if (link?.repository != null) return { kind: error === null ? 'creating' : 'failed', error }
  if (input.linkedRepositories > 0 && !input.readonly) return { kind: 'pick', error }
  return { kind: 'none', error }
}

/** The description images left on GitLab that the header's viewer offers: a merge request's, or a linked issue's. */
export function headerImages (input: { mergeRequest?: { images?: string[] }, link?: { images?: string[] } }): string[] {
  const images = input.mergeRequest?.images ?? input.link?.images ?? []
  return images.flatMap((image) => safeHttpUrl(image) ?? [])
}

/** The issue as a GitLab merge request, or undefined for a plain issue. */
export function asMergeRequest (hierarchy: Pick<Hierarchy, 'isDerived'>, doc: Doc): GitlabMergeRequest | undefined {
  return hierarchy.isDerived(doc._class, gitlab.class.GitlabMergeRequest) ? (doc as GitlabMergeRequest) : undefined
}
