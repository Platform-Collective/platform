// SPDX-License-Identifier: EPL-2.0

import type { CollaboratorClient } from '@hcengineering/collaborator-client'
import type { Doc, DocumentUpdate, MeasureContext, PersonId, Ref, Status, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import type { DocSyncInfo, GitlabIntegration, GitlabIntegrationRepository, GitlabProject } from '@hcengineering/gitlab'
import type { TaskType } from '@hcengineering/task'
import type { GitlabApi } from '../gitlab/api'
import type { GitlabUserRef } from '../gitlab/types'
import type { MarkdownConverter } from '../markdown'
import type { ContentConverter } from './content'
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

/** Where merge request diffs go (blob storage in production). */
export interface PatchStore {
  // Writes the diff to a new blob (browsers cache blobs by name); returns the blob name and size
  put: (ctx: MeasureContext, patch: string) => Promise<{ file: string, size: number }>
  remove: (ctx: MeasureContext, file: string) => Promise<void>
}

/** Huly files in the workspace's blob storage, for copied images. */
export interface ImageStore {
  // The file's size and type without reading it; undefined when there is no such file
  stat: (ctx: MeasureContext, file: string) => Promise<{ size: number, contentType: string } | undefined>
  // The file's bytes and type; undefined when there is no such file
  read: (ctx: MeasureContext, file: string) => Promise<{ data: Buffer, contentType: string } | undefined>
  // Stores the bytes under a new name and returns it
  put: (ctx: MeasureContext, data: Buffer, contentType: string) => Promise<string>
}

/** A GitLab client acting as one Huly user, with that user's GitLab account. */
export interface UserApi {
  api: GitlabApi
  user: GitlabUserRef
}

/** What a workspace worker offers to the sync managers. */
export interface SyncProvider {
  readonly workspace: WorkspaceUuid
  // The worker's clock (epoch ms)
  now: () => number
  // Huly writes; System unless an author is passed
  readonly client: TxOperations
  // DocSyncInfo writes (derived, System)
  readonly derived: TxOperations
  readonly collaborator: Pick<CollaboratorClient, 'getMarkup' | 'updateMarkup'>
  readonly markdown: MarkdownConverter
  // GitLab text with images copied in both directions; use it for every description and comment
  readonly content: ContentConverter
  readonly persons: PersonMapping
  readonly runner: SyncRunner
  // Undefined when the pod has no blob storage: merge request diffs are then not stored
  readonly patches?: PatchStore
  repositoryContext: (repository: Ref<GitlabIntegrationRepository> | null | undefined) => RepositoryContext | undefined
  projectRepositories: (project: Ref<GitlabProject>) => RepositoryContext[]
  // Acting as the integration's connecting user; undefined when that authorization expired
  integrationApi: (integration: GitlabIntegration) => Promise<GitlabApi | undefined>
  // Acting as `actor` when they connected GitLab in this workspace, else as the integration's connecting user
  apiFor: (integration: GitlabIntegration, actor: PersonId) => Promise<GitlabApi | undefined>
  // Acting as `actor` only: undefined unless they connected GitLab on the integration's host
  userApi: (integration: GitlabIntegration, actor: PersonId) => Promise<UserApi | undefined>
  issueTaskType: (project: GitlabProject) => Promise<IssueTaskType | undefined>
  // The project's merge request task type; added to its project type when missing
  mergeRequestTaskType: (project: GitlabProject) => Promise<IssueTaskType | undefined>
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
  // The Huly document is in another project than its sync doc (a Huly move). The manager writes
  // the sync doc itself. Unset: the worker records the move as an error.
  handleMove?: (ctx: MeasureContext, existing: Doc, info: DocSyncInfo) => Promise<void>
}
