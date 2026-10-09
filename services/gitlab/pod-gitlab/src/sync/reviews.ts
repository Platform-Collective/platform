// SPDX-License-Identifier: EPL-2.0

import type { Doc, DocumentUpdate, MeasureContext } from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabReview, type GitlabReviewKind } from '@hcengineering/gitlab'
import { GitlabApiError } from '../gitlab/api'
import type { GitlabApprovals, GitlabMergeRequestReviewer, GitlabReviewState, GitlabUserRef } from '../gitlab/types'
import { errorMessage } from './errors'
import { reviewKey } from './keys'
import type { DocSyncManager, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION } from './versions'

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
export interface ReviewRecord {
  [gitlabUserId: string]: UserReviewState
}

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

const DONE: DocumentUpdate<DocSyncInfo> = { needSync: GITLAB_SYNC_VERSION }

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
    if (info.key !== '') return DONE
    const review = existing as GitlabReview | undefined
    if (review === undefined || parent === undefined || parent.key === '') return DONE
    if (parent.objectClass !== gitlab.class.GitlabMergeRequest) return DONE
    const repo = this.provider.repositoryContext(parent.repository)
    if (repo === undefined) return DONE
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
      ...DONE,
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
    return { ...DONE, error, retryable: false }
  }

  /** Removes a review message that repeats the state GitLab already shows (a double click). */
  private async reject (ctx: MeasureContext, review: GitlabReview, error: string): Promise<DocumentUpdate<DocSyncInfo>> {
    ctx.warn('gitlab review not sent, removed from Huly', { review: review._id, error })
    // Written as System, so the trigger does not queue the removal
    await this.provider.client.removeCollection(
      review._class,
      review.space,
      review._id,
      review.attachedTo,
      review.attachedToClass,
      review.collection
    )
    // The sync doc stays as a tombstone with the error
    return { ...DONE, deleted: true, error, retryable: false }
  }
}
