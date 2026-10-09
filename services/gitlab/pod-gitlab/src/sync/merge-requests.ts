// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import contact, { type Employee, type Person } from '@hcengineering/contact'
import core, {
  type AttachedData,
  type Blob,
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
  SortingOrder,
  type Status
} from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabMergeRequest, type GitlabReview, type GitlabTodo } from '@hcengineering/gitlab'
import { makeRank } from '@hcengineering/task'
import { areEqualMarkups } from '@hcengineering/text'
import time, { type ToDo, ToDoPriority } from '@hcengineering/time'
import tracker, { type IssueStatus } from '@hcengineering/tracker'
import { type GitlabApi, GitlabApiError } from '../gitlab/api'
import type { GitlabMergeRequestInfo, GitlabMergeRequestInput } from '../gitlab/types'
import { errorMessage, isPermanentError } from './errors'
import { mergeRequestKey, reviewKey } from './keys'
import { compareMarkdown, mergeFields } from './merge'
import { countPatchFiles, countPatchLines, fetchMergeRequestPatch, MAX_PATCH_BYTES } from './patch'
import {
  mergeRequestStateOfStatus,
  mergeRequestSyncState,
  type MergeRequestSyncState,
  statusForMergeRequestState
} from './status'
import {
  effectiveReviewStates,
  reviewEvents,
  type ReviewEvent,
  reviewRecord,
  type ReviewRecord,
  type ReviewStatus,
  type UserReviewState
} from './reviews'
import { planTodos, type TodoRef } from './todos'
import { allocateIssueNumber, assigneeIdsFor, emptyIssueFields } from './tracker'
import type { DocSyncManager, IssueTaskType, PatchStore, RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION } from './versions'

export const MERGE_REQUEST_MOVED = 'Moved to another project; no longer synchronized with GitLab'

// A merge request merged or closed this long ago gets a light first import
export const HISTORY_DETAIL_MS = 30 * 24 * 60 * 60 * 1000

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
'url' | 'gitlabIid' | 'repository' | 'state' | 'draft' | 'sourceBranch' | 'targetBranch' | 'mergeStatus' |
'hasConflicts' | 'mergedAt' | 'closedAt'
>

const DONE: DocumentUpdate<DocSyncInfo> = { needSync: GITLAB_SYNC_VERSION }

/** Set equality, ignoring order and duplicates. */
export function sameMembers<T> (a: T[] | null | undefined, b: T[] | null | undefined): boolean {
  const left = new Set(a ?? [])
  const right = new Set(b ?? [])
  return left.size === right.size && [...left].every((it) => right.has(it))
}

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
        if (err instanceof GitlabApiError && err.status === 404) {
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
    if (info.key === '') return DONE
    const repo = this.provider.repositoryContext(info.repository)
    const external = info.external as GitlabMergeRequestInfo | undefined
    if (repo === undefined || external === undefined) return DONE
    const type = await this.provider.mergeRequestTaskType(repo.project)
    if (type === undefined) {
      return { ...DONE, error: 'The Huly project has no merge request task type', retryable: true }
    }
    const update =
      existing === undefined
        ? await this.createInHuly(repo, info, external, type)
        : await this.mergeExisting(ctx, repo, existing as GitlabMergeRequest, info, external, type)
    if (update.error != null) return update
    const mr = await this.provider.client.findOne(gitlab.class.GitlabMergeRequest, { _id: info._id as unknown as Ref<GitlabMergeRequest> })
    if (mr === undefined) return update
    const latest = (update.external as GitlabMergeRequestInfo | undefined) ?? external
    // First import of old history: the merge request only; nothing marks the rest as fetched, so a later event loads it
    if (existing === undefined && isHistorical(latest, this.provider.now())) return update
    const status = await this.reviewStatus(ctx, repo, info, latest)
    return {
      ...update,
      ...(await this.syncPatch(ctx, repo, mr, info, latest)),
      ...(status === undefined ? {} : await this.syncReviews(repo, mr, info, latest, status)),
      ...(await this.syncTodos(repo, mr, info, latest, status))
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
    await this.provider.derived.update(info, { needSync: GITLAB_SYNC_VERSION, deleted: true, error: MERGE_REQUEST_MOVED, retryable: false })
  }

  /**
   * Stores the diff when the head commit changed since the last stored one. A failure is logged and
   * leaves patchSha as it was, so the next sync of this merge request tries again; it never fails the sync.
   */
  private async syncPatch (
    ctx: MeasureContext,
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const store = this.provider.patches
    if (store === undefined || external.sha === null || info.patchSha === external.sha) return {}
    try {
      const api = await this.provider.integrationApi(repo.integration)
      if (api === undefined) return {}
      const projectId = repo.repository.projectId
      const patch = await fetchMergeRequestPatch(api, projectId, external.iid)
      const commits = (await api.listMergeRequestCommits(projectId, external.iid)).length
      const files = countPatchFiles(patch)
      const { additions, deletions } = countPatchLines(patch)
      const bytes = Buffer.byteLength(patch)
      if (bytes > MAX_PATCH_BYTES) {
        ctx.warn('gitlab merge request diff too large, not stored', { key: info.key, bytes })
        // The stored diff belongs to an older version
        await this.removePatch(ctx, store, mr)
      } else {
        await this.storePatch(ctx, store, mr, patch, Date.parse(external.updated_at))
      }
      if (mr.commits !== commits || mr.files !== files || mr.additions !== additions || mr.deletions !== deletions) {
        await this.provider.client.update(mr, { commits, files, additions, deletions })
      }
      return { patchSha: external.sha }
    } catch (err: unknown) {
      ctx.warn('gitlab merge request diff not stored', { key: info.key, error: errorMessage(err) })
      // patchSha stays as it was; the next full sync re-queues a retryable doc, merged and closed ones included
      return { retryable: !isPermanentError(err) }
    }
  }

  /**
   * Points the hidden patch doc at a new blob and then removes the old one. If the doc cannot be
   * written, the new blob is removed and the error goes to the caller, which leaves patchSha unchanged for a retry.
   */
  private async storePatch (ctx: MeasureContext, store: PatchStore, mr: GitlabMergeRequest, patch: string, lastModified: number): Promise<void> {
    const { client } = this.provider
    const existing = await client.findOne(gitlab.class.GitlabPatch, { attachedTo: mr._id })
    const stored = await store.put(ctx, patch)
    try {
      if (existing === undefined) {
        await client.addCollection(gitlab.class.GitlabPatch, mr.space, mr._id, mr._class, 'patch', {
          file: stored.file as Ref<Blob>,
          size: stored.size,
          lastModified
        })
      } else {
        await client.update(existing, { file: stored.file as Ref<Blob>, size: stored.size, lastModified })
      }
    } catch (err: unknown) {
      await this.removeBlob(ctx, store, stored.file)
      throw err
    }
    if (existing !== undefined) await this.removeBlob(ctx, store, existing.file)
  }

  /** Removes a stored diff that no longer matches the merge request. */
  private async removePatch (ctx: MeasureContext, store: PatchStore, mr: GitlabMergeRequest): Promise<void> {
    const { client } = this.provider
    const existing = await client.findOne(gitlab.class.GitlabPatch, { attachedTo: mr._id })
    if (existing === undefined) return
    await client.removeCollection(existing._class, existing.space, existing._id, existing.attachedTo, existing.attachedToClass, existing.collection)
    await this.removeBlob(ctx, store, existing.file)
  }

  // An orphan blob is harmless: a failed removal is only logged
  private async removeBlob (ctx: MeasureContext, store: PatchStore, file: string): Promise<void> {
    try {
      await store.remove(ctx, file)
    } catch (err: unknown) {
      ctx.warn('gitlab merge request diff blob not removed', { file, error: errorMessage(err) })
    }
  }

  private async createInHuly (
    repo: RepositoryContext,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo,
    type: IssueTaskType
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const { client, collaborator, persons } = this.provider
    const snapshot = await this.externalSnapshot(repo, external)
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
      reviewComments: 0
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
    await client.addCollection(activity.class.ActivityInfoMessage, repo.project._id, id, gitlab.class.GitlabMergeRequest, 'activity', {
      message: gitlab.string.MergeRequestConnectedActivityInfo,
      icon: gitlab.icon.MergeRequest,
      props: {
        url: external.web_url,
        repository: repo.repository.webUrl,
        repoName: repo.repository.pathWithNamespace,
        number: external.iid
      }
    })
    // Notes that arrived before their merge request can now be created
    await this.requeueChildren({ parent: info.key })
    return { ...DONE, current: snapshot, error: null }
  }

  private async mergeExisting (
    ctx: MeasureContext,
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo,
    type: IssueTaskType
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const remote = await this.externalSnapshot(repo, external)
    const base = (info.current as MergeRequestSnapshot | undefined) ?? remote
    const { snapshot: platform, unmapped } = await this.platformSnapshot(repo, mr, type.statuses, base.state)
    const { toPlatform, toGitlab, conflicts, merged } = mergeFields(base, platform, remote, {
      description: areEqualMarkups,
      reviewers: sameMembers
    })
    if (conflicts.length > 0) {
      ctx.warn('GitLab and Huly both changed a merge request, keeping the Huly value', { mr: mr.identifier, fields: conflicts })
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
        return { ...DONE, error: 'GitLab authorization expired', retryable: true }
      }
      latest = await this.provider.runner.exec(info.key, async () => {
        const updated = await api.updateMergeRequest(repo.repository.projectId, external.iid, input)
        // Stored inside the lock, so the webhook echo of this write is recognised
        await this.provider.derived.update(info, { external: updated, current: merged, lastModified: Date.parse(updated.updated_at) })
        return updated
      })
    }
    await this.applyToHuly(repo, mr, toPlatform, revert, latest, unmapped, type.statuses, info.lastGitlabUser ?? core.account.System)
    return { ...DONE, current: merged, external: latest, lastModified: Date.parse(latest.updated_at), error: null }
  }

  private mirror (repo: RepositoryContext, external: GitlabMergeRequestInfo): MirrorFields {
    return {
      url: external.web_url as Hyperlink,
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

  private async externalSnapshot (repo: RepositoryContext, external: GitlabMergeRequestInfo): Promise<MergeRequestSnapshot> {
    const { persons, content } = this.provider
    const reviewers: Array<Ref<Person>> = []
    for (const user of external.reviewers) {
      const person = await persons.personRefFor(repo.integration.host, user)
      if (person !== null) reviewers.push(person)
    }
    return {
      title: external.title,
      description: await content.toMarkup(repo, external.description),
      assignee: await persons.personRefFor(repo.integration.host, external.assignees[0]),
      reviewers: reviewers.sort(),
      state: mergeRequestSyncState(external.state)
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
      if (!sameMembers(ids, external.reviewers.map((it) => it.id))) {
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
    actor: PersonId
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
    if (change.description !== undefined) {
      await this.provider.collaborator.updateMarkup(makeDocCollabId(mr, 'description'), change.description)
    }
    if (Object.keys(update).length > 0) {
      await this.provider.client.update(mr, update, false, Date.now(), actor)
    }
  }

  /**
   * Reviewer states and approvals: while the merge request is open, and once on its first import.
   * Undefined when not needed or not available; reviews, approvers and ToDos then stay as they are.
   */
  private async reviewStatus (
    ctx: MeasureContext,
    repo: RepositoryContext,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo
  ): Promise<ReviewStatus | undefined> {
    const open = mergeRequestSyncState(external.state) === 'opened'
    if (!open && info.reviews !== undefined) return undefined
    try {
      const api = await this.provider.integrationApi(repo.integration)
      if (api === undefined) return undefined
      const projectId = repo.repository.projectId
      const [reviewers, approvals] = await Promise.all([
        api.listMergeRequestReviewers(projectId, external.iid),
        api.getMergeRequestApprovals(projectId, external.iid)
      ])
      return { reviewers, approvals }
    } catch (err: unknown) {
      ctx.warn('gitlab review states unavailable, reviews and ToDos left as they are', { key: info.key, error: errorMessage(err) })
      return undefined
    }
  }

  /** Review messages for review state changes, and the approvers mirrored on the merge request. */
  private async syncReviews (
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo,
    status: ReviewStatus
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const { persons, client } = this.provider
    const current = effectiveReviewStates(status)
    const previous = info.reviews as ReviewRecord | undefined
    // First import: at the merge request's last update; later: when the change was seen
    const fallback = previous === undefined ? Date.parse(external.updated_at) : Date.now()
    for (const event of reviewEvents(previous, current)) {
      // A time from the sync clock is no identity: two changes of one user may be seen within one millisecond
      const seenNow = event.at === undefined && previous !== undefined
      await this.createReview(repo, mr, info, event, event.at !== undefined ? Date.parse(event.at) : fallback, seenNow)
      // Recorded at once: a failure later in this sync must not write the message again
      await this.recordSeen(info, event.user.id, current.get(event.user.id))
    }
    const approvedBy: Array<Ref<Person>> = []
    for (const approval of status.approvals.approved_by) {
      const person = await persons.personRefFor(repo.integration.host, approval.user)
      if (person !== null) approvedBy.push(person)
    }
    if (!sameMembers(approvedBy, mr.approvedBy)) {
      await client.update(mr, { approvedBy: approvedBy.sort() })
    }
    return { reviews: reviewRecord(current) }
  }

  private async createReview (
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    info: DocSyncInfo,
    event: ReviewEvent,
    at: number,
    seenNow: boolean
  ): Promise<void> {
    const { client, derived } = this.provider
    const known = async (time: number): Promise<DocSyncInfo | undefined> =>
      await derived.findOne(gitlab.class.DocSyncInfo, { space: info.space, key: reviewKey(info.key, event.user.id, time) })
    if (!seenNow) {
      // A GitLab time or the first import's time identifies the change: an existing key means it is already written
      const written = await known(at)
      if (written !== undefined) {
        // Its message is missing when an earlier sync failed between the two writes
        const id = written._id as unknown as Ref<GitlabReview>
        if (written.deleted !== true && (await client.findOne(gitlab.class.GitlabReview, { _id: id })) === undefined) {
          await this.addReviewMessage(repo, mr, event, at, id)
        }
        return
      }
    }
    while (seenNow && (await known(at)) !== undefined) at++
    const key = reviewKey(info.key, event.user.id, at)
    const id = generateId<GitlabReview>()
    // The sync doc comes first and is done: the trigger then finds it and never sends the review back to GitLab
    await derived.createDoc(
      gitlab.class.DocSyncInfo,
      info.space,
      {
        key,
        parent: info.key,
        objectClass: gitlab.class.GitlabReview,
        repository: repo.repository._id,
        gitlabIid: 0,
        needSync: GITLAB_SYNC_VERSION,
        attachedTo: mr._id
      },
      id as unknown as Ref<DocSyncInfo>
    )
    await this.addReviewMessage(repo, mr, event, at, id)
  }

  private async addReviewMessage (
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    event: ReviewEvent,
    at: number,
    id: Ref<GitlabReview>
  ): Promise<void> {
    const author = await this.provider.persons.personIdFor(repo.integration.host, event.user)
    await this.provider.client.addCollection(gitlab.class.GitlabReview, mr.space, mr._id, mr._class, 'activity', { state: event.state }, id, at, author)
  }

  /** Stores one user's review state as seen on the merge request's sync doc; undefined drops it (a revoked approver). */
  private async recordSeen (info: DocSyncInfo, userId: number, state: UserReviewState | undefined): Promise<void> {
    const { derived } = this.provider
    const fresh = await derived.findOne(gitlab.class.DocSyncInfo, { _id: info._id })
    if (fresh === undefined) return
    const reviews: ReviewRecord = { ...((fresh.reviews ?? {}) as ReviewRecord) }
    if (state === undefined) {
      delete reviews[String(userId)]
    } else {
      reviews[String(userId)] = { user: state.user, state: state.state }
    }
    await derived.update(fresh, { reviews })
  }

  /** Creates and completes review and fix ToDos from the merge request's review states. */
  private async syncTodos (
    repo: RepositoryContext,
    mr: GitlabMergeRequest,
    info: DocSyncInfo,
    external: GitlabMergeRequestInfo,
    status: ReviewStatus | undefined
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const keys = info.todos ?? []
    const open = mergeRequestSyncState(external.state) === 'opened'
    if (!open && keys.length === 0) return {}
    // Review states unavailable: ToDos stay as they are
    if (open && status === undefined) return {}
    const { persons } = this.provider
    const host = repo.integration.host
    const states = status === undefined ? new Map<number, UserReviewState>() : effectiveReviewStates(status)
    const reviewers: Array<{ person: Ref<Person>, state: UserReviewState['state'] }> = []
    for (const user of external.reviewers) {
      const person = await persons.personRefFor(host, user)
      if (person !== null) {
        reviewers.push({ person, state: states.get(user.id)?.state ?? 'unreviewed' })
      }
    }
    const fixers: Array<Ref<Person>> = []
    const author = await persons.personRefFor(host, external.author)
    if (author !== null) fixers.push(author)
    if (mr.assignee !== null) fixers.push(mr.assignee)
    const needsFix = [...states.values()].some((it) => it.state === 'requested_changes') || !external.blocking_discussions_resolved
    const plan = planTodos({ open, reviewers, fixers, needsFix, keys })
    for (const todo of plan.complete) {
      await this.completeTodos(mr, todo)
    }
    for (const todo of plan.create) {
      await this.createTodo(mr, todo, external)
    }
    return sameMembers(plan.keys, keys) && plan.keys.length === keys.length ? {} : { todos: plan.keys }
  }

  private async createTodo (mr: GitlabMergeRequest, todo: TodoRef, external: GitlabMergeRequestInfo): Promise<void> {
    const { client } = this.provider
    const employee = await client.findOne(contact.mixin.Employee, { _id: todo.person as Ref<Employee>, active: true })
    // Placeholder persons of GitLab users who never joined Huly get no ToDos
    if (employee === undefined) return
    const latest = await client.findOne(
      time.class.ToDo,
      { user: employee._id, doneOn: null },
      { sort: { rank: SortingOrder.Ascending } }
    )
    const id = await client.addCollection(time.class.ProjectToDo, time.space.ToDos, mr._id, mr._class, 'todos', {
      title: `${todo.purpose === 'review' ? 'Review' : 'Resolve'} ${mr.title}`,
      description: this.provider.markdown.toMarkup(external.web_url),
      attachedSpace: mr.space,
      user: employee._id,
      workslots: 0,
      doneOn: null,
      priority: ToDoPriority.High,
      visibility: 'public',
      rank: makeRank(undefined, latest?.rank)
    })
    await client.createMixin<ToDo, GitlabTodo>(id, time.class.ProjectToDo, time.space.ToDos, gitlab.mixin.GitlabTodo, { purpose: todo.purpose })
  }

  private async completeTodos (mr: GitlabMergeRequest, todo: TodoRef): Promise<void> {
    const { client } = this.provider
    const h = client.getHierarchy()
    const open = await client.findAll(time.class.ProjectToDo, { attachedTo: mr._id, user: todo.person as Ref<Employee>, doneOn: null })
    for (const it of open) {
      if (h.hasMixin(it, gitlab.mixin.GitlabTodo) && h.as<ToDo, GitlabTodo>(it, gitlab.mixin.GitlabTodo).purpose === todo.purpose) {
        await client.update(it, { doneOn: Date.now() })
      }
    }
  }

  private async requeueChildren (query: DocumentQuery<DocSyncInfo>): Promise<void> {
    for (const child of await this.provider.derived.findAll(gitlab.class.DocSyncInfo, query)) {
      await this.provider.derived.update(child, { needSync: '' })
    }
  }
}
