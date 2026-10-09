// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import chunter from '@hcengineering/chunter'
import type { Person } from '@hcengineering/contact'
import core, {
  type AttachedData,
  type Doc,
  type DocumentQuery,
  type DocumentUpdate,
  generateId,
  type Hyperlink,
  makeCollabId,
  makeCollabJsonId,
  makeDocCollabId,
  type Markup,
  type MeasureContext,
  type PersonId,
  type Ref,
  type Status
} from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabProject } from '@hcengineering/gitlab'
import { areEqualMarkups } from '@hcengineering/text'
import tracker, { type Issue, type IssueStatus } from '@hcengineering/tracker'
import { type GitlabApi, GitlabApiError } from '../gitlab/api'
import type { GitlabIssueInfo, GitlabIssueInput, GitlabIssueState, GitlabNoteInfo } from '../gitlab/types'
import { hostKey, issueKey, noteKey, repositoryLockKey } from './keys'
import { compareMarkdown, mergeFields } from './merge'
import { isSyncedNote, pairMovedNotes } from './notes'
import { stateOfStatus, statusForState } from './status'
import { allocateIssueNumber, assigneeIdsFor, emptyIssueFields } from './tracker'
import type { DocSyncManager, RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION } from './versions'

/** The issue fields kept in sync; `current` in DocSyncInfo holds the last agreed snapshot. */
export interface IssueSnapshot {
  title: string
  description: Markup
  assignee: Ref<Person> | null
  state: GitlabIssueState
}

const DONE: DocumentUpdate<DocSyncInfo> = { needSync: GITLAB_SYNC_VERSION }

export class IssueSyncManager implements DocSyncManager {
  constructor (private readonly provider: SyncProvider) {}

  /** Fetches the issue a webhook names and stores it for the sync loop. A 404 (deleted, or no access) is ignored. */
  async handleIssueEvent (ctx: MeasureContext, repo: RepositoryContext, api: GitlabApi, iid: number, actor?: PersonId): Promise<void> {
    const key = issueKey(repo.integration.host, repo.repository.projectId, iid)
    await this.provider.runner.exec(repositoryLockKey(repo.repository._id), async () => {
      await this.provider.runner.exec(key, async () => {
        let issue: GitlabIssueInfo
        try {
          issue = await api.getIssue(repo.repository.projectId, iid)
        } catch (err: unknown) {
          if (err instanceof GitlabApiError && err.status === 404) {
            ctx.info('gitlab issue from webhook not found', { projectId: repo.repository.projectId, iid })
            return
          }
          throw err
        }
        await this.upsertExternal(ctx, repo, issue, actor)
      })
    })
  }

  /** Stores an issue from a listing; waits for issue creation in progress in the same repository. */
  async receive (ctx: MeasureContext, repo: RepositoryContext, issue: GitlabIssueInfo): Promise<void> {
    const key = issueKey(repo.integration.host, repo.repository.projectId, issue.iid)
    await this.provider.runner.exec(repositoryLockKey(repo.repository._id), async () => {
      await this.provider.runner.exec(key, async () => {
        await this.upsertExternal(ctx, repo, issue)
      })
    })
  }

  private async upsertExternal (ctx: MeasureContext, repo: RepositoryContext, issue: GitlabIssueInfo, actor?: PersonId): Promise<void> {
    if (issue.confidential) {
      ctx.info('gitlab confidential issue skipped', { projectId: repo.repository.projectId, iid: issue.iid })
      return
    }
    const { derived } = this.provider
    const key = issueKey(repo.integration.host, repo.repository.projectId, issue.iid)
    const lastModified = Date.parse(issue.updated_at)
    const info = await derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key })
    // Closed by Huly (deletion or move out): the tombstone keeps it from coming back
    if (info?.deleted === true) return
    // The closed original GitLab leaves after a move: never imported
    if (info === undefined && issue.moved_to_id != null) {
      ctx.info('gitlab issue moved to another project skipped', { projectId: repo.repository.projectId, iid: issue.iid })
      return
    }
    if (info === undefined) {
      await derived.createDoc(gitlab.class.DocSyncInfo, repo.project._id, {
        key,
        objectClass: tracker.class.Issue,
        repository: repo.repository._id,
        gitlabIid: issue.iid,
        external: issue,
        needSync: '',
        lastModified,
        lastGitlabUser: actor ?? null
      })
    } else {
      const stored = info.external as GitlabIssueInfo | undefined
      // Same or older version: our own write coming back, or an out-of-order event
      if (stored !== undefined && Date.parse(stored.updated_at) >= lastModified && info.repository === repo.repository._id) {
        return
      }
      await derived.update(info, {
        external: issue,
        needSync: '',
        lastModified,
        repository: repo.repository._id,
        lastGitlabUser: actor ?? null,
        error: null
      })
    }
    this.provider.triggerSync()
  }

  async sync (
    ctx: MeasureContext,
    existing: Doc | undefined,
    info: DocSyncInfo,
    _parent?: DocSyncInfo
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    if (info.key === '') {
      return await this.createInGitlab(ctx, existing as Issue | undefined, info)
    }
    const repo = this.provider.repositoryContext(info.repository)
    const external = info.external as GitlabIssueInfo | undefined
    if (repo === undefined || external === undefined) return DONE
    if (existing === undefined) {
      return await this.createInHuly(repo, info, external)
    }
    return await this.mergeExisting(ctx, repo, existing as Issue, info, external)
  }

  async handleDelete (ctx: MeasureContext, info: DocSyncInfo): Promise<boolean> {
    const repo = this.provider.repositoryContext(info.repository)
    if (repo !== undefined && (await this.closeInGitlab(info, repo))) {
      ctx.info('gitlab issue closed after its Huly issue was deleted', { key: info.key })
    }
    // Only its comments: sub-issues are attached to their parent too, and are deleted (or kept) on their own
    await this.removeChildren({ attachedTo: info._id, objectClass: chunter.class.ChatMessage })
    if (info.key === '') return true
    await this.removeChildren({ parent: info.key })
    // Kept as a tombstone: the close comes back as a GitLab event and must not import the issue again
    return false
  }

  /** Closes the GitLab issue of a sync doc; maintainers cannot delete GitLab issues. True when it was open. */
  private async closeInGitlab (info: DocSyncInfo, repo: RepositoryContext): Promise<boolean> {
    const external = info.external as GitlabIssueInfo | undefined
    if (external === undefined || external.state === 'closed') return false
    const api = await this.provider.integrationApi(repo.integration)
    if (api === undefined) {
      throw new Error('GitLab authorization expired')
    }
    try {
      await api.updateIssue(repo.repository.projectId, external.iid, { state_event: 'close' })
    } catch (err: unknown) {
      if (!(err instanceof GitlabApiError && err.status === 404)) throw err
    }
    return true
  }

  /**
   * A Huly issue moved to another project. The GitLab issue follows it into the new project's only
   * repository on the same host. Otherwise the GitLab issue is closed and the Huly issue stays in Huly only. Writes the
   * sync docs itself.
   */
  async handleMove (ctx: MeasureContext, existing: Doc, info: DocSyncInfo): Promise<void> {
    const issue = existing as Issue
    if (info.key === '') {
      // Not in GitLab yet: created where the issue is now
      await this.dropStalePick(issue)
      await this.provider.derived.update(info, { space: issue.space, repository: null, needSync: '', error: null })
      this.provider.triggerSync()
      return
    }
    const source = this.provider.repositoryContext(info.repository)
    const target = source === undefined ? undefined : this.moveTarget(issue, source)
    const external = info.external as GitlabIssueInfo | undefined
    if (source !== undefined && target !== undefined && external !== undefined) {
      await this.moveInGitlab(ctx, issue, info, external, source, target)
    } else {
      await this.detach(ctx, issue, info, source)
    }
  }

  /**
   * A repository picked in the old project names no target in the new one: the new project's only repository takes
   * over; otherwise null, and the header offers the picker again.
   */
  private async dropStalePick (issue: Issue): Promise<void> {
    const h = this.provider.client.getHierarchy()
    if (!h.hasMixin(issue, gitlab.mixin.GitlabIssue)) return
    const picked = h.as(issue, gitlab.mixin.GitlabIssue).repository
    if (picked == null || this.provider.repositoryContext(picked)?.project._id === issue.space) return
    const candidates = this.provider.projectRepositories(issue.space as Ref<GitlabProject>)
    const repository = candidates.length === 1 ? candidates[0].repository._id : null
    await this.provider.client.updateMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, { repository, syncError: null })
  }

  private moveTarget (issue: Issue, source: RepositoryContext): RepositoryContext | undefined {
    const host = hostKey(source.integration.host)
    const candidates = this.provider
      .projectRepositories(issue.space as Ref<GitlabProject>)
      .filter((it) => hostKey(it.integration.host) === host)
    return candidates.length === 1 ? candidates[0] : undefined
  }

  private async moveInGitlab (
    ctx: MeasureContext,
    issue: Issue,
    info: DocSyncInfo,
    external: GitlabIssueInfo,
    source: RepositoryContext,
    target: RepositoryContext
  ): Promise<void> {
    const api = await this.provider.apiFor(source.integration, issue.modifiedBy)
    if (api === undefined) {
      throw new Error('GitLab authorization expired')
    }
    const oldKey = info.key
    const { runner } = this.provider
    // The locks of the original issue's webhooks first (repository, then key, as they take them): its "closed" event
    // must not read the sync doc before the move rewrote it
    await runner.exec(repositoryLockKey(source.repository._id), async () => {
      await runner.exec(oldKey, async () => {
        await this.moveLocked(ctx, api, issue, info, external, source, target)
      })
    })
  }

  private async moveLocked (
    ctx: MeasureContext,
    api: GitlabApi,
    issue: Issue,
    info: DocSyncInfo,
    external: GitlabIssueInfo,
    source: RepositoryContext,
    target: RepositoryContext
  ): Promise<void> {
    const oldKey = info.key
    // The target lock also covers the note re-keying: events for the copies wait until their sync docs exist
    await this.provider.runner.exec(repositoryLockKey(target.repository._id), async () => {
      const result = await api.moveIssue(source.repository.projectId, external.iid, target.repository.projectId)
      // Stored before the lock is released: the webhook for the new GitLab issue finds it instead of importing a copy
      await this.provider.derived.update(info, {
        space: issue.space,
        key: issueKey(target.integration.host, target.repository.projectId, result.iid),
        repository: target.repository._id,
        gitlabIid: result.iid,
        external: result,
        lastModified: Date.parse(result.updated_at),
        needSync: GITLAB_SYNC_VERSION,
        error: null,
        retryable: false
      })
      const { client } = this.provider
      const link = { url: result.web_url as Hyperlink, gitlabIid: result.iid, repository: target.repository._id, syncError: null }
      if (client.getHierarchy().hasMixin(issue, gitlab.mixin.GitlabIssue)) {
        await client.updateMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, link)
      } else {
        await client.createMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, link)
      }
      await this.moveNotes(ctx, api, issue, oldKey, target, result)
      ctx.info('gitlab issue moved with its Huly issue', { from: oldKey, iid: result.iid })
    })
  }

  /** Points the sync docs of the issue's comments at the copies GitLab made. */
  private async moveNotes (
    ctx: MeasureContext,
    api: GitlabApi,
    issue: Issue,
    oldKey: string,
    target: RepositoryContext,
    moved: GitlabIssueInfo
  ): Promise<void> {
    const { derived } = this.provider
    const newKey = issueKey(target.integration.host, target.repository.projectId, moved.iid)
    const synced = await derived.findAll(gitlab.class.DocSyncInfo, { parent: oldKey, objectClass: chunter.class.ChatMessage })
    const known = synced.flatMap((it) => (it.external === undefined ? [] : [{ id: it._id as string, note: it.external as GitlabNoteInfo }]))
    const copies = known.length === 0 ? [] : (await api.listIssueNotes(target.repository.projectId, moved.iid)).filter(isSyncedNote)
    const pairs = pairMovedNotes(known, copies)
    for (const info of synced) {
      const copy = pairs.get(info._id)
      if (copy === undefined) {
        // No copy found: the Huly comment stays, no longer synchronized
        await derived.remove(info)
        continue
      }
      await derived.update(info, {
        space: issue.space,
        parent: newKey,
        key: noteKey(newKey, copy.id),
        repository: target.repository._id,
        external: copy,
        lastModified: Date.parse(copy.updated_at),
        needSync: GITLAB_SYNC_VERSION,
        error: null,
        retryable: false
      })
    }
    // Comments not in GitLab yet go to the moved issue
    for (const info of await derived.findAll(gitlab.class.DocSyncInfo, { attachedTo: issue._id, objectClass: chunter.class.ChatMessage, key: '' })) {
      await derived.update(info, { space: issue.space, needSync: '', error: null })
    }
    if (pairs.size < known.length) {
      ctx.warn('gitlab notes without a copy after an issue move', { key: newKey, unpaired: known.length - pairs.size })
    }
    this.provider.triggerSync()
  }

  /** No single repository on this host in the new project: GitLab closes the issue, Huly keeps it unlinked. */
  private async detach (ctx: MeasureContext, issue: Issue, info: DocSyncInfo, source: RepositoryContext | undefined): Promise<void> {
    if (source !== undefined) await this.closeInGitlab(info, source)
    await this.removeChildren({ attachedTo: info._id, objectClass: chunter.class.ChatMessage })
    await this.removeChildren({ parent: info.key })
    await this.provider.derived.remove(info)
    // The Huly issue keeps its _id for a later "Create in GitLab"; a separate tombstone keeps the closed GitLab issue
    // from being imported back into the old project
    await this.provider.derived.createDoc(
      gitlab.class.DocSyncInfo,
      info.space,
      {
        key: info.key,
        objectClass: tracker.class.Issue,
        repository: info.repository,
        gitlabIid: info.gitlabIid,
        needSync: GITLAB_SYNC_VERSION,
        deleted: true
      },
      generateId<DocSyncInfo>()
    )
    const { client } = this.provider
    // repository null: kept in Huly on purpose; the header offers "Create in GitLab" in a linked project
    const data = { url: '' as Hyperlink, gitlabIid: 0, repository: null, syncError: null }
    if (client.getHierarchy().hasMixin(issue, gitlab.mixin.GitlabIssue)) {
      await client.updateMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, data)
    } else {
      await client.createMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, data)
    }
    ctx.info('gitlab issue closed, its Huly issue moved to a project without its repository', { key: info.key })
  }

  private async createInGitlab (ctx: MeasureContext, issue: Issue | undefined, info: DocSyncInfo): Promise<DocumentUpdate<DocSyncInfo>> {
    if (issue === undefined) return DONE
    const repo = this.targetRepository(issue)
    if (repo === undefined) {
      ctx.info('gitlab: issue stays in Huly, no single target repository', { issue: issue.identifier })
      return DONE
    }
    const api = await this.provider.apiFor(repo.integration, issue.modifiedBy)
    if (api === undefined) {
      return { ...DONE, error: 'GitLab authorization expired', retryable: true }
    }
    const statuses = (await this.provider.issueTaskType(repo.project))?.statuses ?? []
    const platform = await this.platformSnapshot(issue, statuses, 'opened')
    const input: GitlabIssueInput = { title: platform.title, description: await this.provider.content.toMarkdown(repo, platform.description) }
    const assigneeId = await this.provider.persons.gitlabUserIdFor(platform.assignee, repo.integration.host)
    if (assigneeId !== undefined) {
      input.assignee_ids = [assigneeId]
    }
    const projectId = repo.repository.projectId
    return await this.provider.runner.exec(repositoryLockKey(repo.repository._id), async () => {
      let created = await api.createIssue(projectId, input)
      // An assignee GitLab could not take is recorded as unassigned, so the next merge does not undo it in Huly
      const agreed: IssueSnapshot = { ...platform, assignee: assigneeId !== undefined ? platform.assignee : null, state: created.state }
      const update: DocumentUpdate<DocSyncInfo> = {
        key: issueKey(repo.integration.host, projectId, created.iid),
        repository: repo.repository._id,
        gitlabIid: created.iid,
        external: created,
        current: agreed,
        lastModified: Date.parse(created.updated_at),
        needSync: GITLAB_SYNC_VERSION,
        error: null
      }
      // Stored right after creation and before the lock is released: the webhook for this issue finds it instead of
      // importing a copy, and a failure below is retried as an ordinary update instead of creating the issue again
      await this.provider.derived.update(info, update)
      await this.linkIssue(issue, repo, created)
      await this.requeueChildren({ attachedTo: issue._id, objectClass: chunter.class.ChatMessage })
      if (platform.state === 'closed' && created.state !== 'closed') {
        created = await api.updateIssue(projectId, created.iid, { state_event: 'close' })
        const closed: DocumentUpdate<DocSyncInfo> = {
          external: created,
          current: { ...agreed, state: created.state },
          lastModified: Date.parse(created.updated_at)
        }
        await this.provider.derived.update(info, closed)
        Object.assign(update, closed)
      }
      return update
    })
  }

  private async createInHuly (repo: RepositoryContext, info: DocSyncInfo, external: GitlabIssueInfo): Promise<DocumentUpdate<DocSyncInfo>> {
    const type = await this.provider.issueTaskType(repo.project)
    if (type === undefined) {
      return { ...DONE, error: 'The Huly project has no issue task type', retryable: false }
    }
    const { client, collaborator, persons } = this.provider
    const snapshot = await this.externalSnapshot(repo, external)
    const author = await persons.personIdFor(repo.integration.host, external.author)
    const status = statusForState(external.state, false, type.statuses) as Ref<IssueStatus>
    const { number, rank, identifier } = await allocateIssueNumber(client, repo.project)
    const issueId = info._id as unknown as Ref<Issue>
    const collabId = makeCollabId(tracker.class.Issue, issueId, 'description')
    await collaborator.updateMarkup(collabId, snapshot.description)
    const value: AttachedData<Issue> = {
      ...emptyIssueFields(),
      title: snapshot.title,
      description: makeCollabJsonId(collabId),
      assignee: snapshot.assignee,
      status,
      kind: type.taskType,
      number,
      rank,
      identifier
    }
    await client.addCollection(
      tracker.class.Issue,
      repo.project._id,
      tracker.ids.NoParent,
      tracker.class.Issue,
      'subIssues',
      value,
      issueId,
      Date.parse(external.created_at),
      author
    )
    const created = await client.findOne(tracker.class.Issue, { _id: issueId })
    if (created !== undefined) {
      await this.linkIssue(created, repo, external)
    }
    // Notes that arrived before their issue can now be created
    await this.requeueChildren({ parent: info.key })
    return { ...DONE, current: snapshot, error: null }
  }

  private async mergeExisting (
    ctx: MeasureContext,
    repo: RepositoryContext,
    issue: Issue,
    info: DocSyncInfo,
    external: GitlabIssueInfo
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const statuses = (await this.provider.issueTaskType(repo.project))?.statuses ?? []
    const remote = await this.externalSnapshot(repo, external)
    const base = (info.current as IssueSnapshot | undefined) ?? remote
    const platform = await this.platformSnapshot(issue, statuses, base.state)
    const { toPlatform, toGitlab, conflicts, merged } = mergeFields(base, platform, remote, { description: areEqualMarkups })
    if (conflicts.length > 0) {
      ctx.warn('GitLab and Huly both changed an issue, keeping the Huly value', { issue: issue.identifier, fields: conflicts })
    }
    // GitLab still shows Huly image links (written before images were copied, or after a failed upload): send the
    // description again, its images are uploaded now. toGitlabInput skips it when nothing changes.
    if (toGitlab.description === undefined && this.provider.content.hasHulyImages(external.description)) {
      toGitlab.description = merged.description
    }
    let latest = external
    const input = await this.toGitlabInput(repo, toGitlab, external)
    if (toGitlab.assignee !== undefined && input.assignee_ids === undefined) {
      // Not pushable (no GitLab identity on this host): keep it in Huly, and record what GitLab holds as the base,
      // so the next merge sees a Huly-only change again instead of GitLab "removing" the assignee.
      merged.assignee = remote.assignee
    }
    if (Object.keys(input).length > 0) {
      const api = await this.provider.apiFor(repo.integration, issue.modifiedBy)
      if (api === undefined) {
        return { ...DONE, error: 'GitLab authorization expired', retryable: true }
      }
      latest = await this.provider.runner.exec(info.key, async () => {
        const updated = await api.updateIssue(repo.repository.projectId, external.iid, input)
        // Stored inside the lock, so the webhook echo of this write is recognised
        await this.provider.derived.update(info, { external: updated, current: merged, lastModified: Date.parse(updated.updated_at) })
        return updated
      })
    }
    if (Object.keys(toPlatform).length > 0) {
      await this.applyToHuly(issue, toPlatform, statuses, info.lastGitlabUser ?? core.account.System)
    }
    return { ...DONE, current: merged, external: latest, lastModified: Date.parse(latest.updated_at), error: null }
  }

  private targetRepository (issue: Issue): RepositoryContext | undefined {
    const h = this.provider.client.getHierarchy()
    const picked = h.hasMixin(issue, gitlab.mixin.GitlabIssue) ? h.as(issue, gitlab.mixin.GitlabIssue).repository : undefined
    if (picked !== undefined) {
      // null: kept in Huly on purpose. A repository of another project (stale pick, moved issue) is no target either.
      const context = this.provider.repositoryContext(picked)
      return context?.project._id === issue.space ? context : undefined
    }
    // Nothing picked (no mixin, or one that only carries syncError): the only linked repository
    const candidates = this.provider.projectRepositories(issue.space as Ref<GitlabProject>)
    return candidates.length === 1 ? candidates[0] : undefined
  }

  private async platformSnapshot (issue: Issue, statuses: Status[], fallback: GitlabIssueState): Promise<IssueSnapshot> {
    const description = await this.provider.collaborator.getMarkup(makeDocCollabId(issue, 'description'), issue.description)
    return {
      title: issue.title,
      description,
      assignee: issue.assignee,
      state: stateOfStatus(issue.status, statuses) ?? fallback
    }
  }

  private async externalSnapshot (repo: RepositoryContext, external: GitlabIssueInfo): Promise<IssueSnapshot> {
    return {
      title: external.title,
      description: await this.provider.content.toMarkup(repo, external.description),
      assignee: await this.provider.persons.personRefFor(repo.integration.host, external.assignees[0]),
      state: external.state
    }
  }

  private async toGitlabInput (repo: RepositoryContext, change: Partial<IssueSnapshot>, external: GitlabIssueInfo): Promise<GitlabIssueInput> {
    const input: GitlabIssueInput = {}
    if (change.title !== undefined && change.title !== external.title) {
      input.title = change.title
    }
    if (change.description !== undefined) {
      const markdown = await this.provider.content.toMarkdown(repo, change.description)
      if (!compareMarkdown(markdown, external.description ?? '')) input.description = markdown
    }
    if (change.assignee !== undefined) {
      const ids = await assigneeIdsFor(this.provider.persons, repo.integration.host, change.assignee, external.assignees)
      if (ids !== undefined) input.assignee_ids = ids
    }
    if (change.state !== undefined && change.state !== external.state) {
      input.state_event = change.state === 'closed' ? 'close' : 'reopen'
    }
    return input
  }

  private async applyToHuly (issue: Issue, change: Partial<IssueSnapshot>, statuses: Status[], actor: PersonId): Promise<void> {
    const update: DocumentUpdate<Issue> = {}
    if (change.title !== undefined) update.title = change.title
    if (change.assignee !== undefined) update.assignee = change.assignee
    if (change.state !== undefined && stateOfStatus(issue.status, statuses) !== change.state) {
      // Only a change between open and closed moves the status; a Canceled issue stays Canceled when GitLab closes it
      update.status = statusForState(change.state, change.state === 'opened', statuses) as Ref<IssueStatus>
    }
    if (change.description !== undefined) {
      await this.provider.collaborator.updateMarkup(makeDocCollabId(issue, 'description'), change.description)
    }
    if (Object.keys(update).length > 0) {
      await this.provider.client.update(issue, update, false, Date.now(), actor)
    }
  }

  private async linkIssue (issue: Issue, repo: RepositoryContext, external: GitlabIssueInfo): Promise<void> {
    const { client } = this.provider
    const data = { url: external.web_url as Hyperlink, gitlabIid: external.iid, repository: repo.repository._id }
    if (client.getHierarchy().hasMixin(issue, gitlab.mixin.GitlabIssue)) {
      await client.updateMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, data)
    } else {
      await client.createMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, data)
    }
    await client.addCollection(activity.class.ActivityInfoMessage, issue.space, issue._id, issue._class, 'activity', {
      message: gitlab.string.IssueConnectedActivityInfo,
      icon: gitlab.icon.Gitlab,
      props: {
        url: external.web_url,
        repository: repo.repository.webUrl,
        repoName: repo.repository.pathWithNamespace,
        number: external.iid
      }
    })
  }

  private async requeueChildren (query: DocumentQuery<DocSyncInfo>): Promise<void> {
    for (const child of await this.provider.derived.findAll(gitlab.class.DocSyncInfo, query)) {
      await this.provider.derived.update(child, { needSync: '' })
    }
  }

  private async removeChildren (query: DocumentQuery<DocSyncInfo>): Promise<void> {
    for (const child of await this.provider.derived.findAll(gitlab.class.DocSyncInfo, query)) {
      await this.provider.derived.remove(child)
    }
  }
}
