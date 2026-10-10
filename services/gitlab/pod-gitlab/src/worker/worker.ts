// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import chunter from '@hcengineering/chunter'
import type { CollaboratorClient } from '@hcengineering/collaborator-client'
import core, {
  type Class,
  type Doc,
  type DocumentUpdate,
  type MeasureContext,
  type MixinData,
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
import gitlab, {
  type DocSyncInfo,
  type GitlabIntegration,
  type GitlabIntegrationRepository,
  type GitlabIssue,
  type GitlabMergeRequest,
  type GitlabProject,
  type GitlabReview
} from '@hcengineering/gitlab'
import task, { type ProjectType, type Task, type TaskTypeWithFactory, updateProjectType } from '@hcengineering/task'
import tracker, { type Issue } from '@hcengineering/tracker'
import { abortableSleep, type FetchFn, GitlabApi, GitlabApiError } from '../gitlab/api'
import type { GitlabMergeRequestInfo, GitlabNoteable, GitlabUserRef } from '../gitlab/types'
import { ensureRepositoryHook, removeRepositoryHook, type HookSettings } from '../hooks'
import { Limiter, LimiterFullError } from '../limiter'
import type { MarkdownConverter } from '../markdown'
import { refreshIntegrationRepositories } from '../repositories'
import { ContentConverter } from '../sync/content'
import { ReviewThreadSyncManager } from '../sync/discussions'
import { EXPIRED_ERROR, errorMessage, isPermanentError } from '../sync/errors'
import { findGitlabImage, type GitlabImageAccess } from '../sync/image-access'
import { IssueSyncManager } from '../sync/issues'
import { isHistorical, MergeRequestSyncManager } from '../sync/merge-requests'
import { belongsToHost } from '../sync/keys'
import { NoteSyncManager } from '../sync/notes'
import { GitlabPersonMapper, type PersonMapping } from '../sync/persons'
import { ReviewCommentSyncManager } from '../sync/review-comments'
import { ReviewSyncManager } from '../sync/reviews'
import { SyncRunner } from '../sync/runner'
import { mergeRequestSyncState } from '../sync/status'
import { mergeRequestTaskTypeData } from '../sync/task-types'
import type {
  DocSyncManager,
  ImageStore,
  IssueTaskType,
  PatchStore,
  RepositoryContext,
  SyncProvider,
  UserApi
} from '../sync/types'
import { GITLAB_SYNC_VERSION } from '../sync/versions'
import type { GitlabUserManager, GitlabUserRecord } from '../users'

export const FULL_SYNC_INTERVAL_MS = 60 * 60 * 1000
// GitLab timestamps and the pod clock may differ; re-reading a few minutes is harmless
export const SINCE_MARGIN_MS = 5 * 60 * 1000
export const FAILED_FULL_SYNC_RETRY_MS = 5 * 60 * 1000
const IDLE_WAKE_MS = 60 * 1000
const TOKEN_CACHE_MS = 30 * 1000
const SYNC_BATCH_SIZE = 50

// An unlinked repository's hook that nobody saw being unlinked is removed after this long
export const ORPHAN_HOOK_GRACE_MS = 10 * 60 * 1000
// Health job per integration: token, alive/error, repositories, hooks
export const HEALTH_INTERVAL_MS = 60 * 60 * 1000
const HEALTH_RETRY_MS = 5 * 60 * 1000
// Open merge requests with an unresolved thread: GitLab may send no event when a thread is resolved there
export const THREAD_REFRESH_MS = 10 * 60 * 1000
const MOVED_ERROR = 'Moved to another project; moves are not synchronized with GitLab'
// Task types change rarely; a minute of staleness saves two queries per synced document
const TASK_TYPE_CACHE_MS = 60 * 1000
// Webhook events processed at once per workspace, and how many more may wait; beyond that a full sync catches up
export const WEBHOOK_CONCURRENCY = 4
export const WEBHOOK_QUEUE = 500

export type GitlabHookKind = 'Issue Hook' | 'Note Hook' | 'Merge Request Hook'

/** The webhook fields used for routing; objects themselves are re-fetched through REST. */
export interface GitlabHookPayload {
  project?: { id?: number, web_url?: string }
  user?: GitlabUserRef
  object_attributes?: {
    id?: number
    iid?: number
    noteable_type?: string
    action?: string
    // Notes: 'DiffNote' for comments on diff lines, with the discussion they belong to
    type?: string | null
    discussion_id?: string
  }
  issue?: { iid?: number }
  merge_request?: { iid?: number }
}

/** A client on the worker's connection for one HTTP request; the connection stays open until it is released. */
export interface SessionLease {
  client: TxOperations
  release: () => void
}

export interface SyncManagers {
  issues: IssueSyncManager
  notes: NoteSyncManager
  mergeRequests: MergeRequestSyncManager
  reviews: ReviewSyncManager
  threads: ReviewThreadSyncManager
  comments: ReviewCommentSyncManager
}

// The listings of a full sync, each with its own incremental window
const LISTINGS: Array<{ kind: GitlabNoteable, objectClass: Ref<Class<Doc>> }> = [
  { kind: 'issues', objectClass: tracker.class.Issue },
  { kind: 'merge_requests', objectClass: gitlab.class.GitlabMergeRequest }
]

function windowKey (repository: Ref<GitlabIntegrationRepository>, kind: GitlabNoteable): string {
  return `${repository}/${kind}`
}

// Merge Request Hook actions of approvals; GitLab may leave updated_at unchanged for them
const APPROVAL_ACTIONS = ['approved', 'unapproved', 'approval', 'unapproval']

// Parents first: issues and merge requests, then threads, then what hangs off them
function syncRank (objectClass: Ref<Class<Doc>>): number {
  if (objectClass === tracker.class.Issue || objectClass === gitlab.class.GitlabMergeRequest) return 0
  if (objectClass === gitlab.class.GitlabReviewThread) return 1
  return 2
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
  // Blob storage for merge request diffs; optional
  patches?: PatchStore
  // Blob storage for copied images; optional
  images?: ImageStore
  // Scoped project hooks; unset: hooks are not checked (tests)
  hooks?: HookSettings
  // A client acting as the given account on the worker's connection (pooled sessions for the HTTP service)
  session?: (accountId: PersonId) => TxOperations
  closeConnection?: () => Promise<void>
  // Every GitLab call (safeFetch in production)
  fetchFn: FetchFn
  // Test seams
  persons?: PersonMapping
  createApi?: (host: string, token: string) => GitlabApi
  createManagers?: (provider: SyncProvider) => SyncManagers
  ensureTaskType?: (client: TxOperations, projectType: Ref<ProjectType>, data: TaskTypeWithFactory) => Promise<void>
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
  // Start of the next full sync's window per repository and listing (epoch ms); undefined imports everything
  private readonly fullSyncFrom = new Map<string, number | undefined>()
  // Windows whose first import has not finished; a checkpoint moves the window but the import stays a first one
  private readonly firstImport = new Set<string>()
  private readonly nextFullSync = new Map<Ref<GitlabIntegrationRepository>, number>()
  // After a failed full sync: no retry before `failed`, and never before `rateLimited` (GitLab's RateLimit-Reset)
  private readonly backoff = new Map<Ref<GitlabIntegrationRepository>, { failed: number, rateLimited: number }>()
  private integrations: GitlabIntegration[] = []
  private readonly nextHealth = new Map<Ref<GitlabIntegration>, number>()
  private readonly nextThreadRefresh = new Map<Ref<GitlabIntegrationRepository>, number>()
  // Linked repositories whose hook was checked since the pod started
  private readonly hooksChecked = new Set<Ref<GitlabIntegrationRepository>>()
  private readonly tokens = new Map<PersonId, { record: GitlabUserRecord | undefined, until: number }>()
  // Bumped by forgetTokens: a lookup that started before it is not cached
  private tokensGeneration = 0
  private readonly taskTypes = new Map<string, { value: IssueTaskType, until: number }>()
  private readonly signal = new Signal()
  // First time a repository was seen unlinked with its hook still installed, while nobody saw it being unlinked
  private readonly orphanSince = new Map<Ref<GitlabIntegrationRepository>, number>()
  // Webhook handlers and leased sessions that still use the connection
  private readonly inFlight = new Set<Promise<unknown>>()
  // One task type addition per project type at a time
  private readonly ensuringTaskType = new Map<Ref<ProjectType>, Promise<void>>()
  private readonly webhooks = new Limiter(WEBHOOK_CONCURRENCY, WEBHOOK_QUEUE)
  private closing = false
  // Aborted by close(): GitLab calls waiting out a rate limit give up at once
  private readonly closed = new AbortController()
  private loop: Promise<void> | undefined

  constructor (private readonly deps: WorkerDeps) {
    this.persons = deps.persons ?? new GitlabPersonMapper(deps.client, deps.accounts)
    const comments = new ReviewCommentSyncManager(this)
    this.managers = deps.createManagers?.(this) ?? {
      issues: new IssueSyncManager(this),
      notes: new NoteSyncManager(this),
      mergeRequests: new MergeRequestSyncManager(this),
      reviews: new ReviewSyncManager(this),
      threads: new ReviewThreadSyncManager(this, comments),
      comments
    }
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

  private contentConverter: ContentConverter | undefined

  get content (): ContentConverter {
    this.contentConverter ??= new ContentConverter({
      ctx: this.deps.ctx,
      markdown: this.deps.markdown,
      images: this.deps.images,
      derived: this.deps.derived,
      integrationApi: async (integration) => await this.integrationApi(integration)
    })
    return this.contentConverter
  }

  get patches (): PatchStore | undefined {
    return this.deps.patches
  }

  now (): number {
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
    this.closed.abort(new Error('GitLab worker closed'))
    this.signal.notify()
    await this.loop
    // Webhook handlers and service requests still using the connection finish first
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight])
    }
    await this.deps.closeConnection?.()
  }

  triggerSync (): void {
    this.signal.notify()
  }

  /** A connection changed (disconnect, re-authorization): cached tokens may be revoked or replaced. */
  forgetTokens (): void {
    this.tokens.clear()
    this.tokensGeneration++
  }

  /**
   * Runs the full sync of every repository soon. A change in the workspace may have fixed a failure, so only a rate
   * limit is waited for; a catch-up after dropped webhooks also keeps the failure backoff.
   */
  requestFullSync (reason: 'changed' | 'catch-up' = 'changed'): void {
    for (const [id, next] of this.nextFullSync) {
      const backoff = this.backoff.get(id)
      const notBefore = backoff === undefined ? 0 : reason === 'catch-up' ? backoff.failed : backoff.rateLimited
      this.nextFullSync.set(id, Math.min(next, notBefore))
    }
    this.signal.notify()
  }

  onTx (txes: Tx[]): void {
    if (txes.some((it) => isRelevantTx(it))) this.signal.notify()
  }

  lease (accountId: PersonId): SessionLease | undefined {
    if (this.closing || this.deps.session === undefined) return undefined
    let release: () => void = () => {}
    const ended = new Promise<void>((resolve) => {
      release = resolve
    })
    void this.track(ended)
    return { client: this.deps.session(accountId), release }
  }

  ownsProject (webUrl: string, projectId: number): boolean {
    return this.reposFor(webUrl, projectId).length > 0
  }

  async handleWebhook (
    kind: GitlabHookKind,
    payload: GitlabHookPayload,
    integration?: Ref<GitlabIntegration>
  ): Promise<void> {
    // Dropped while closing: the next full sync catches up
    if (this.closing) return
    try {
      await this.track(
        this.webhooks.run(async () => {
          if (!this.closing) await this.processWebhook(kind, payload, integration)
        })
      )
    } catch (err: unknown) {
      if (!(err instanceof LimiterFullError)) throw err
      this.deps.ctx.warn('gitlab webhook dropped, too many waiting; a full sync catches up', {
        workspace: this.workspace,
        kind
      })
      this.requestFullSync('catch-up')
    }
  }

  private async processWebhook (
    kind: GitlabHookKind,
    payload: GitlabHookPayload,
    integration?: Ref<GitlabIntegration>
  ): Promise<void> {
    const projectId = payload.project?.id
    const webUrl = payload.project?.web_url
    if (projectId === undefined || webUrl === undefined) return
    // A scoped hook speaks for one integration only
    const repos = this.reposFor(webUrl, projectId).filter(
      (it) => integration === undefined || it.integration._id === integration
    )
    for (const repo of repos) {
      try {
        const api = await this.integrationApi(repo.integration)
        if (api === undefined) continue
        const actor =
          payload.user !== undefined ? await this.persons.personIdFor(repo.integration.host, payload.user) : undefined
        const attributes = payload.object_attributes ?? {}
        if (kind === 'Issue Hook' && attributes.iid !== undefined) {
          await this.managers.issues.handleIssueEvent(this.deps.ctx, repo, api, attributes.iid, actor)
        }
        if (kind === 'Merge Request Hook' && attributes.iid !== undefined) {
          const refresh = APPROVAL_ACTIONS.includes(attributes.action ?? '')
          const found = await this.managers.mergeRequests.handleMergeRequestEvent(
            this.deps.ctx,
            repo,
            api,
            attributes.iid,
            actor,
            refresh
          )
          // Gone from GitLab (404): so are its discussions
          if (found) await this.managers.threads.refreshDiscussions(this.deps.ctx, repo, api, attributes.iid)
        }
        if (kind === 'Note Hook' && attributes.id !== undefined) {
          if (attributes.noteable_type === 'Issue' && payload.issue?.iid !== undefined) {
            await this.managers.notes.handleNoteEvent(this.deps.ctx, repo, api, payload.issue.iid, attributes.id)
          }
          if (attributes.noteable_type === 'MergeRequest' && payload.merge_request?.iid !== undefined) {
            if (attributes.type === 'DiffNote' && attributes.discussion_id !== undefined) {
              await this.managers.threads.handleDiscussionEvent(
                this.deps.ctx,
                repo,
                api,
                payload.merge_request.iid,
                attributes.discussion_id
              )
            } else {
              await this.managers.notes.handleNoteEvent(
                this.deps.ctx,
                repo,
                api,
                payload.merge_request.iid,
                attributes.id,
                'merge_requests'
              )
            }
          }
        }
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab webhook processing failed', { kind, projectId, error: errorMessage(err) })
      }
    }
  }

  /** One loop pass: refresh, due health checks and full syncs, one batch of pending docs. True when docs were processed. */
  async runOnce (): Promise<boolean> {
    await this.refresh()
    await this.healthDue()
    await this.fullSyncDue()
    await this.threadsDue()
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

  async userApi (integration: GitlabIntegration, actor: PersonId): Promise<UserApi | undefined> {
    const own = await this.userRecord(actor)
    if (own === undefined || own.host !== integration.host) return undefined
    return {
      api: this.api(integration.host, own.token),
      user: { id: own.userId, username: own.login, name: own.login, avatar_url: null }
    }
  }

  /** A GitLab image for one viewer, downloaded with their own GitLab token. */
  async gitlabImage (url: string, actor: PersonId): Promise<GitlabImageAccess> {
    return await findGitlabImage(
      this.repositories,
      url,
      async (repository) => await this.userApi(repository.integration, actor)
    )
  }

  async issueTaskType (project: GitlabProject): Promise<IssueTaskType | undefined> {
    return await this.taskTypeOf(project.type, tracker.class.Issue)
  }

  async mergeRequestTaskType (project: GitlabProject): Promise<IssueTaskType | undefined> {
    const found = await this.taskTypeOf(project.type, gitlab.class.GitlabMergeRequest)
    if (found !== undefined) return found
    await this.ensureMergeRequestTaskType(project.type)
    return await this.taskTypeOf(project.type, gitlab.class.GitlabMergeRequest)
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
    return (
      this.deps.createApi?.(host, token) ??
      new GitlabApi(host, token, this.deps.fetchFn, abortableSleep(this.closed.signal))
    )
  }

  private async taskTypeOf (
    projectType: Ref<ProjectType>,
    ofClass: Ref<Class<Task>>
  ): Promise<IssueTaskType | undefined> {
    const key = `${projectType}/${ofClass}`
    const now = this.now()
    const cached = this.taskTypes.get(key)
    if (cached !== undefined && cached.until > now) return cached.value
    const taskType = await this.client.findOne(task.class.TaskType, { parent: projectType, ofClass })
    // Not cached when missing: the merge request task type is added on first use
    if (taskType === undefined) return undefined
    const found = await this.client.findAll(core.class.Status, { _id: { $in: taskType.statuses } })
    const statuses = taskType.statuses
      .map((id) => found.find((it) => it._id === id))
      .filter((it): it is Status => it !== undefined)
    const value = { taskType: taskType._id, statuses }
    this.taskTypes.set(key, { value, until: now + TASK_TYPE_CACHE_MS })
    return value
  }

  private async ensureMergeRequestTaskType (projectType: Ref<ProjectType>): Promise<void> {
    let running = this.ensuringTaskType.get(projectType)
    if (running === undefined) {
      const ensure =
        this.deps.ensureTaskType ??
        (async (client, type, data) => {
          await updateProjectType(client, type, [data])
        })
      running = ensure(this.client, projectType, mergeRequestTaskTypeData()).finally(() => {
        this.ensuringTaskType.delete(projectType)
      })
      this.ensuringTaskType.set(projectType, running)
    }
    await running
  }

  private async track<T> (op: Promise<T>): Promise<T> {
    this.inFlight.add(op)
    const done = (): void => {
      this.inFlight.delete(op)
    }
    void op.then(done, done)
    return await op
  }

  /**
   * Removes the hook of an unlinked repository. Unlinked while this worker watched it: at once. Otherwise (unlinked
   * while the pod was down, or a link in progress, which installs the hook before it links) after a grace period.
   */
  private async cleanUpHook (
    integration: GitlabIntegration | undefined,
    repository: GitlabIntegrationRepository
  ): Promise<void> {
    if (integration === undefined || repository.gitlabProject !== null || repository.hookId === null) {
      this.orphanSince.delete(repository._id)
      return
    }
    if (this.wasEnabled.get(repository._id) !== true) {
      const since = this.orphanSince.get(repository._id)
      if (since === undefined) {
        this.orphanSince.set(repository._id, this.now())
        return
      }
      if (this.now() - since < ORPHAN_HOOK_GRACE_MS) return
    }
    // A failed attempt is tried again after another grace period
    this.orphanSince.set(repository._id, this.now())
    await this.removeHook(integration, repository)
  }

  private reposFor (webUrl: string, projectId: number): RepositoryContext[] {
    return this.repositories.filter(
      (it) => it.repository.projectId === projectId && belongsToHost(webUrl, it.integration.host)
    )
  }

  private async userRecord (person: PersonId): Promise<GitlabUserRecord | undefined> {
    const now = this.now()
    const cached = this.tokens.get(person)
    if (cached !== undefined && cached.until > now) return cached.record
    const generation = this.tokensGeneration
    let record: GitlabUserRecord | undefined
    try {
      record = await this.deps.users.getValidRecord(this.workspace, person)
    } catch (err: unknown) {
      this.deps.ctx.warn('gitlab token unavailable', { error: errorMessage(err) })
    }
    if (generation === this.tokensGeneration) this.tokens.set(person, { record, until: now + TOKEN_CACHE_MS })
    return record
  }

  private async refresh (): Promise<void> {
    const integrations = await this.client.findAll(gitlab.class.GitlabIntegration, {})
    this.integrations = integrations
    const repositories = await this.client.findAll(gitlab.class.GitlabIntegrationRepository, {})
    const projects = await this.client.findAll(gitlab.mixin.GitlabProject, { archived: false })
    const active: RepositoryContext[] = []
    for (const repository of repositories) {
      const integration = integrations.find((it) => it._id === repository.attachedTo)
      const project = projects.find((it) => it._id === repository.gitlabProject)
      const enabled = repository.enabled && !repository.deleted && integration !== undefined && project !== undefined
      if (!enabled) {
        // An unlinked repository's hook would keep firing
        await this.cleanUpHook(integration, repository)
        this.wasEnabled.set(repository._id, false)
        for (const listing of LISTINGS) {
          this.fullSyncFrom.delete(windowKey(repository._id, listing.kind))
          this.firstImport.delete(windowKey(repository._id, listing.kind))
        }
        this.nextFullSync.delete(repository._id)
        this.backoff.delete(repository._id)
        this.nextThreadRefresh.delete(repository._id)
        continue
      }
      const context: RepositoryContext = { integration, repository, project }
      if (this.wasEnabled.get(repository._id) !== true) {
        for (const listing of LISTINGS) {
          const key = windowKey(repository._id, listing.kind)
          const since = await this.storedSince(context, listing.objectClass)
          this.fullSyncFrom.set(key, since)
          if (since === undefined) this.firstImport.add(key)
          else this.firstImport.delete(key)
        }
        this.nextFullSync.set(repository._id, 0)
      }
      this.orphanSince.delete(repository._id)
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
      await removeRepositoryHook(this.client, api, repository)
    } catch (err: unknown) {
      this.deps.ctx.warn('failed to delete gitlab hook', { projectId: repository.projectId, error: errorMessage(err) })
    }
  }

  private async storedSince (repo: RepositoryContext, objectClass: Ref<Class<Doc>>): Promise<number | undefined> {
    const [latest] = await this.derived.findAll(
      gitlab.class.DocSyncInfo,
      { repository: repo.repository._id, objectClass, lastModified: { $exists: true } },
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
        // The health job marks the integration
        this.backoffFullSync(id, start + FAILED_FULL_SYNC_RETRY_MS, 0)
        continue
      }
      try {
        await this.requeueRetryable(repo)
        for (const listing of LISTINGS) {
          if (this.closing) return
          await this.fullSyncListing(repo, api, listing.kind, start)
        }
        this.nextFullSync.set(id, start + FULL_SYNC_INTERVAL_MS)
        this.backoff.delete(id)
      } catch (err: unknown) {
        this.deps.ctx.error('gitlab full sync failed', {
          repository: repo.repository.pathWithNamespace,
          error: errorMessage(err)
        })
        // A rate limit says when GitLab answers again; a far-off reset waits no longer than a regular full sync
        const resetAt = err instanceof GitlabApiError ? err.retryAt : undefined
        const retryAt = resetAt === undefined ? 0 : Math.min(resetAt, start + FULL_SYNC_INTERVAL_MS)
        this.backoffFullSync(id, Math.max(start + FAILED_FULL_SYNC_RETRY_MS, retryAt), retryAt)
      }
    }
  }

  private backoffFullSync (id: Ref<GitlabIntegrationRepository>, failed: number, rateLimited: number): void {
    this.nextFullSync.set(id, failed)
    this.backoff.set(id, { failed, rateLimited })
  }

  private async fullSyncListing (
    repo: RepositoryContext,
    api: GitlabApi,
    kind: GitlabNoteable,
    start: number
  ): Promise<void> {
    const key = windowKey(repo.repository._id, kind)
    const from = this.fullSyncFrom.get(key)
    const since = from === undefined ? undefined : new Date(from - SINCE_MARGIN_MS).toISOString()
    const projectId = repo.repository.projectId
    const ctx = this.deps.ctx
    const firstImport = this.firstImport.has(key)
    // The listing is oldest first: after each item the window moves to it, so a failure resumes there
    const checkpoint = (updatedAt: string): void => {
      const at = Date.parse(updatedAt)
      const current = this.fullSyncFrom.get(key)
      if (Number.isFinite(at) && (current === undefined || at > current)) this.fullSyncFrom.set(key, at)
    }
    if (kind === 'issues') {
      for await (const page of api.listIssuePages(projectId, since)) {
        for (const issue of page) {
          if (this.closing) return
          await this.managers.issues.receive(ctx, repo, issue)
          await this.managers.notes.refreshNotes(ctx, repo, api, issue, 'issues', { skipIfListed: true })
          checkpoint(issue.updated_at)
        }
      }
    } else {
      const listed = new Set<number>()
      for await (const page of api.listMergeRequestPages(projectId, since)) {
        for (const mr of page) {
          if (this.closing) return
          await this.managers.mergeRequests.receive(ctx, repo, mr)
          await this.managers.notes.refreshNotes(ctx, repo, api, mr, 'merge_requests', { skipIfListed: true })
          // Old history on the first import: no discussion listing; a later event of the merge request loads them
          if (!firstImport || !isHistorical(mr, this.now())) {
            await this.managers.threads.refreshDiscussions(ctx, repo, api, mr.iid)
          }
          listed.add(mr.iid)
          checkpoint(mr.updated_at)
        }
      }
      // Approvals and resolved threads change no updated_at
      for (const iid of await this.managers.mergeRequests.requeueOpen(repo)) {
        if (this.closing) return
        if (!listed.has(iid)) await this.managers.threads.refreshDiscussions(ctx, repo, api, iid)
      }
    }
    this.fullSyncFrom.set(key, start)
    this.firstImport.delete(key)
  }

  /** Lists the discussions of open merge requests with an unresolved thread again. */
  private async threadsDue (): Promise<void> {
    for (const repo of this.repositories) {
      if (this.closing) return
      const id = repo.repository._id
      const now = this.now()
      const next = this.nextThreadRefresh.get(id)
      this.nextThreadRefresh.set(id, next === undefined || next <= now ? now + THREAD_REFRESH_MS : next)
      // First pass after the repository appeared: its full sync has just listed the discussions
      if (next === undefined || next > now) continue
      const api = await this.integrationApi(repo.integration)
      if (api === undefined) continue
      try {
        for (const iid of await this.openWithUnresolvedThreads(repo)) {
          if (this.closing) return
          await this.managers.threads.refreshDiscussions(this.deps.ctx, repo, api, iid)
        }
      } catch (err: unknown) {
        this.deps.ctx.warn('gitlab thread refresh failed', {
          repository: repo.repository.pathWithNamespace,
          error: errorMessage(err)
        })
      }
    }
  }

  private async openWithUnresolvedThreads (repo: RepositoryContext): Promise<number[]> {
    const threads = await this.derived.findAll(gitlab.class.DocSyncInfo, {
      repository: repo.repository._id,
      objectClass: gitlab.class.GitlabReviewThread
    })
    const parents = new Set<string>()
    for (const thread of threads) {
      const external = thread.external as { resolved?: boolean } | undefined
      if (thread.deleted !== true && thread.parent !== undefined && external?.resolved === false) {
        parents.add(thread.parent)
      }
    }
    if (parents.size === 0) return []
    const infos = await this.derived.findAll(gitlab.class.DocSyncInfo, {
      space: repo.project._id,
      key: { $in: [...parents] }
    })
    const iids: number[] = []
    for (const info of infos) {
      const external = info.external as GitlabMergeRequestInfo | undefined
      if (info.deleted !== true && external !== undefined && mergeRequestSyncState(external.state) === 'opened') {
        iids.push(info.gitlabIid)
      }
    }
    return iids
  }

  /** The health job; the only writer of alive and error in the worker. */
  private async healthDue (): Promise<void> {
    for (const integration of this.integrations) {
      if (this.closing) return
      const now = this.now()
      if ((this.nextHealth.get(integration._id) ?? 0) > now) continue
      const healthy = await this.checkHealth(integration)
      this.nextHealth.set(integration._id, now + (healthy ? HEALTH_INTERVAL_MS : HEALTH_RETRY_MS))
    }
  }

  private async checkHealth (integration: GitlabIntegration): Promise<boolean> {
    let record: GitlabUserRecord | undefined
    try {
      // Not the cached lookup: that one turns an unreachable token store into "no token"
      record = await this.deps.users.getValidRecord(this.workspace, integration.connectedBy)
    } catch (err: unknown) {
      // Account service or token refresh trouble says nothing about the token: alive and error stay as they are
      this.deps.ctx.warn('gitlab health check skipped, token unavailable', {
        login: integration.login,
        error: errorMessage(err)
      })
      return false
    }
    if (record === undefined) {
      await this.setHealth(integration, false, EXPIRED_ERROR)
      return false
    }
    const api = this.api(integration.host, record.token)
    try {
      await api.getCurrentUser()
    } catch (err: unknown) {
      if (err instanceof GitlabApiError && err.status === 401) {
        await this.setHealth(integration, false, EXPIRED_ERROR)
      } else {
        // Network or GitLab trouble says nothing about the token: alive and error stay as they are
        this.deps.ctx.warn('gitlab health check failed', { login: integration.login, error: errorMessage(err) })
      }
      return false
    }
    await this.setHealth(integration, true, null)
    try {
      for (const change of await refreshIntegrationRepositories(this.client, api, integration)) {
        this.deps.ctx.info('gitlab project moved, links rewritten', { from: change.from, to: change.to })
      }
    } catch (err: unknown) {
      this.deps.ctx.warn('gitlab repository refresh failed', { login: integration.login, error: errorMessage(err) })
      return false
    }
    await this.checkHooks(integration, api)
    return true
  }

  private async setHealth (integration: GitlabIntegration, alive: boolean, error: string | null): Promise<void> {
    if (integration.alive === alive && (integration.error ?? null) === error) return
    await this.client.update(integration, { alive, error })
  }

  /**
   * Once per pod start per linked repository: the hook is at its scoped URL with the current derived secret. A hook
   * deleted in GitLab by hand comes back the same way.
   */
  private async checkHooks (integration: GitlabIntegration, api: GitlabApi): Promise<void> {
    const hooks = this.deps.hooks
    if (hooks === undefined) return
    const target = { workspace: this.workspace, integration: integration._id }
    const linked = await this.client.findAll(gitlab.class.GitlabIntegrationRepository, {
      attachedTo: integration._id,
      enabled: true,
      deleted: false
    })
    for (const repository of linked) {
      if (repository.gitlabProject === null || this.hooksChecked.has(repository._id)) continue
      try {
        await ensureRepositoryHook(this.client, api, repository, hooks, target)
        this.hooksChecked.add(repository._id)
      } catch (err: unknown) {
        // Tried again at the next health run; managing hooks needs Maintainer access
        this.deps.ctx.warn('gitlab hook not checked', { projectId: repository.projectId, error: errorMessage(err) })
      }
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
      {
        needSync: { $ne: GITLAB_SYNC_VERSION },
        space: { $in: projects },
        repository: { $in: [null, ...repositories] }
      },
      { limit: SYNC_BATCH_SIZE }
    )
    if (docs.length === 0) return false
    // A parent must exist on both sides before its children (threads before their comments)
    const ordered = [...docs].sort((a, b) => syncRank(a.objectClass) - syncRank(b.objectClass))
    for (const info of ordered) {
      if (this.closing) break
      await this.syncDoc(info)
    }
    return true
  }

  private mapperFor (objectClass: string): DocSyncManager | undefined {
    if (objectClass === tracker.class.Issue) return this.managers.issues
    if (objectClass === chunter.class.ChatMessage) return this.managers.notes
    if (objectClass === gitlab.class.GitlabMergeRequest) return this.managers.mergeRequests
    if (objectClass === gitlab.class.GitlabReview) return this.managers.reviews
    if (objectClass === gitlab.class.GitlabReviewThread) return this.managers.threads
    if (objectClass === gitlab.class.GitlabReviewComment) return this.managers.comments
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
  private async withoutStaleExternal (
    info: DocSyncInfo,
    update: DocumentUpdate<DocSyncInfo>
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const fresh = await this.derived.findOne(gitlab.class.DocSyncInfo, { _id: info._id })
    const seen = update.lastModified ?? info.lastModified ?? 0
    if (fresh?.lastModified === undefined || fresh.lastModified <= seen) return update
    const { needSync, external, lastModified, ...rest } = update
    return rest
  }

  private async syncDoc (queued: DocSyncInfo): Promise<void> {
    let info = queued
    const ctx = this.deps.ctx
    const mapper = this.mapperFor(info.objectClass)
    let existing: Doc | undefined
    try {
      if (mapper === undefined) {
        await this.derived.update(info, { needSync: GITLAB_SYNC_VERSION })
        return
      }
      if (info.deleted === true) {
        // Handled under an older sync version: a version bump re-renders documents, it does not replay deletions
        if (info.needSync !== '') {
          await this.derived.update(info, { needSync: GITLAB_SYNC_VERSION })
          return
        }
        if (await mapper.handleDelete(ctx, info)) {
          await this.derived.remove(info)
        } else {
          await this.derived.update(info, { needSync: GITLAB_SYNC_VERSION })
        }
        return
      }
      existing = await this.client.findOne(info.objectClass, { _id: info._id })
      if (existing !== undefined && existing.space !== info.space) {
        const fresh = await this.derived.findOne(gitlab.class.DocSyncInfo, { _id: info._id })
        // Removed meanwhile by its parent's move
        if (fresh === undefined) return
        if (fresh.space !== existing.space) {
          if (mapper.handleMove !== undefined) {
            await mapper.handleMove(ctx, existing, fresh)
          } else {
            await this.derived.update(fresh, { needSync: GITLAB_SYNC_VERSION, error: MOVED_ERROR, retryable: false })
          }
          return
        }
        // Moved along with its parent earlier in this batch
        info = fresh
      }
      const update = await mapper.sync(ctx, existing, info, await this.parentOf(info))
      await this.derived.update(info, await this.withoutStaleExternal(info, update))
      await this.showError(existing, update.error)
    } catch (err: unknown) {
      // Closing ended the sync (a 429 wait): the doc stays pending and the next worker resumes it
      if (this.closed.signal.aborted) {
        ctx.info('gitlab sync stopped by close', { _id: info._id, objectClass: info.objectClass })
        return
      }
      ctx.error('gitlab sync failed', {
        _id: info._id,
        objectClass: info.objectClass,
        error: errorMessage(err),
        detail: err instanceof GitlabApiError ? err.detail : undefined
      })
      await this.derived.update(info, {
        needSync: GITLAB_SYNC_VERSION,
        error: errorMessage(err),
        retryable: !isPermanentError(err)
      })
      try {
        await this.showError(existing, errorMessage(err))
      } catch (showErr: unknown) {
        ctx.warn('gitlab sync error not shown', { _id: info._id, error: errorMessage(showErr) })
      }
    }
  }

  /** Shows a document's sync error in the browser: DocSyncInfo reaches the GitLab service only. */
  private async showError (doc: Doc | undefined, error: string | null | undefined): Promise<void> {
    if (doc === undefined || error === undefined) return
    const { client } = this
    if (doc._class === gitlab.class.GitlabMergeRequest) {
      const mr = doc as GitlabMergeRequest
      if ((mr.syncError ?? null) !== error) await client.update(mr, { syncError: error })
      return
    }
    if (doc._class === gitlab.class.GitlabReview) {
      const review = doc as GitlabReview
      if ((review.syncError ?? null) !== error) await client.update(review, { syncError: error })
      return
    }
    const h = client.getHierarchy()
    if (!h.isDerived(doc._class, tracker.class.Issue)) return
    const issue = doc as Issue
    if (h.hasMixin(issue, gitlab.mixin.GitlabIssue)) {
      if ((h.as(issue, gitlab.mixin.GitlabIssue).syncError ?? null) === error) return
      await client.updateMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, { syncError: error })
    } else if (error !== null) {
      // Only the error: `repository` stays undefined, which means "nothing picked"
      const data = { syncError: error } as unknown as MixinData<Issue, GitlabIssue>
      await client.createMixin<Issue, GitlabIssue>(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, data)
    }
  }
}
