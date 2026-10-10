// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import { type Person } from '@hcengineering/contact'
import core, {
  type AttachedData,
  type Doc,
  type DocumentUpdate,
  makeCollabId,
  makeCollabJsonId,
  makeDocCollabId,
  type Markup,
  type MeasureContext,
  type PersonId,
  type Ref,
  type Status
} from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabMergeRequest } from '@hcengineering/gitlab'
import { areEqualMarkups } from '@hcengineering/text'
import tracker, { type IssueStatus } from '@hcengineering/tracker'
import { type GitlabApi, isNotFound } from '../gitlab/api'
import type { GitlabMergeRequestInfo, GitlabMergeRequestInput } from '../gitlab/types'
import { requeueSyncDocs } from './docs'
import { EXPIRED_ERROR } from './errors'
import { sameImages } from './image-links'
import { mergeRequestKey } from './keys'
import { compareMarkdown, mergeFields } from './merge'
import { syncMergeRequestPatch } from './patch'
import { fetchReviewStatus, sameMembers, syncMergeRequestReviews } from './reviews'
import {
  mergeRequestStateOfStatus,
  mergeRequestSyncState,
  type MergeRequestSyncState,
  statusForMergeRequestState
} from './status'
import { syncMergeRequestTodos } from './todos'
import { allocateIssueNumber, assigneeIdsFor, emptyIssueFields } from './tracker'
import type { DocSyncManager, IssueTaskType, RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION, SYNC_DONE } from './versions'

export const MERGE_REQUEST_MOVED = 'Moved to another project; no longer synchronized with GitLab'

// A merge request merged or closed this long ago gets a light first import
const HISTORY_DETAIL_MS = 30 * 24 * 60 * 60 * 1000

/** Merged or closed, and last updated more than HISTORY_DETAIL_MS before `now`. */
export function isHistorical (mr: Pick<GitlabMergeRequestInfo, 'state' | 'updated_at'>, now: number): boolean {
  return mergeRequestSyncState(mr.state) !== 'opened' && now - Date.parse(mr.updated_at) > HISTORY_DETAIL_MS
}

/** The fields kept in sync both ways; `current` in DocSyncInfo holds the last agreed snapshot. */
export interface MergeRequestSnapshot {
  title: string
  description: Markup
  assignee: Ref<Person> | null
  // Sorted; only persons with a GitLab identity on the host
  reviewers: Array<Ref<Person>>
  state: MergeRequestSyncState
}

/** GitLab-only fields mirrored into Huly as read-only. */
type MirrorFields = Pick<
GitlabMergeRequest,
| 'url'
| 'gitlabIid'
| 'repository'
| 'state'
| 'draft'
| 'sourceBranch'
| 'targetBranch'
| 'mergeStatus'
| 'hasConflicts'
| 'mergedAt'
| 'closedAt'
>

function timestamp (value: string | null): number | null {
  return value === null ? null : Date.parse(value)
}

export class MergeRequestSyncManager implements DocSyncManager {
  constructor (private readonly provider: SyncProvider) {}

  /**
   * Fetches the merge request a webhook names and stores it for the sync loop. With `refresh` (approval events)
   * the same version is queued again: an approval may leave updated_at unchanged. Returns false when GitLab
   * answered 404.
   */
  async handleMergeRequestEvent (
    ctx: MeasureContext,
    repo: RepositoryContext,
    api: GitlabApi,
    iid: number,
    actor?: PersonId,
    refresh = false
  ): Promise<boolean> {
    const key = mergeRequestKey(repo.integration.host, repo.repository.projectId, iid)
    return await this.provider.runner.exec(key, async () => {
      let mr: GitlabMergeRequestInfo
      try {
        mr = await api.getMergeRequest(repo.repository.projectId, iid)
      } catch (err: unknown) {
        if (isNotFound(err)) {
          ctx.info('gitlab merge request from webhook not found', { projectId: repo.repository.projectId, iid })
          return false
        }
        throw err
      }
      await this.upsertExternal(repo, mr, actor, refresh)
      return true
    })
  }

  /** Stores a merge request from a listing. */
  async receive (ctx: MeasureContext, repo: RepositoryContext, mr: GitlabMergeRequestInfo): Promise<void> {
    const key = mergeRequestKey(repo.integration.host, repo.repository.projectId, mr.iid)
    await this.provider.runner.exec(key, async () => {
      await this.upsertExternal(repo, mr)
    })
  }

  /**
   * Queues every open, in-sync merge request of a repository again: approvals, requested changes and
   * resolved threads change no updated_at, so a lost webhook would otherwise never reach Huly. Returns their iids.
   */
  async requeueOpen (repo: RepositoryContext): Promise<number[]> {
    const { derived } = this.provider
    const infos = await derived.findAll(gitlab.class.DocSyncInfo, {
      repository: repo.repository._id,
      objectClass: gitlab.class.GitlabMergeRequest,
      needSync: GITLAB_SYNC_VERSION
    })
    const queued: number[] = []
    for (const info of infos) {
      const external = info.external as GitlabMergeRequestInfo | undefined
      if (info.deleted === true || external === undefined) continue
      if (mergeRequestSyncState(external.state) !== 'opened') continue
      await derived.update(info, { needSync: '' })
      queued.push(info.gitlabIid)
    }
    if (queued.length > 0) this.provider.triggerSync()
    return queued
  }

  private async upsertExternal (
    repo: RepositoryContext,
    mr: GitlabMergeRequestInfo,
    actor?: PersonId,
    refresh = false
  ): Promise<void> {
    const { derived } = this.provider
    const key = mergeRequestKey(repo.integration.host, repo.repository.projectId, mr.iid)
    const lastModified = Date.parse(mr.updated_at)
    const info = await derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key })
    if (info === undefined) {
      await derived.createDoc(gitlab.class.DocSyncInfo, repo.project._id, {
        key,
        objectClass: gitlab.class.GitlabMergeRequest,
        repository: repo.repository._id,
        gitlabIid: mr.iid,
        external: mr,
        needSync: '',
        lastModified,
        lastGitlabUser: actor ?? null
      })
    } else {
      const stored = info.external as GitlabMergeRequestInfo | undefined
      const storedAt = stored === undefined ? undefined : Date.parse(stored.updated_at)
      // Same or older version: our own write coming back, or an out-of-order event. A refresh queues the same
      // version again, never an older one.
      const seen = storedAt !== undefined && (storedAt > lastModified || (storedAt === lastModified && !refresh))
      if (seen && info.repository === repo.repository._id) {
        return
      }
      await derived.update(info, {
        external: mr,
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
    // Merge requests are created in GitLab only
    if (info.key === '') return SYNC_DONE
    const repo = this.provider.repositoryContext(info.repository)
    const external = info.external as GitlabMergeRequestInfo | undefined
    if (repo === undefined || external === undefined) return SYNC_DONE
    const type = await this.provider.mergeRequestTaskType(repo.project)
    if (type === undefined) {
      return { ...SYNC_DONE, error: 'The Huly project has no merge request task type', retryable: true }
    }
    const update =
      existing === undefined
        ? await this.createInHuly(repo, info, external, type)
        : await this.mergeExisting(ctx, repo, existing as GitlabMergeRequest, info, external, type)
    if (update.error != null) return update
    const mr = await this.provider.client.findOne(gitlab.class.GitlabMergeRequest, {
      _id: info._id as unknown as Ref<GitlabMergeRequest>
    })
    if (mr === undefined) return update
    const latest = (update.external as GitlabMergeRequestInfo | undefined) ?? external
    // First import of old history: the merge request only; nothing marks the rest as fetched, so a later event loads it
    if (existing === undefined && isHistorical(latest, this.provider.now())) return update
    const status = await fetchReviewStatus(ctx, this.provider, repo, info, latest)
    return {
      ...update,
      ...(await syncMergeRequestPatch(ctx, this.provider, repo, mr, info, latest)),
      ...(status === undefined ? {} : await syncMergeRequestReviews(this.provider, repo, mr, info, latest, status)),
      ...(await syncMergeRequestTodos(this.provider, repo, mr, info, latest, status))
    }
  }

  /** A merge request deleted in Huly stays in GitLab; its sync doc stays as a tombstone. */
  async handleDelete (ctx: MeasureContext, info: DocSyncInfo): Promise<boolean> {
    ctx.info('gitlab merge request deleted in Huly, GitLab left unchanged', { key: info.key })
    return false
  }

  /**
   * A merge request moved to another project is detached. GitLab stays unchanged. The sync doc becomes a
   * tombstone in its old project, so the merge request is not imported there again.
   */
  async handleMove (ctx: MeasureContext, existing: Doc, info: DocSyncInfo): Promise<void> {
    ctx.info('gitlab merge request moved to another project, no longer synchronized', { key: info.key })
    await this.provider.client.update(existing as GitlabMergeRequest, { syncError: MERGE_REQUEST_MOVED })
    await this.provider.derived.update(info, {
      needSync: GITLAB_SYNC_VERSION,
      deleted: true,
      error: MERGE_REQUEST_MOVED,
      retryable: false
    })
  }

  private async createInHuly (
    repo: RepositoryContext,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo,
    type: IssueTaskType
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const { client, collaborator, persons } = this.provider
    const { snapshot, images } = await this.externalSnapshot(repo, external)
    const author = await persons.personIdFor(repo.integration.host, external.author)
    const { number, rank, identifier } = await allocateIssueNumber(client, repo.project)
    const id = info._id as unknown as Ref<GitlabMergeRequest>
    const collabId = makeCollabId(gitlab.class.GitlabMergeRequest, id, 'description')
    await collaborator.updateMarkup(collabId, snapshot.description)
    const value: AttachedData<GitlabMergeRequest> = {
      ...emptyIssueFields(),
      ...this.mirror(repo, external),
      title: snapshot.title,
      description: makeCollabJsonId(collabId),
      assignee: snapshot.assignee,
      reviewers: snapshot.reviewers,
      status: statusForMergeRequestState(snapshot.state, type.statuses) as Ref<IssueStatus>,
      kind: type.taskType,
      number,
      rank,
      identifier,
      // Filled in with the diff
      commits: 0,
      files: 0,
      additions: 0,
      deletions: 0,
      approvedBy: [],
      reviewComments: 0,
      images
    }
    await client.addCollection(
      gitlab.class.GitlabMergeRequest,
      repo.project._id,
      tracker.ids.NoParent,
      tracker.class.Issue,
      'subIssues',
      value,
      id,
      Date.parse(external.created_at),
      author
    )
    await client.addCollection(
      activity.class.ActivityInfoMessage,
      repo.project._id,
      id,
      gitlab.class.GitlabMergeRequest,
      'activity',
      {
        message: gitlab.string.MergeRequestConnectedActivityInfo,
        icon: gitlab.icon.MergeRequest,
        props: {
          url: external.web_url,
          repository: repo.repository.webUrl,
          repoName: repo.repository.pathWithNamespace,
          number: external.iid
        }
      }
    )
    // Notes that arrived before their merge request can now be created
    await requeueSyncDocs(this.provider.derived, { parent: info.key })
    return { ...SYNC_DONE, current: snapshot, error: null }
  }

  private async mergeExisting (
    ctx: MeasureContext,
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo,
    type: IssueTaskType
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const { snapshot: remote, images: remoteImages } = await this.externalSnapshot(repo, external)
    const base = (info.current as MergeRequestSnapshot | undefined) ?? remote
    const { snapshot: platform, unmapped } = await this.platformSnapshot(repo, mr, type.statuses, base.state)
    const { toPlatform, toGitlab, conflicts, merged } = mergeFields(base, platform, remote, {
      description: areEqualMarkups,
      reviewers: sameMembers
    })
    if (conflicts.length > 0) {
      ctx.warn('GitLab and Huly both changed a merge request, keeping the Huly value', {
        mr: mr.identifier,
        fields: conflicts
      })
    }
    // GitLab still shows Huly image links (written before images were copied, or after a failed upload): send the
    // description again, its images are uploaded now. toGitlabInput skips it when nothing changes.
    if (toGitlab.description === undefined && this.provider.content.hasHulyImages(external.description)) {
      toGitlab.description = merged.description
    }
    // Huly cannot merge, and a merged merge request keeps its state: put Huly back to GitLab's state
    let revert: MergeRequestSyncState | undefined
    if (toGitlab.state !== undefined && (toGitlab.state === 'merged' || remote.state === 'merged')) {
      delete toGitlab.state
      merged.state = remote.state
      revert = remote.state
    }
    const input = await this.toGitlabInput(repo, toGitlab, external)
    if (toGitlab.assignee !== undefined && input.assignee_ids === undefined) {
      // Not pushable: keep it in Huly, and record GitLab's value as the base (same rule as issues)
      merged.assignee = remote.assignee
    }
    let latest = external
    if (Object.keys(input).length > 0) {
      const api = await this.provider.apiFor(repo.integration, mr.modifiedBy)
      if (api === undefined) {
        return { ...SYNC_DONE, error: EXPIRED_ERROR, retryable: true }
      }
      latest = await this.provider.runner.exec(info.key, async () => {
        const updated = await api.updateMergeRequest(repo.repository.projectId, external.iid, input)
        // Stored inside the lock, so the webhook echo of this write is recognised
        await this.provider.derived.update(info, {
          external: updated,
          current: merged,
          lastModified: Date.parse(updated.updated_at)
        })
        return updated
      })
    }
    // After a push GitLab holds the Huly description: its images are read from what GitLab returned
    const images =
      latest === external ? remoteImages : await this.provider.content.linkedImages(repo, latest.description)
    await this.applyToHuly(
      repo,
      mr,
      toPlatform,
      revert,
      latest,
      unmapped,
      type.statuses,
      info.lastGitlabUser ?? core.account.System,
      images
    )
    return { ...SYNC_DONE, current: merged, external: latest, lastModified: Date.parse(latest.updated_at), error: null }
  }

  private mirror (repo: RepositoryContext, external: GitlabMergeRequestInfo): MirrorFields {
    return {
      url: external.web_url,
      gitlabIid: external.iid,
      repository: repo.repository._id,
      state: external.state,
      draft: external.draft,
      sourceBranch: external.source_branch,
      targetBranch: external.target_branch,
      mergeStatus: external.detailed_merge_status,
      hasConflicts: external.has_conflicts,
      mergedAt: timestamp(external.merged_at),
      closedAt: timestamp(external.closed_at)
    }
  }

  private async platformSnapshot (
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    statuses: Status[],
    fallback: MergeRequestSyncState
  ): Promise<{ snapshot: MergeRequestSnapshot, unmapped: Array<Ref<Person>> }> {
    const description = await this.provider.collaborator.getMarkup(makeDocCollabId(mr, 'description'), mr.description)
    const mapped: Array<Ref<Person>> = []
    const unmapped: Array<Ref<Person>> = []
    for (const person of mr.reviewers ?? []) {
      const id = await this.provider.persons.gitlabUserIdFor(person, repo.integration.host)
      if (id !== undefined) mapped.push(person)
      else unmapped.push(person)
    }
    return {
      snapshot: {
        title: mr.title,
        description,
        assignee: mr.assignee,
        reviewers: mapped.sort(),
        state: mergeRequestStateOfStatus(mr.status, statuses) ?? fallback
      },
      unmapped
    }
  }

  private async externalSnapshot (
    repo: RepositoryContext,
    external: GitlabMergeRequestInfo
  ): Promise<{ snapshot: MergeRequestSnapshot, images: string[] }> {
    const { persons, content } = this.provider
    const reviewers: Array<Ref<Person>> = []
    for (const user of external.reviewers) {
      const person = await persons.personRefFor(repo.integration.host, user)
      if (person !== null) reviewers.push(person)
    }
    const { markup, images } = await content.toMarkupWithImages(repo, external.description)
    return {
      snapshot: {
        title: external.title,
        description: markup,
        assignee: await persons.personRefFor(repo.integration.host, external.assignees[0]),
        reviewers: reviewers.sort(),
        state: mergeRequestSyncState(external.state)
      },
      images
    }
  }

  private async toGitlabInput (
    repo: RepositoryContext,
    change: Partial<MergeRequestSnapshot>,
    external: GitlabMergeRequestInfo
  ): Promise<GitlabMergeRequestInput> {
    const input: GitlabMergeRequestInput = {}
    const host = repo.integration.host
    if (change.title !== undefined && change.title !== external.title) {
      input.title = change.title
    }
    if (change.description !== undefined) {
      const markdown = await this.provider.content.toMarkdown(repo, change.description)
      if (!compareMarkdown(markdown, external.description ?? '')) input.description = markdown
    }
    if (change.assignee !== undefined) {
      const ids = await assigneeIdsFor(this.provider.persons, host, change.assignee, external.assignees)
      if (ids !== undefined) input.assignee_ids = ids
    }
    if (change.reviewers !== undefined) {
      const ids: number[] = []
      for (const person of change.reviewers) {
        const id = await this.provider.persons.gitlabUserIdFor(person, host)
        if (id !== undefined) ids.push(id)
      }
      if (
        !sameMembers(
          ids,
          external.reviewers.map((it) => it.id)
        )
      ) {
        input.reviewer_ids = ids.length > 0 ? ids : [0]
      }
    }
    if (change.state !== undefined && change.state !== mergeRequestSyncState(external.state)) {
      input.state_event = change.state === 'closed' ? 'close' : 'reopen'
    }
    return input
  }

  private async applyToHuly (
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    change: Partial<MergeRequestSnapshot>,
    revert: MergeRequestSyncState | undefined,
    external: GitlabMergeRequestInfo,
    unmapped: Array<Ref<Person>>,
    statuses: Status[],
    actor: PersonId,
    images: string[]
  ): Promise<void> {
    const update: DocumentUpdate<GitlabMergeRequest> = {}
    if (change.title !== undefined) update.title = change.title
    if (change.assignee !== undefined) update.assignee = change.assignee
    // Reviewers without a GitLab identity stay
    if (change.reviewers !== undefined) update.reviewers = [...change.reviewers, ...unmapped]
    const state = change.state ?? revert
    if (state !== undefined && mergeRequestStateOfStatus(mr.status, statuses) !== state) {
      update.status = statusForMergeRequestState(state, statuses) as Ref<IssueStatus>
    }
    const mirror = this.mirror(repo, external)
    for (const key of Object.keys(mirror) as Array<keyof MirrorFields>) {
      if (mr[key] !== mirror[key]) {
        ;(update as Record<string, unknown>)[key] = mirror[key]
      }
    }
    if (!sameImages(mr.images, images)) update.images = images
    if (change.description !== undefined) {
      await this.provider.collaborator.updateMarkup(makeDocCollabId(mr, 'description'), change.description)
    }
    if (Object.keys(update).length > 0) {
      await this.provider.client.update(mr, update, false, this.provider.now(), actor)
    }
  }
}
