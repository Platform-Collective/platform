// SPDX-License-Identifier: EPL-2.0

import type { Hyperlink, Ref, Space } from '@hcengineering/core'
import type { GitlabIntegrationRepository } from '@hcengineering/gitlab'

/** State of the issue-create extension: no `repository` = no pick, null = Huly only. */
export interface RepositoryChoice {
  repository?: Ref<GitlabIntegrationRepository> | null
}

/** `GitlabIssue` mixin data written at creation; the GitLab service fills in url and iid. */
export interface GitlabIssueLink {
  repository: Ref<GitlabIntegrationRepository> | null
  url: Hyperlink
  gitlabIid: number
}

/** Repositories linked to `project` that can receive issues. */
export function linkedRepositories (
  all: Iterable<GitlabIntegrationRepository>,
  project: Ref<Space> | undefined
): GitlabIntegrationRepository[] {
  if (project === undefined) return []
  return [...all].filter((it) => it.gitlabProject === project && it.enabled && !it.deleted)
}

/** Where a new issue goes when nothing is picked: the only linked repository, else nowhere. */
export function defaultRepository (linked: GitlabIntegrationRepository[]): GitlabIntegrationRepository | undefined {
  return linked.length === 1 ? linked[0] : undefined
}

/** The repository the picker shows; null shows "Without repository". */
export function shownRepository (
  choice: RepositoryChoice,
  linked: GitlabIntegrationRepository[]
): GitlabIntegrationRepository | null {
  if (choice.repository === undefined) return defaultRepository(linked) ?? null
  if (choice.repository === null) return null
  return linked.find((it) => it._id === choice.repository) ?? null
}

/** Drops a pick that is not linked to the current project (the user switched projects in the dialog). */
export function validChoice (choice: RepositoryChoice, linked: GitlabIntegrationRepository[]): RepositoryChoice {
  if (choice.repository == null || linked.some((it) => it._id === choice.repository)) return choice
  return {}
}

/** `GitlabIssue` mixin data for a pick; undefined when nothing was picked. */
export function issueLinkFor (choice: RepositoryChoice): GitlabIssueLink | undefined {
  if (choice.repository === undefined) return undefined
  return { repository: choice.repository, url: '' as Hyperlink, gitlabIid: 0 }
}
