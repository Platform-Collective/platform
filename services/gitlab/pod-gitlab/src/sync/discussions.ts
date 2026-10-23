// SPDX-License-Identifier: EPL-2.0

import core, { type Doc, type DocumentUpdate, type MeasureContext, type PersonId, type Ref } from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabMergeRequest, type GitlabReviewThread } from '@hcengineering/gitlab'
import { type GitlabApi, isNotFound } from '../gitlab/api'
import type { GitlabDiffPosition, GitlabDiscussion, GitlabMergeRequestInfo, GitlabUserRef } from '../gitlab/types'
import { discussionKey, mergeRequestKey } from './keys'
import { mergeFields } from './merge'
import { isTombstoned, isVisibleNote } from './notes'
import { removeAttached, requeueSyncDocs } from './docs'
import { EXPIRED_ERROR } from './errors'
import type { ReviewCommentSyncManager } from './review-comments'
import type { DocSyncManager, RepositoryContext, SyncProvider } from './types'
import { SYNC_DONE } from './versions'

/** What the pod keeps of a diff discussion in DocSyncInfo.external. */
export interface ThreadExternal {
  id: string
  resolved: boolean
  resolvedBy: GitlabUserRef | null
  position: GitlabDiffPosition
  author: GitlabUserRef
  createdAt: string
  // Written on an older head commit than the merge request's current one
  outdated: boolean
}

export interface ThreadSnapshot {
  isResolved: boolean
}

/** A discussion on a diff line; other discussions stay plain comments. */
function isDiffDiscussion (discussion: GitlabDiscussion): boolean {
  const first = discussion.notes[0]
  return first !== undefined && isVisibleNote(first) && first.type === 'DiffNote' && first.position != null
}

function threadExternal (discussion: GitlabDiscussion, headSha: string | null): ThreadExternal {
  const first = discussion.notes[0]
  const position = first.position as GitlabDiffPosition
  const resolvable = discussion.notes.filter((it) => it.resolvable === true)
  const resolved = resolvable.length > 0 && resolvable.every((it) => it.resolved === true)
  return {
    id: discussion.id,
    resolved,
    resolvedBy: resolved ? (resolvable.find((it) => it.resolved_by != null)?.resolved_by ?? null) : null,
    position,
    author: first.author,
    createdAt: first.created_at,
    outdated: headSha !== null && position.head_sha !== headSha
  }
}

function samePosition (a: GitlabDiffPosition, b: GitlabDiffPosition): boolean {
  return (
    a.head_sha === b.head_sha &&
    a.new_path === b.new_path &&
    a.old_path === b.old_path &&
    a.new_line === b.new_line &&
    a.old_line === b.old_line
  )
}

// GitLab moves a thread's position when a push shifts its line
function sameThread (a: ThreadExternal | undefined, b: ThreadExternal): boolean {
  return (
    a !== undefined &&
    a.resolved === b.resolved &&
    a.resolvedBy?.id === b.resolvedBy?.id &&
    a.outdated === b.outdated &&
    samePosition(a.position, b.position)
  )
}

/** Diff discussions of merge requests as review threads. */
export class ReviewThreadSyncManager implements DocSyncManager {
  constructor (
    private readonly provider: SyncProvider,
    private readonly comments: ReviewCommentSyncManager
  ) {}

  /** Stores every diff discussion of a merge request, and removes Huly threads whose discussion is gone. */
  async refreshDiscussions (ctx: MeasureContext, repo: RepositoryContext, api: GitlabApi, iid: number): Promise<void> {
    const mrKey = mergeRequestKey(repo.integration.host, repo.repository.projectId, iid)
    await this.provider.runner.exec(mrKey, async () => {
      if (await isTombstoned(this.provider, repo, mrKey)) return
      const headSha = await this.headSha(repo, mrKey)
      const discussions = (await api.listMergeRequestDiscussions(repo.repository.projectId, iid)).filter(
        isDiffDiscussion
      )
      for (const discussion of discussions) {
        await this.store(ctx, repo, mrKey, discussion, headSha)
      }
      const present = new Set(discussions.map((it) => discussionKey(mrKey, it.id)))
      const known = await this.provider.derived.findAll(gitlab.class.DocSyncInfo, {
        space: repo.project._id,
        parent: mrKey,
        objectClass: gitlab.class.GitlabReviewThread
      })
      for (const info of known) {
        if (!present.has(info.key)) await this.removeThread(ctx, info)
      }
    })
  }

  /** Fetches the discussion a diff note webhook names; a 404 means it was deleted. */
  async handleDiscussionEvent (
    ctx: MeasureContext,
    repo: RepositoryContext,
    api: GitlabApi,
    iid: number,
    discussionId: string
  ): Promise<void> {
    const mrKey = mergeRequestKey(repo.integration.host, repo.repository.projectId, iid)
    await this.provider.runner.exec(mrKey, async () => {
      if (await isTombstoned(this.provider, repo, mrKey)) return
      let discussion: GitlabDiscussion
      try {
        discussion = await api.getMergeRequestDiscussion(repo.repository.projectId, iid, discussionId)
      } catch (err: unknown) {
        if (isNotFound(err)) {
          const info = await this.provider.derived.findOne(gitlab.class.DocSyncInfo, {
            space: repo.project._id,
            key: discussionKey(mrKey, discussionId)
          })
          if (info !== undefined) await this.removeThread(ctx, info)
          return
        }
        throw err
      }
      if (!isDiffDiscussion(discussion)) return
      await this.store(ctx, repo, mrKey, discussion, await this.headSha(repo, mrKey))
    })
  }

  async sync (
    ctx: MeasureContext,
    existing: Doc | undefined,
    info: DocSyncInfo,
    parent: DocSyncInfo | undefined
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    // Threads start in GitLab only
    if (info.key === '') return SYNC_DONE
    const repo = this.provider.repositoryContext(info.repository)
    const external = info.external as ThreadExternal | undefined
    if (repo === undefined || external === undefined || parent === undefined) return SYNC_DONE
    if (existing === undefined) {
      return await this.createInHuly(repo, info, parent, external)
    }
    return await this.mergeExisting(repo, existing as GitlabReviewThread, info, parent, external)
  }

  /** A thread deleted in Huly stays in GitLab; its sync doc stays as a tombstone, so it is not imported again. */
  async handleDelete (ctx: MeasureContext, info: DocSyncInfo): Promise<boolean> {
    ctx.info('gitlab review thread deleted in Huly, GitLab left unchanged', { key: info.key })
    return false
  }

  private async headSha (repo: RepositoryContext, mrKey: string): Promise<string | null> {
    const info = await this.provider.derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key: mrKey })
    return (info?.external as GitlabMergeRequestInfo | undefined)?.sha ?? null
  }

  private async store (
    ctx: MeasureContext,
    repo: RepositoryContext,
    mrKey: string,
    discussion: GitlabDiscussion,
    headSha: string | null
  ): Promise<void> {
    const { derived } = this.provider
    const key = discussionKey(mrKey, discussion.id)
    const external = threadExternal(discussion, headSha)
    const info = await derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key })
    if (info === undefined) {
      await derived.createDoc(gitlab.class.DocSyncInfo, repo.project._id, {
        key,
        parent: mrKey,
        objectClass: gitlab.class.GitlabReviewThread,
        repository: repo.repository._id,
        gitlabIid: 0,
        external,
        needSync: '',
        lastModified: this.provider.now()
      })
      this.provider.triggerSync()
    } else if (info.deleted === true) {
      // A thread deleted in Huly keeps its comments out too
      return
    } else if (!sameThread(info.external as ThreadExternal | undefined, external)) {
      await derived.update(info, { external, needSync: '', lastModified: this.provider.now(), error: null })
      this.provider.triggerSync()
    }
    await this.comments.storeNotes(ctx, repo, key, discussion.notes)
  }

  private async removeThread (ctx: MeasureContext, info: DocSyncInfo): Promise<void> {
    const { client, derived } = this.provider
    await this.comments.removeAll(ctx, info.key)
    const thread = await client.findOne(gitlab.class.GitlabReviewThread, {
      _id: info._id as unknown as Ref<GitlabReviewThread>
    })
    if (thread !== undefined) {
      // Written as System, so the trigger does not queue anything back to GitLab
      await removeAttached(client, thread)
    }
    await derived.remove(info)
    ctx.info('gitlab discussion gone, Huly review thread removed', { key: info.key })
  }

  private async createInHuly (
    repo: RepositoryContext,
    info: DocSyncInfo,
    parent: DocSyncInfo,
    external: ThreadExternal
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const { client, derived, persons } = this.provider
    const mr = await client.findOne(gitlab.class.GitlabMergeRequest, {
      _id: parent._id as unknown as Ref<GitlabMergeRequest>
    })
    // Created once the merge request exists: its sync re-queues its threads
    if (mr === undefined) return SYNC_DONE
    const host = repo.integration.host
    const author = await persons.personIdFor(host, external.author)
    await client.addCollection(
      gitlab.class.GitlabReviewThread,
      info.space,
      mr._id,
      mr._class,
      'activity',
      {
        discussionId: external.id,
        path: external.position.new_path,
        oldPath: external.position.old_path,
        line: external.position.new_line,
        oldLine: external.position.old_line,
        isResolved: external.resolved,
        resolvedBy: external.resolvedBy === null ? null : await persons.personIdFor(host, external.resolvedBy),
        isOutdated: external.outdated
      },
      info._id as unknown as Ref<GitlabReviewThread>,
      Date.parse(external.createdAt),
      author
    )
    // Comments that arrived before their thread can now be created
    await requeueSyncDocs(derived, { parent: info.key })
    return { ...SYNC_DONE, current: { isResolved: external.resolved }, error: null }
  }

  private async mergeExisting (
    repo: RepositoryContext,
    thread: GitlabReviewThread,
    info: DocSyncInfo,
    parent: DocSyncInfo,
    external: ThreadExternal
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const { persons } = this.provider
    const remote: ThreadSnapshot = { isResolved: external.resolved }
    const base = (info.current as ThreadSnapshot | undefined) ?? remote
    const { toPlatform, toGitlab, merged } = mergeFields(base, { isResolved: thread.isResolved }, remote)
    let latest = external
    if (toGitlab.isResolved !== undefined) {
      const api = await this.provider.apiFor(repo.integration, thread.modifiedBy)
      if (api === undefined) {
        return { ...SYNC_DONE, error: EXPIRED_ERROR, retryable: true }
      }
      const resolved = toGitlab.isResolved
      latest = await this.provider.runner.exec(parent.key, async () => {
        const discussion = await api.resolveMergeRequestDiscussion(
          repo.repository.projectId,
          parent.gitlabIid,
          external.id,
          resolved
        )
        const updated: ThreadExternal = { ...threadExternal(discussion, null), outdated: external.outdated }
        await this.provider.derived.update(info, {
          external: updated,
          current: merged,
          lastModified: this.provider.now()
        })
        return updated
      })
    }
    const update: DocumentUpdate<GitlabReviewThread> = {}
    let actor: PersonId = core.account.System
    if (toPlatform.isResolved !== undefined) {
      update.isResolved = toPlatform.isResolved
      update.resolvedBy =
        latest.resolvedBy === null ? null : await persons.personIdFor(repo.integration.host, latest.resolvedBy)
      if (update.resolvedBy !== null) actor = update.resolvedBy
    }
    if (thread.isOutdated !== latest.outdated) update.isOutdated = latest.outdated
    const { position } = latest
    if (thread.path !== position.new_path) update.path = position.new_path
    if (thread.oldPath !== position.old_path) update.oldPath = position.old_path
    if (thread.line !== position.new_line) update.line = position.new_line
    if (thread.oldLine !== position.old_line) update.oldLine = position.old_line
    if (Object.keys(update).length > 0) {
      await this.provider.client.update(thread, update, false, this.provider.now(), actor)
    }
    return { ...SYNC_DONE, current: merged, external: latest, lastModified: this.provider.now(), error: null }
  }
}
