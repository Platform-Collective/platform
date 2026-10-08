// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import chunter from '@hcengineering/chunter'
import type { Person } from '@hcengineering/contact'
import core, {
  type AttachedData,
  type Doc,
  type DocumentQuery,
  type DocumentUpdate,
  type Hyperlink,
  makeCollabId,
  makeCollabJsonId,
  makeDocCollabId,
  type Markup,
  type MeasureContext,
  type PersonId,
  type Ref,
  SortingOrder,
  type Status
} from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabProject } from '@hcengineering/gitlab'
import { calcRank } from '@hcengineering/task'
import { areEqualMarkups } from '@hcengineering/text'
import tracker, { type Issue, IssuePriority, type IssueStatus } from '@hcengineering/tracker'
import { type GitlabApi, GitlabApiError } from '../gitlab/api'
import type { GitlabIssueInfo, GitlabIssueInput, GitlabIssueState } from '../gitlab/types'
import { issueKey, repositoryLockKey } from './keys'
import { compareMarkdown, mergeFields } from './merge'
import { stateOfStatus, statusForState } from './status'
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
    const external = info.external as GitlabIssueInfo | undefined
    const repo = this.provider.repositoryContext(info.repository)
    if (external !== undefined && repo !== undefined && external.state !== 'closed') {
      const api = await this.provider.integrationApi(repo.integration)
      if (api === undefined) {
        throw new Error('GitLab authorization expired')
      }
      try {
        // Maintainers cannot delete GitLab issues; closing keeps the GitLab history intact.
        await api.updateIssue(repo.repository.projectId, external.iid, { state_event: 'close' })
      } catch (err: unknown) {
        if (!(err instanceof GitlabApiError && err.status === 404)) throw err
      }
      ctx.info('gitlab issue closed after its Huly issue was deleted', { key: info.key })
    }
    // Only its comments: sub-issues are attached to their parent too, and are deleted (or kept) on their own
    await this.removeChildren({ attachedTo: info._id, objectClass: chunter.class.ChatMessage })
    if (info.key !== '') {
      await this.removeChildren({ parent: info.key })
    }
    return true
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
    const input: GitlabIssueInput = { title: platform.title, description: this.provider.markdown.toMarkdown(platform.description) }
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
    const project = repo.project
    const lastOne = await client.findOne(tracker.class.Issue, { space: project._id }, { sort: { rank: SortingOrder.Descending } })
    const incResult = await client.updateDoc(tracker.class.Project, core.space.Space, project._id, { $inc: { sequence: 1 } }, true)
    const number = (incResult as unknown as { object: { sequence: number } }).object.sequence
    const issueId = info._id as unknown as Ref<Issue>
    const collabId = makeCollabId(tracker.class.Issue, issueId, 'description')
    await collaborator.updateMarkup(collabId, snapshot.description)
    const value: AttachedData<Issue> = {
      title: snapshot.title,
      description: makeCollabJsonId(collabId),
      assignee: snapshot.assignee,
      status,
      kind: type.taskType,
      component: null,
      milestone: null,
      number,
      priority: IssuePriority.NoPriority,
      rank: calcRank(lastOne, undefined),
      comments: 0,
      subIssues: 0,
      startDate: null,
      dueDate: null,
      parents: [],
      reportedTime: 0,
      remainingTime: 0,
      estimation: 0,
      reports: 0,
      relations: [],
      childInfo: [],
      identifier: `${project.identifier}-${number}`
    }
    await client.addCollection(
      tracker.class.Issue,
      project._id,
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
    if (h.hasMixin(issue, gitlab.mixin.GitlabIssue)) {
      return this.provider.repositoryContext(h.as(issue, gitlab.mixin.GitlabIssue).repository)
    }
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
      description: this.provider.markdown.toMarkup(external.description),
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
      const markdown = this.provider.markdown.toMarkdown(change.description)
      if (!compareMarkdown(markdown, external.description ?? '')) input.description = markdown
    }
    if (change.assignee !== undefined) {
      if (change.assignee === null) {
        if (external.assignees.length > 0) input.assignee_ids = [0]
      } else {
        // A person without a GitLab identity on this host is kept in Huly only
        const id = await this.provider.persons.gitlabUserIdFor(change.assignee, repo.integration.host)
        if (id !== undefined && external.assignees[0]?.id !== id) input.assignee_ids = [id]
      }
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
