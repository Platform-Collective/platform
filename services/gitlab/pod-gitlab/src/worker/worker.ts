// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import chunter from '@hcengineering/chunter'
import type { CollaboratorClient } from '@hcengineering/collaborator-client'
import core, {
  type Doc,
  type DocumentUpdate,
  type MeasureContext,
  type PersonId,
  type Ref,
  SortingOrder,
  type Status,
  type Tx,
  type TxApplyIf,
  type TxCUD,
  type TxOperations,
  TxProcessor,
  type WorkspaceUuid
} from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabIntegration, type GitlabIntegrationRepository, type GitlabProject } from '@hcengineering/gitlab'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'
import { GitlabApi } from '../gitlab/api'
import type { GitlabUserRef } from '../gitlab/types'
import type { MarkdownConverter } from '../markdown'
import { errorMessage, isPermanentError } from '../sync/errors'
import { IssueSyncManager } from '../sync/issues'
import { belongsToHost } from '../sync/keys'
import { NoteSyncManager } from '../sync/notes'
import { GitlabPersonMapper, type PersonMapping } from '../sync/persons'
import { SyncRunner } from '../sync/runner'
import type { DocSyncManager, IssueTaskType, RepositoryContext, SyncProvider } from '../sync/types'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import type { GitlabUserManager, GitlabUserRecord } from '../users'

export const FULL_SYNC_INTERVAL_MS = 60 * 60 * 1000
// GitLab timestamps and the pod clock may differ; re-reading a few minutes is harmless
export const SINCE_MARGIN_MS = 5 * 60 * 1000
const FAILED_FULL_SYNC_RETRY_MS = 5 * 60 * 1000
const IDLE_WAKE_MS = 60 * 1000
const TOKEN_CACHE_MS = 30 * 1000
const BATCH = 50

export type GitlabHookKind = 'Issue Hook' | 'Note Hook'

/** The webhook fields used for routing; objects themselves are re-fetched through REST. */
export interface GitlabHookPayload {
  project?: { id?: number, web_url?: string }
  user?: GitlabUserRef
  object_attributes?: { id?: number, iid?: number, noteable_type?: string }
  issue?: { iid?: number }
}

export interface SyncManagers {
  issues: IssueSyncManager
  notes: NoteSyncManager
}

export interface WorkerDeps {
  ctx: MeasureContext
  workspace: WorkspaceUuid
  // System writes
  client: TxOperations
  // System derived writes for DocSyncInfo
  derived: TxOperations
  users: Pick<GitlabUserManager, 'getValidRecord'>
  accounts: Pick<AccountClient, 'ensurePerson'>
  collaborator: Pick<CollaboratorClient, 'getMarkup' | 'updateMarkup'>
  markdown: MarkdownConverter
  // A client acting as the given account on the worker's connection (pooled sessions for the HTTP service)
  session?: (accountId: PersonId) => TxOperations
  closeConnection?: () => Promise<void>
  // Test seams
  persons?: PersonMapping
  createApi?: (host: string, token: string) => GitlabApi
  createManagers?: (provider: SyncProvider) => SyncManagers
  now?: () => number
}

/** True for transactions that can change what the worker has to do. */
export function isRelevantTx (tx: Tx): boolean {
  if (tx._class === core.class.TxApplyIf) {
    return (tx as TxApplyIf).txes.some((it) => isRelevantTx(it))
  }
  if (!TxProcessor.isExtendsCUD(tx._class)) return false
  const cud = tx as TxCUD<Doc>
  return (
    cud.objectClass === gitlab.class.DocSyncInfo ||
    cud.objectClass === gitlab.class.GitlabIntegrationRepository ||
    cud.objectClass === gitlab.class.GitlabIntegration ||
    cud.objectClass === tracker.class.Project
  )
}

/** Wake-up signal for the loop; a notification while nobody waits is kept. */
class Signal {
  private pending = false
  private wake: (() => void) | undefined

  notify (): void {
    this.pending = true
    this.wake?.()
  }

  async wait (timeoutMs: number): Promise<void> {
    if (!this.pending) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.wake = undefined
          resolve()
        }, timeoutMs)
        this.wake = () => {
          clearTimeout(timer)
          this.wake = undefined
          resolve()
        }
      })
    }
    this.pending = false
  }
}

/**
 * Keeps one workspace's linked GitLab projects and Huly projects in sync.
 */
export class GitlabWorker implements SyncProvider {
  readonly runner = new SyncRunner()
  readonly persons: PersonMapping
  private readonly managers: SyncManagers
  private repositories: RepositoryContext[] = []
  private readonly wasEnabled = new Map<Ref<GitlabIntegrationRepository>, boolean>()
  // Start of the next full sync's window (epoch ms); undefined imports everything
  private readonly fullSyncFrom = new Map<Ref<GitlabIntegrationRepository>, number | undefined>()
  private readonly nextFullSync = new Map<Ref<GitlabIntegrationRepository>, number>()
  private readonly tokens = new Map<PersonId, { record: GitlabUserRecord | undefined, until: number }>()
  private readonly signal = new Signal()
  private closing = false
  private loop: Promise<void> | undefined

  constructor (private readonly deps: WorkerDeps) {
    this.persons = deps.persons ?? new GitlabPersonMapper(deps.client, deps.accounts)
    this.managers = deps.createManagers?.(this) ?? { issues: new IssueSyncManager(this), notes: new NoteSyncManager(this) }
  }

  get workspace (): WorkspaceUuid {
    return this.deps.workspace
  }

  get client (): TxOperations {
    return this.deps.client
  }

  get derived (): TxOperations {
    return this.deps.derived
  }

  get collaborator (): Pick<CollaboratorClient, 'getMarkup' | 'updateMarkup'> {
    return this.deps.collaborator
  }

  get markdown (): MarkdownConverter {
    return this.deps.markdown
  }

  private now (): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Loads repositories; completes before the platform routes webhooks to this worker. */
  async init (): Promise<void> {
    await this.refresh()
  }

  start (): void {
    this.loop = this.run()
  }

  async close (): Promise<void> {
    this.closing = true
    this.signal.notify()
    await this.loop
    await this.deps.closeConnection?.()
  }

  triggerSync (): void {
    this.signal.notify()
  }

  requestFullSync (): void {
    for (const id of this.nextFullSync.keys()) this.nextFullSync.set(id, 0)
    this.signal.notify()
  }

  onTx (txes: Tx[]): void {
    if (txes.some((it) => isRelevantTx(it))) this.signal.notify()
  }

  session (accountId: PersonId): TxOperations | undefined {
    return this.deps.session?.(accountId)
  }

  ownsProject (webUrl: string, projectId: number): boolean {
    return this.reposFor(webUrl, projectId).length > 0
  }

  async handleWebhook (kind: GitlabHookKind, payload: GitlabHookPayload): Promise<void> {
    const projectId = payload.project?.id
    const webUrl = payload.project?.web_url
    if (projectId === undefined || webUrl === undefined) return
    for (const repo of this.reposFor(webUrl, projectId)) {
      try {
        const api = await this.integrationApi(repo.integration)
        if (api === undefined) continue
        const actor = payload.user !== undefined ? await this.persons.personIdFor(repo.integration.host, payload.user) : undefined
        const attributes = payload.object_attributes ?? {}
        if (kind === 'Issue Hook' && attributes.iid !== undefined) {
          await this.managers.issues.handleIssueEvent(this.deps.ctx, repo, api, attributes.iid, actor)
        }
        if (kind === 'Note Hook' && attributes.noteable_type === 'Issue' && attributes.id !== undefined && payload.issue?.iid !== undefined) {
          await this.managers.notes.handleNoteEvent(this.deps.ctx, repo, api, payload.issue.iid, attributes.id)
        }
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab webhook processing failed', { kind, projectId, error: errorMessage(err) })
      }
    }
  }

  /** One loop pass: refresh, due full syncs, one batch of pending docs. True when docs were processed. */
  async runOnce (): Promise<boolean> {
    await this.refresh()
    await this.fullSyncDue()
    return await this.syncPending()
  }

  // SyncProvider

  repositoryContext (id: Ref<GitlabIntegrationRepository> | null | undefined): RepositoryContext | undefined {
    return id == null ? undefined : this.repositories.find((it) => it.repository._id === id)
  }

  projectRepositories (project: Ref<GitlabProject>): RepositoryContext[] {
    return this.repositories.filter((it) => it.project._id === project)
  }

  async integrationApi (integration: GitlabIntegration): Promise<GitlabApi | undefined> {
    const record = await this.userRecord(integration.connectedBy)
    return record === undefined ? undefined : this.api(integration.host, record.token)
  }

  async apiFor (integration: GitlabIntegration, actor: PersonId): Promise<GitlabApi | undefined> {
    if (actor !== integration.connectedBy) {
      const own = await this.userRecord(actor)
      if (own !== undefined && own.host === integration.host) return this.api(integration.host, own.token)
    }
    return await this.integrationApi(integration)
  }

  async issueTaskType (project: GitlabProject): Promise<IssueTaskType | undefined> {
    const taskType = await this.client.findOne(task.class.TaskType, { parent: project.type, ofClass: tracker.class.Issue })
    if (taskType === undefined) return undefined
    const found = await this.client.findAll(core.class.Status, { _id: { $in: taskType.statuses } })
    const statuses = taskType.statuses
      .map((id) => found.find((it) => it._id === id))
      .filter((it): it is Status => it !== undefined)
    return { taskType: taskType._id, statuses }
  }

  // Loop

  private async run (): Promise<void> {
    while (!this.closing) {
      let busy = false
      try {
        busy = await this.runOnce()
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab sync loop failed', { workspace: this.workspace, error: errorMessage(err) })
      }
      if (!busy && !this.closing) {
        await this.signal.wait(IDLE_WAKE_MS)
      }
    }
  }

  private api (host: string, token: string): GitlabApi {
    return this.deps.createApi?.(host, token) ?? new GitlabApi(host, token)
  }

  private reposFor (webUrl: string, projectId: number): RepositoryContext[] {
    return this.repositories.filter((it) => it.repository.projectId === projectId && belongsToHost(webUrl, it.integration.host))
  }

  private async userRecord (person: PersonId): Promise<GitlabUserRecord | undefined> {
    const now = this.now()
    const cached = this.tokens.get(person)
    if (cached !== undefined && cached.until > now) return cached.record
    let record: GitlabUserRecord | undefined
    try {
      record = await this.deps.users.getValidRecord(this.workspace, person)
    } catch (err: unknown) {
      this.deps.ctx.warn('gitlab token unavailable', { error: errorMessage(err) })
    }
    this.tokens.set(person, { record, until: now + TOKEN_CACHE_MS })
    return record
  }

  private async refresh (): Promise<void> {
    const integrations = await this.client.findAll(gitlab.class.GitlabIntegration, {})
    const repositories = await this.client.findAll(gitlab.class.GitlabIntegrationRepository, {})
    const projects = await this.client.findAll(gitlab.mixin.GitlabProject, { archived: false })
    const active: RepositoryContext[] = []
    for (const repository of repositories) {
      const integration = integrations.find((it) => it._id === repository.attachedTo)
      const project = projects.find((it) => it._id === repository.gitlabProject)
      const enabled = repository.enabled && !repository.deleted && integration !== undefined && project !== undefined
      if (!enabled) {
        // Unlinked while we watched (e.g. its Huly project was deleted): its hook would keep firing
        if (this.wasEnabled.get(repository._id) === true && repository.gitlabProject === null && integration !== undefined) {
          await this.removeHook(integration, repository)
        }
        this.wasEnabled.set(repository._id, false)
        this.fullSyncFrom.delete(repository._id)
        this.nextFullSync.delete(repository._id)
        continue
      }
      const context: RepositoryContext = { integration, repository, project }
      if (this.wasEnabled.get(repository._id) !== true) {
        this.fullSyncFrom.set(repository._id, await this.storedSince(context))
        this.nextFullSync.set(repository._id, 0)
      }
      this.wasEnabled.set(repository._id, true)
      active.push(context)
    }
    this.repositories = active
  }

  private async removeHook (integration: GitlabIntegration, repository: GitlabIntegrationRepository): Promise<void> {
    if (repository.hookId === null) return
    try {
      const api = await this.integrationApi(integration)
      if (api === undefined) {
        this.deps.ctx.warn('gitlab hook left in place, token unavailable', { projectId: repository.projectId })
        return
      }
      await api.deleteProjectHook(repository.projectId, repository.hookId)
      await this.client.update(repository, { hookId: null })
    } catch (err: unknown) {
      this.deps.ctx.warn('failed to delete gitlab hook', { projectId: repository.projectId, error: errorMessage(err) })
    }
  }

  private async storedSince (repo: RepositoryContext): Promise<number | undefined> {
    const [latest] = await this.derived.findAll(
      gitlab.class.DocSyncInfo,
      { repository: repo.repository._id, objectClass: tracker.class.Issue, lastModified: { $exists: true } },
      { sort: { lastModified: SortingOrder.Descending }, limit: 1 }
    )
    return latest?.lastModified
  }

  private async fullSyncDue (): Promise<void> {
    for (const repo of this.repositories) {
      if (this.closing) return
      const id = repo.repository._id
      const start = this.now()
      if ((this.nextFullSync.get(id) ?? 0) > start) continue
      const api = await this.integrationApi(repo.integration)
      if (api === undefined) {
        await this.markExpired(repo.integration)
        this.nextFullSync.set(id, start + FAILED_FULL_SYNC_RETRY_MS)
        continue
      }
      try {
        await this.requeueRetryable(repo)
        const from = this.fullSyncFrom.get(id)
        const issues = await api.listIssues(repo.repository.projectId, from === undefined ? undefined : new Date(from - SINCE_MARGIN_MS).toISOString())
        for (const issue of issues) {
          if (this.closing) return
          await this.managers.issues.receive(this.deps.ctx, repo, issue)
          await this.managers.notes.refreshNotes(this.deps.ctx, repo, api, issue)
        }
        this.fullSyncFrom.set(id, start)
        this.nextFullSync.set(id, start + FULL_SYNC_INTERVAL_MS)
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab full sync failed', { repository: repo.repository.pathWithNamespace, error: errorMessage(err) })
        this.nextFullSync.set(id, start + FAILED_FULL_SYNC_RETRY_MS)
      }
    }
  }

  private async markExpired (integration: GitlabIntegration): Promise<void> {
    if (integration.alive) {
      await this.client.update(integration, { alive: false, error: 'GitLab authorization expired, please re-authorize' })
    }
  }

  private async requeueRetryable (repo: RepositoryContext): Promise<void> {
    const queries = [
      { repository: repo.repository._id, retryable: true },
      { space: repo.project._id, repository: null, retryable: true }
    ]
    for (const query of queries) {
      for (const info of await this.derived.findAll(gitlab.class.DocSyncInfo, query)) {
        await this.derived.update(info, { needSync: '', error: null, retryable: false })
      }
    }
  }

  private async syncPending (): Promise<boolean> {
    if (this.repositories.length === 0) return false
    const projects = [...new Set(this.repositories.map((it) => it.project._id))]
    const repositories = this.repositories.map((it) => it.repository._id)
    const docs = await this.derived.findAll(
      gitlab.class.DocSyncInfo,
      { needSync: { $ne: GITLAB_SYNC_VERSION }, space: { $in: projects }, repository: { $in: [null, ...repositories] } },
      { limit: BATCH }
    )
    if (docs.length === 0) return false
    // An issue must exist on both sides before its notes
    const ordered = [...docs.filter((it) => it.objectClass === tracker.class.Issue), ...docs.filter((it) => it.objectClass !== tracker.class.Issue)]
    for (const info of ordered) {
      if (this.closing) break
      await this.syncDoc(info)
    }
    return true
  }

  private mapperFor (objectClass: string): DocSyncManager | undefined {
    if (objectClass === tracker.class.Issue) return this.managers.issues
    if (objectClass === chunter.class.ChatMessage) return this.managers.notes
    return undefined
  }

  private async parentOf (info: DocSyncInfo): Promise<DocSyncInfo | undefined> {
    if (info.parent !== undefined) {
      return await this.derived.findOne(gitlab.class.DocSyncInfo, { space: info.space, key: info.parent })
    }
    if (info.attachedTo !== undefined) {
      return await this.derived.findOne(gitlab.class.DocSyncInfo, { _id: info.attachedTo as Ref<DocSyncInfo> })
    }
    return undefined
  }

  /**
   * A webhook may store a newer GitLab object while a doc syncs. The sync did not see it, so the doc stays queued with
   * that object instead of being marked done with the older one.
   */
  private async withoutStaleExternal (info: DocSyncInfo, update: DocumentUpdate<DocSyncInfo>): Promise<DocumentUpdate<DocSyncInfo>> {
    const fresh = await this.derived.findOne(gitlab.class.DocSyncInfo, { _id: info._id })
    const seen = update.lastModified ?? info.lastModified ?? 0
    if (fresh?.lastModified === undefined || fresh.lastModified <= seen) return update
    const { needSync, external, lastModified, ...rest } = update
    return rest
  }

  private async syncDoc (info: DocSyncInfo): Promise<void> {
    const ctx = this.deps.ctx
    const mapper = this.mapperFor(info.objectClass)
    try {
      if (mapper === undefined) {
        await this.derived.update(info, { needSync: GITLAB_SYNC_VERSION })
        return
      }
      if (info.deleted === true) {
        if (await mapper.handleDelete(ctx, info)) {
          await this.derived.remove(info)
        } else {
          await this.derived.update(info, { needSync: GITLAB_SYNC_VERSION })
        }
        return
      }
      const existing = await this.client.findOne(info.objectClass, { _id: info._id as unknown as Ref<Doc> })
      if (existing !== undefined && existing.space !== info.space) {
        await this.derived.update(info, {
          needSync: GITLAB_SYNC_VERSION,
          error: 'Moved to another project; moves are not synchronized with GitLab',
          retryable: false
        })
        return
      }
      const update = await mapper.sync(ctx, existing, info, await this.parentOf(info))
      await this.derived.update(info, await this.withoutStaleExternal(info, update))
    } catch (err: unknown) {
      ctx.error('gitlab sync failed', { _id: info._id, objectClass: info.objectClass, error: errorMessage(err) })
      await this.derived.update(info, { needSync: GITLAB_SYNC_VERSION, error: errorMessage(err), retryable: !isPermanentError(err) })
    }
  }
}
