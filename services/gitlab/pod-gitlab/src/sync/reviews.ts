// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import { type Doc, type DocumentUpdate, generateId, type MeasureContext, type Ref } from '@hcengineering/core'
import gitlab, {
  type DocSyncInfo,
  type GitlabMergeRequest,
  type GitlabReview,
  type GitlabReviewKind
} from '@hcengineering/gitlab'
import { GitlabApiError } from '../gitlab/api'
import type {
  GitlabApprovals,
  GitlabMergeRequestInfo,
  GitlabMergeRequestReviewer,
  GitlabReviewState,
  GitlabUserRef
} from '../gitlab/types'
import { removeAttached } from './docs'
import { errorMessage } from './errors'
import { reviewKey } from './keys'
import { mergeRequestSyncState } from './status'
import type { DocSyncManager, RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION, SYNC_DONE } from './versions'

/** What GitLab reports about the reviews of one merge request. */
export interface ReviewStatus {
  reviewers: GitlabMergeRequestReviewer[]
  approvals: GitlabApprovals
}

/** The review state of one GitLab user; `at` is the approval time when GitLab reports it. */
export interface UserReviewState {
  user: GitlabUserRef
  state: GitlabReviewState
  at?: string
}

/** DocSyncInfo.reviews of a merge request: the last state seen per GitLab user id. */
export type ReviewRecord = Record<string, UserReviewState>

/** One review message to write. */
export interface ReviewEvent {
  user: GitlabUserRef
  state: GitlabReviewKind
  at?: string
}

// States that are a message of their own; 'unapproved' is reported only after a seen approval
const REPORTED: GitlabReviewState[] = ['approved', 'requested_changes', 'reviewed']

/** Reviewer states, with approvers as 'approved' whether they are reviewers or not. */
export function effectiveReviewStates (status: ReviewStatus): Map<number, UserReviewState> {
  const result = new Map<number, UserReviewState>()
  for (const reviewer of status.reviewers) {
    result.set(reviewer.user.id, { user: reviewer.user, state: reviewer.state })
  }
  for (const approval of status.approvals.approved_by) {
    result.set(approval.user.id, { user: approval.user, state: 'approved', at: approval.approved_at ?? undefined })
  }
  return result
}

/** The review messages for what changed since `previous`; no `previous` means the first import. */
export function reviewEvents (previous: ReviewRecord | undefined, current: Map<number, UserReviewState>): ReviewEvent[] {
  const events: ReviewEvent[] = []
  for (const [id, now] of current) {
    const before = previous?.[String(id)]?.state
    if (now.state === before) continue
    if (REPORTED.includes(now.state)) {
      events.push({ user: now.user, state: now.state as GitlabReviewKind, at: now.at })
    } else if (before === 'approved') {
      events.push({ user: now.user, state: 'unapproved' })
    }
  }
  for (const [id, before] of Object.entries(previous ?? {})) {
    // An approver who is no reviewer disappears from both lists when they revoke
    if (before.state === 'approved' && !current.has(Number(id))) {
      events.push({ user: before.user, state: 'unapproved' })
    }
  }
  return events
}

export function reviewRecord (current: Map<number, UserReviewState>): ReviewRecord {
  const record: ReviewRecord = {}
  for (const [id, it] of current) {
    record[String(id)] = { user: it.user, state: it.state }
  }
  return record
}

/** Set equality, ignoring order and duplicates. */
export function sameMembers<T> (a: T[] | null | undefined, b: T[] | null | undefined): boolean {
  const left = new Set(a ?? [])
  const right = new Set(b ?? [])
  return left.size === right.size && [...left].every((it) => right.has(it))
}

/**
 * Reviewer states and approvals: while the merge request is open, and once on its first import.
 * Undefined when not needed or not available; reviews, approvers and ToDos then stay as they are.
 */
export async function fetchReviewStatus (
  ctx: MeasureContext,
  provider: SyncProvider,
  repo: RepositoryContext,
  info: DocSyncInfo,
  external: GitlabMergeRequestInfo
): Promise<ReviewStatus | undefined> {
  const open = mergeRequestSyncState(external.state) === 'opened'
  if (!open && info.reviews !== undefined) return undefined
  try {
    const api = await provider.integrationApi(repo.integration)
    if (api === undefined) return undefined
    const projectId = repo.repository.projectId
    const [reviewers, approvals] = await Promise.all([
      api.listMergeRequestReviewers(projectId, external.iid),
      api.getMergeRequestApprovals(projectId, external.iid)
    ])
    return { reviewers, approvals }
  } catch (err: unknown) {
    ctx.warn('gitlab review states unavailable, reviews and ToDos left as they are', {
      key: info.key,
      error: errorMessage(err)
    })
    return undefined
  }
}

/** Review messages for review state changes, and the approvers mirrored on the merge request. */
export async function syncMergeRequestReviews (
  provider: SyncProvider,
  repo: RepositoryContext,
  mergeRequest: GitlabMergeRequest,
  info: DocSyncInfo,
  external: GitlabMergeRequestInfo,
  status: ReviewStatus
): Promise<DocumentUpdate<DocSyncInfo>> {
  const { persons, client } = provider
  const current = effectiveReviewStates(status)
  const previous = info.reviews as ReviewRecord | undefined
  // First import: at the merge request's last update; later: when the change was seen
  const fallback = previous === undefined ? Date.parse(external.updated_at) : provider.now()
  for (const event of reviewEvents(previous, current)) {
    // A time from the sync clock is no identity: two changes of one user may be seen within one millisecond
    const seenNow = event.at === undefined && previous !== undefined
    await createReview(
      provider,
      repo,
      mergeRequest,
      info,
      event,
      event.at !== undefined ? Date.parse(event.at) : fallback,
      seenNow
    )
    // Recorded at once: a failure later in this sync must not write the message again
    await recordSeen(provider, info, event.user.id, current.get(event.user.id))
  }
  const approvedBy: Array<Ref<Person>> = []
  for (const approval of status.approvals.approved_by) {
    const person = await persons.personRefFor(repo.integration.host, approval.user)
    if (person !== null) approvedBy.push(person)
  }
  if (!sameMembers(approvedBy, mergeRequest.approvedBy)) {
    await client.update(mergeRequest, { approvedBy: approvedBy.sort() })
  }
  return { reviews: reviewRecord(current) }
}

async function createReview (
  provider: SyncProvider,
  repo: RepositoryContext,
  mergeRequest: GitlabMergeRequest,
  info: DocSyncInfo,
  event: ReviewEvent,
  at: number,
  seenNow: boolean
): Promise<void> {
  const { client, derived } = provider
  const known = async (time: number): Promise<DocSyncInfo | undefined> =>
    await derived.findOne(gitlab.class.DocSyncInfo, {
      space: info.space,
      key: reviewKey(info.key, event.user.id, time)
    })
  if (!seenNow) {
    // A GitLab time or the first import's time identifies the change: an existing key means it is already written
    const written = await known(at)
    if (written !== undefined) {
      // Its message is missing when an earlier sync failed between the two writes
      const id = written._id as unknown as Ref<GitlabReview>
      if (written.deleted !== true && (await client.findOne(gitlab.class.GitlabReview, { _id: id })) === undefined) {
        await addReviewMessage(provider, repo, mergeRequest, event, at, id)
      }
      return
    }
  }
  if (seenNow) {
    while ((await known(at)) !== undefined) at++
  }
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
      attachedTo: mergeRequest._id
    },
    id as unknown as Ref<DocSyncInfo>
  )
  await addReviewMessage(provider, repo, mergeRequest, event, at, id)
}

async function addReviewMessage (
  provider: SyncProvider,
  repo: RepositoryContext,
  mergeRequest: GitlabMergeRequest,
  event: ReviewEvent,
  at: number,
  id: Ref<GitlabReview>
): Promise<void> {
  const author = await provider.persons.personIdFor(repo.integration.host, event.user)
  await provider.client.addCollection(
    gitlab.class.GitlabReview,
    mergeRequest.space,
    mergeRequest._id,
    mergeRequest._class,
    'activity',
    { state: event.state },
    id,
    at,
    author
  )
}

/** Stores one user's review state as seen on the merge request's sync doc; undefined drops it (a revoked approver). */
async function recordSeen (
  provider: SyncProvider,
  info: DocSyncInfo,
  userId: number,
  state: UserReviewState | undefined
): Promise<void> {
  const { derived } = provider
  const fresh = await derived.findOne(gitlab.class.DocSyncInfo, { _id: info._id })
  if (fresh === undefined) return
  const user = String(userId)
  const reviews: ReviewRecord = Object.fromEntries(
    Object.entries((fresh.reviews ?? {}) as ReviewRecord).filter(([key]) => key !== user)
  )
  if (state !== undefined) {
    reviews[user] = { user: state.user, state: state.state }
  }
  await derived.update(fresh, { reviews })
}

// GitLab refuses: approving one's own merge request, missing permission, approvals switched off
const REFUSED = [401, 403, 404, 405, 422]

/** Approvals and revocations written in Huly; reviews from GitLab are done when created. */
export class ReviewSyncManager implements DocSyncManager {
  constructor (private readonly provider: SyncProvider) {}

  async sync (
    ctx: MeasureContext,
    existing: Doc | undefined,
    info: DocSyncInfo,
    parent: DocSyncInfo | undefined
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    if (info.key !== '') return SYNC_DONE
    const review = existing as GitlabReview | undefined
    if (review === undefined || parent === undefined || parent.key === '') return SYNC_DONE
    if (parent.objectClass !== gitlab.class.GitlabMergeRequest) return SYNC_DONE
    const repo = this.provider.repositoryContext(parent.repository)
    if (repo === undefined) return SYNC_DONE
    if (review.state !== 'approved' && review.state !== 'unapproved') {
      return await this.refuse(ctx, review, 'Only approvals can be given from Huly')
    }
    const own = await this.provider.userApi(repo.integration, review.createdBy ?? review.modifiedBy)
    if (own === undefined) {
      return await this.refuse(ctx, review, 'Approving in GitLab needs your own GitLab connection')
    }
    const approve = review.state === 'approved'
    const projectId = repo.repository.projectId
    let changed = false
    try {
      changed = await this.provider.runner.exec(parent.key, async () => {
        const approvals = await own.api.getMergeRequestApprovals(projectId, parent.gitlabIid)
        const approved = approvals.approved_by.some((it) => it.user.id === own.user.id)
        if (approve === approved) return false
        if (approve) await own.api.approveMergeRequest(projectId, parent.gitlabIid)
        else await own.api.unapproveMergeRequest(projectId, parent.gitlabIid)
        await this.recordState(parent, own.user, review.state)
        return true
      })
    } catch (err: unknown) {
      if (err instanceof GitlabApiError && REFUSED.includes(err.status)) {
        return await this.refuse(ctx, review, errorMessage(err))
      }
      throw err
    }
    // A second click, or a state set in GitLab meanwhile: the message would repeat the one already shown
    if (!changed) return await this.reject(ctx, review, 'GitLab already shows this approval state')
    return {
      ...SYNC_DONE,
      key: reviewKey(parent.key, own.user.id, review.createdOn ?? review.modifiedOn),
      parent: parent.key,
      repository: repo.repository._id,
      error: null
    }
  }

  /** A review removed in Huly changes nothing in GitLab. */
  async handleDelete (_ctx: MeasureContext, _info: DocSyncInfo): Promise<boolean> {
    return true
  }

  /**
   * Records the new state as seen, so the merge request sync adds no second message for it, and queues the merge
   * request so its approvers and ToDos follow.
   */
  private async recordState (parent: DocSyncInfo, user: GitlabUserRef, state: GitlabReviewState): Promise<void> {
    const fresh = await this.provider.derived.findOne(gitlab.class.DocSyncInfo, { _id: parent._id })
    if (fresh === undefined) return
    const reviews: ReviewRecord = { ...((fresh.reviews ?? {}) as ReviewRecord), [String(user.id)]: { user, state } }
    await this.provider.derived.update(fresh, { reviews, needSync: '' })
    this.provider.triggerSync()
  }

  /**
   * A review GitLab did not take stays in Huly, marked as not sent; the worker shows the error on it.
   * The approvals footer reads approvedBy from GitLab, so the message claims no approval.
   */
  private async refuse (ctx: MeasureContext, review: GitlabReview, error: string): Promise<DocumentUpdate<DocSyncInfo>> {
    ctx.warn('gitlab review not sent', { review: review._id, error })
    return { ...SYNC_DONE, error, retryable: false }
  }

  /** Removes a review message that repeats the state GitLab already shows (a double click). */
  private async reject (ctx: MeasureContext, review: GitlabReview, error: string): Promise<DocumentUpdate<DocSyncInfo>> {
    ctx.warn('gitlab review not sent, removed from Huly', { review: review._id, error })
    // Written as System, so the trigger does not queue the removal
    await removeAttached(this.provider.client, review)
    // The sync doc stays as a tombstone with the error
    return { ...SYNC_DONE, deleted: true, error, retryable: false }
  }
}
