// SPDX-License-Identifier: EPL-2.0

import { type GitlabMergeRequest } from '@hcengineering/gitlab'
import { trimTrailingSlashes } from './gitlab-host'
import { safeHttpUrl } from './safe-url'

/** Merge requests above either limit are not rendered in Huly; the panel points to GitLab. */
export const MAX_SHOWN_FILES = 50
export const MAX_SHOWN_LINES = 2000

/**
 * The GitLab page with a merge request's code changes, or undefined when the mirrored url is not http(s)
 * (a mirrored value must never become a javascript: link).
 */
export function changesUrl (url: string): string | undefined {
  const base = safeHttpUrl(trimTrailingSlashes(url.split(/[?#]/)[0]))
  return base === undefined ? undefined : `${base}/diffs`
}

type ChangeCounts = Pick<GitlabMergeRequest, 'files' | 'additions' | 'deletions'>

/** Over either limit. */
export function isTooLargeForHuly (mergeRequest: ChangeCounts): boolean {
  return mergeRequest.files > MAX_SHOWN_FILES || mergeRequest.additions + mergeRequest.deletions > MAX_SHOWN_LINES
}

/** Whether Huly renders the diff, or only points to GitLab. */
export function showDiffInHuly (mergeRequest: ChangeCounts, hasPatch: boolean): boolean {
  return hasPatch && !isTooLargeForHuly(mergeRequest)
}
