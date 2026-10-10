// SPDX-License-Identifier: EPL-2.0

import type { GitlabNoteable } from '../gitlab/types'

/** GitLab host without scheme or trailing slash, lower case: 'gitlab.com', 'git.corp.local/gitlab'. */
export function hostKey (host: string): string {
  return host
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Stable key of a GitLab issue or merge request. Project ids and iids survive project renames and transfers. */
export function objectKey (host: string, projectId: number, noteable: GitlabNoteable, iid: number): string {
  return `${hostKey(host)}/projects/${projectId}/${noteable}/${iid}`
}

export function issueKey (host: string, projectId: number, iid: number): string {
  return objectKey(host, projectId, 'issues', iid)
}

export function mergeRequestKey (host: string, projectId: number, iid: number): string {
  return objectKey(host, projectId, 'merge_requests', iid)
}

export function noteKey (issue: string, noteId: number): string {
  return `${issue}/notes/${noteId}`
}

/** A diff discussion of a merge request; GitLab discussion ids are hex strings unique per merge request. */
export function discussionKey (mergeRequest: string, discussionId: string): string {
  return `${mergeRequest}/discussions/${discussionId}`
}

export function discussionIdOf (key: string): string {
  const marker = '/discussions/'
  return key.slice(key.lastIndexOf(marker) + marker.length)
}

/** A review message: one review state change of one GitLab user, at `at` (epoch ms). */
export function reviewKey (mergeRequest: string, userId: number, at: number): string {
  return `${mergeRequest}/reviews/${userId}/${at}`
}

/** Lock key that serialises issue creation and issue webhooks of one repository. */
export function repositoryLockKey (repositoryId: string): string {
  return `repository:${repositoryId}`
}

/** Value of a GitLab social id; host-scoped because user ids are only unique per GitLab instance. */
export function gitlabSocialValue (host: string, userId: number): string {
  return `${userId}@${hostKey(host)}`
}

export function parseGitlabSocialValue (value: string): { userId: number, host: string } | undefined {
  const at = value.indexOf('@')
  if (at <= 0) return undefined
  const userId = Number(value.slice(0, at))
  if (!Number.isSafeInteger(userId) || userId <= 0) return undefined
  return { userId, host: value.slice(at + 1) }
}

/** True when a GitLab project web URL belongs to `host`, including self-managed sub-paths. */
export function belongsToHost (webUrl: string, host: string): boolean {
  const key = hostKey(host)
  const url = hostKey(webUrl)
  return url === key || url.startsWith(`${key}/`)
}
