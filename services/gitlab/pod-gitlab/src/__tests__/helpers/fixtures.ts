// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */

import core, { type PersonId, type Ref, type Status, type StatusCategory } from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import task, { type ProjectType, type TaskType } from '@hcengineering/task'
import tracker from '@hcengineering/tracker'
import type { GitlabIssueInfo, GitlabNoteInfo, GitlabUserRef } from '../../gitlab/types'
import type { RepositoryContext } from '../../sync/types'
import type { MemoryClient, Row } from './memory'

export const HOST = 'https://gitlab.example.com'
export const PROJECT_ID = 42
export const CONNECTED_BY = 'sid-connector' as PersonId
export const HULY_USER = 'sid-huly-user' as PersonId
export const TASK_TYPE = 'tt-issue' as Ref<TaskType>
export const PROJECT_TYPE = 'pt-1' as Ref<ProjectType>

function status (id: string, category: Ref<StatusCategory>): Status {
  return { _id: id as Ref<Status>, _class: core.class.Status, space: core.space.Model, category, name: id } as unknown as Status
}

export const STATUSES: Status[] = [
  status('st-backlog', task.statusCategory.UnStarted),
  status('st-todo', task.statusCategory.ToDo),
  status('st-progress', task.statusCategory.Active),
  status('st-done', task.statusCategory.Won),
  status('st-canceled', task.statusCategory.Lost)
]

export function gitlabUser (id: number): GitlabUserRef {
  return { id, username: `user${id}`, name: `User ${id}`, avatar_url: null }
}

export function gitlabIssue (iid: number, overrides: Partial<GitlabIssueInfo> = {}): GitlabIssueInfo {
  return {
    id: 1000 + iid,
    iid,
    project_id: PROJECT_ID,
    title: `Issue ${iid}`,
    description: `Body ${iid}`,
    state: 'opened',
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
    closed_at: null,
    web_url: `${HOST}/group/proj/-/issues/${iid}`,
    confidential: false,
    author: gitlabUser(1),
    assignees: [],
    ...overrides
  }
}

export function gitlabNote (id: number, overrides: Partial<GitlabNoteInfo> = {}): GitlabNoteInfo {
  return {
    id,
    body: `Note ${id}`,
    author: gitlabUser(2),
    created_at: '2026-01-01T11:00:00.000Z',
    updated_at: '2026-01-01T11:00:00.000Z',
    system: false,
    internal: false,
    noteable_type: 'Issue',
    noteable_iid: 1,
    ...overrides
  }
}

export interface SeedOptions {
  enabled?: boolean
  hookId?: number | null
  repositoryId?: string
  projectRef?: string
}

/** Adds an integration, a repository linked to a project, the issue task type and its statuses. */
export function seedRepository (memory: MemoryClient, options: SeedOptions = {}): RepositoryContext {
  const repositoryId = options.repositoryId ?? 'repo-1'
  const projectRef = options.projectRef ?? 'prj-1'
  if (memory.docs.find((d) => d._id === 'int-1') === undefined) {
    memory.docs.push({
      _id: 'int-1', _class: gitlab.class.GitlabIntegration, space: core.space.Configuration, host: HOST, gitlabUserId: 9,
      login: 'connector', name: 'Connector', connectedBy: CONNECTED_BY, alive: true, error: null, repositories: 1
    })
    memory.docs.push({ _id: TASK_TYPE, _class: task.class.TaskType, parent: PROJECT_TYPE, ofClass: tracker.class.Issue, statuses: STATUSES.map((it) => it._id) })
    memory.docs.push(...(STATUSES as unknown as Row[]))
  }
  const repository: Row = {
    _id: repositoryId, _class: gitlab.class.GitlabIntegrationRepository, space: core.space.Configuration,
    attachedTo: 'int-1', attachedToClass: gitlab.class.GitlabIntegration, collection: 'repositories',
    projectId: PROJECT_ID, name: 'proj', pathWithNamespace: 'group/proj', webUrl: `${HOST}/group/proj`,
    description: null, visibility: 'private', archived: false, defaultBranch: 'main', starCount: 0, forksCount: 0,
    openIssuesCount: 0, lastActivityAt: 0, enabled: options.enabled ?? true, gitlabProject: projectRef,
    hookId: options.hookId === undefined ? 7 : options.hookId, deleted: false
  }
  memory.docs.push(repository)
  let project = memory.docs.find((d) => d._id === projectRef)
  if (project === undefined) {
    project = {
      _id: projectRef, _class: tracker.class.Project, space: core.space.Space, name: 'Project', identifier: 'PRJ',
      sequence: 0, type: PROJECT_TYPE, archived: false,
      [gitlab.mixin.GitlabProject]: { integration: 'int-1', repositories: [repositoryId] }
    }
    memory.docs.push(project)
  } else {
    project[gitlab.mixin.GitlabProject].repositories.push(repositoryId)
  }
  const integration = memory.docs.find((d) => d._id === 'int-1') as Row
  return {
    integration,
    repository,
    project: { ...project, ...project[gitlab.mixin.GitlabProject] }
  } as unknown as RepositoryContext
}

export function hulyIssue (memory: MemoryClient, id: string, overrides: Row = {}): Row {
  const issue: Row = {
    _id: id, _class: tracker.class.Issue, space: 'prj-1', title: `Huly ${id}`, description: null, assignee: null,
    status: 'st-backlog', identifier: `PRJ-${id}`, number: 1, rank: '0|a', modifiedBy: HULY_USER, modifiedOn: 0,
    ...overrides
  }
  memory.docs.push(issue)
  return issue
}
