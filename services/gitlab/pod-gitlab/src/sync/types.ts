// SPDX-License-Identifier: EPL-2.0

import type { CollaboratorClient } from '@hcengineering/collaborator-client'
import type { Doc, DocumentUpdate, MeasureContext, PersonId, Ref, Status, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import type { DocSyncInfo, GitlabIntegration, GitlabIntegrationRepository, GitlabProject } from '@hcengineering/gitlab'
import type { TaskType } from '@hcengineering/task'
import type { GitlabApi } from '../gitlab/api'
import type { MarkdownConverter } from '../markdown'
import type { PersonMapping } from './persons'
import type { SyncRunner } from './runner'

/** An enabled repository with its integration and the Huly project it is linked to. */
export interface RepositoryContext {
  integration: GitlabIntegration
  repository: GitlabIntegrationRepository
  project: GitlabProject
}

export interface IssueTaskType {
  taskType: Ref<TaskType>
  statuses: Status[]
}

/** What a workspace worker offers to the sync managers. */
export interface SyncProvider {
  readonly workspace: WorkspaceUuid
  // Huly writes; System unless an author is passed
  readonly client: TxOperations
  // DocSyncInfo writes (derived, System)
  readonly derived: TxOperations
  readonly collaborator: Pick<CollaboratorClient, 'getMarkup' | 'updateMarkup'>
  readonly markdown: MarkdownConverter
  readonly persons: PersonMapping
  readonly runner: SyncRunner
  repositoryContext: (repository: Ref<GitlabIntegrationRepository> | null | undefined) => RepositoryContext | undefined
  projectRepositories: (project: Ref<GitlabProject>) => RepositoryContext[]
  // Acting as the integration's connecting user; undefined when that authorization expired
  integrationApi: (integration: GitlabIntegration) => Promise<GitlabApi | undefined>
  // Acting as `actor` when they connected GitLab in this workspace, else as the integration's connecting user
  apiFor: (integration: GitlabIntegration, actor: PersonId) => Promise<GitlabApi | undefined>
  issueTaskType: (project: GitlabProject) => Promise<IssueTaskType | undefined>
  triggerSync: () => void
}

export interface DocSyncManager {
  // Brings one pending document in sync; returns the DocSyncInfo update to store
  sync: (
    ctx: MeasureContext,
    existing: Doc | undefined,
    info: DocSyncInfo,
    parent: DocSyncInfo | undefined
  ) => Promise<DocumentUpdate<DocSyncInfo>>
  // The Huly document was removed; true when the sync doc can be removed
  handleDelete: (ctx: MeasureContext, info: DocSyncInfo) => Promise<boolean>
}
