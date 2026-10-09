// SPDX-License-Identifier: EPL-2.0

import type { Doc, DocumentUpdate, Markup, MeasureContext, PersonId, Ref } from '@hcengineering/core'
import gitlab, {
  type DocSyncInfo,
  type GitlabMergeRequest,
  type GitlabReviewComment,
  type GitlabReviewThread
} from '@hcengineering/gitlab'
import { areEqualMarkups } from '@hcengineering/text'
import type { GitlabNoteInfo } from '../gitlab/types'
import { discussionIdOf, discussionKey, noteKey } from './keys'
import { compareMarkdown, mergeFields } from './merge'
import { isVisibleNote } from './notes'
import type { DocSyncManager, RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION } from './versions'

export interface CommentSnapshot {
  body: Markup
}

/** The sync docs a GitLab-born review comment hangs off. */
interface CommentContext {
  thread: DocSyncInfo
  mergeRequest: DocSyncInfo
}

const DONE: DocumentUpdate<DocSyncInfo> = { needSync: GITLAB_SYNC_VERSION }

/** The notes of diff discussions. */
export class ReviewCommentSyncManager implements DocSyncManager {
  constructor (private readonly provider: SyncProvider) {}

  /** Stores the notes of one diff discussion and removes Huly comments whose note is gone. Runs inside the merge request's lock. */
  async storeNotes (
    ctx: MeasureContext,
    repo: RepositoryContext,
    threadKey: string,
    notes: GitlabNoteInfo[]
  ): Promise<void> {
    const kept = notes.filter(isVisibleNote)
    for (const note of kept) {
      await this.upsertExternal(repo, threadKey, note)
    }
    const present = new Set(kept.map((it) => noteKey(threadKey, it.id)))
    const known = await this.provider.derived.findAll(gitlab.class.DocSyncInfo, {
      space: repo.project._id,
      parent: threadKey,
      objectClass: gitlab.class.GitlabReviewComment
    })
    for (const info of known) {
      if (info.key !== '' && !present.has(info.key)) {
        await this.removeComment(ctx, info)
      }
    }
  }

  /** Removes every Huly comment of a discussion that is gone from GitLab. */
  async removeAll (ctx: MeasureContext, threadKey: string): Promise<void> {
    const known = await this.provider.derived.findAll(gitlab.class.DocSyncInfo, {
      parent: threadKey,
      objectClass: gitlab.class.GitlabReviewComment
    })
    for (const info of known) {
      await this.removeComment(ctx, info)
    }
  }

  async sync (
    ctx: MeasureContext,
    existing: Doc | undefined,
    info: DocSyncInfo,
    parent: DocSyncInfo | undefined
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    if (info.objectClass !== gitlab.class.GitlabReviewComment) return DONE
    if (info.key === '') {
      return await this.createInGitlab(existing as GitlabReviewComment | undefined, info, parent)
    }
    const repo = this.provider.repositoryContext(info.repository)
    const external = info.external as GitlabNoteInfo | undefined
    const context = parent === undefined ? undefined : await this.contextOf(parent)
    if (repo === undefined || external === undefined || context === undefined) return DONE
    if (existing === undefined) {
      return await this.createInHuly(repo, info, context, external)
    }
    return await this.mergeExisting(repo, existing as GitlabReviewComment, info, context, external)
  }

  async handleDelete (ctx: MeasureContext, info: DocSyncInfo): Promise<boolean> {
    const external = info.external as GitlabNoteInfo | undefined
    const repo = this.provider.repositoryContext(info.repository)
    if (external === undefined || info.key === '' || info.parent === undefined || repo === undefined) return true
    const thread = await this.provider.derived.findOne(gitlab.class.DocSyncInfo, { key: info.parent })
    const context = thread === undefined ? undefined : await this.contextOf(thread)
    // Removed with its merge request, or its thread is gone: the GitLab note stays
    if (context === undefined || context.thread.deleted === true || context.mergeRequest.deleted === true) return true
    if ((await this.mergeRequestDoc(context.mergeRequest)) === undefined) return true
    const api = await this.provider.integrationApi(repo.integration)
    if (api === undefined) {
      throw new Error('GitLab authorization expired')
    }
    await api.deleteMergeRequestDiscussionNote(
      repo.repository.projectId,
      context.mergeRequest.gitlabIid,
      discussionIdOf(context.thread.key),
      external.id
    )
    return true
  }

  private async contextOf (thread: DocSyncInfo): Promise<CommentContext | undefined> {
    if (thread.objectClass !== gitlab.class.GitlabReviewThread || thread.parent === undefined) return undefined
    const mergeRequest = await this.provider.derived.findOne(gitlab.class.DocSyncInfo, {
      space: thread.space,
      key: thread.parent
    })
    return mergeRequest === undefined ? undefined : { thread, mergeRequest }
  }

  private async mergeRequestDoc (info: DocSyncInfo): Promise<GitlabMergeRequest | undefined> {
    return await this.provider.client.findOne(gitlab.class.GitlabMergeRequest, {
      _id: info._id as unknown as Ref<GitlabMergeRequest>
    })
  }

  private async upsertExternal (repo: RepositoryContext, threadKey: string, note: GitlabNoteInfo): Promise<void> {
    const { derived } = this.provider
    const key = noteKey(threadKey, note.id)
    const lastModified = Date.parse(note.updated_at)
    const info = await derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key })
    if (info === undefined) {
      await derived.createDoc(gitlab.class.DocSyncInfo, repo.project._id, {
        key,
        parent: threadKey,
        objectClass: gitlab.class.GitlabReviewComment,
        repository: repo.repository._id,
        gitlabIid: 0,
        external: note,
        needSync: '',
        lastModified
      })
    } else {
      const stored = info.external as GitlabNoteInfo | undefined
      if (stored !== undefined && Date.parse(stored.updated_at) >= lastModified) return
      await derived.update(info, { external: note, needSync: '', lastModified, error: null })
    }
    this.provider.triggerSync()
  }

  private async removeComment (ctx: MeasureContext, info: DocSyncInfo): Promise<void> {
    await this.removeHulyComment(info)
    await this.provider.derived.remove(info)
    ctx.info('gitlab discussion note gone, Huly review comment removed', { key: info.key })
  }

  // Written as System, so the trigger does not queue a deletion back to GitLab
  private async removeHulyComment (info: DocSyncInfo): Promise<void> {
    const { client } = this.provider
    const comment = await client.findOne(gitlab.class.GitlabReviewComment, {
      _id: info._id as unknown as Ref<GitlabReviewComment>
    })
    if (comment !== undefined) {
      await client.removeCollection(
        comment._class,
        comment.space,
        comment._id,
        comment.attachedTo,
        comment.attachedToClass,
        comment.collection
      )
    }
  }

  /** A reply written in Huly: its sync doc points at the merge request until the GitLab note exists. */
  private async createInGitlab (
    comment: GitlabReviewComment | undefined,
    info: DocSyncInfo,
    parent: DocSyncInfo | undefined
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    if (comment === undefined || parent === undefined || parent.key === '') return DONE
    if (parent.objectClass !== gitlab.class.GitlabMergeRequest) return DONE
    const repo = this.provider.repositoryContext(parent.repository)
    if (repo === undefined) return DONE
    const threadKey = discussionKey(parent.key, comment.discussionId)
    const thread = await this.provider.derived.findOne(gitlab.class.DocSyncInfo, { space: info.space, key: threadKey })
    if (thread === undefined || thread.deleted === true) {
      return { ...DONE, error: 'The GitLab discussion of this comment is unknown', retryable: false }
    }
    const body = await this.provider.content.toMarkdown(repo, comment.body)
    if (body.trim() === '') return DONE
    const api = await this.provider.apiFor(repo.integration, comment.modifiedBy)
    if (api === undefined) {
      return { ...DONE, error: 'GitLab authorization expired', retryable: true }
    }
    return await this.provider.runner.exec(parent.key, async () => {
      const note = await api.createMergeRequestDiscussionNote(
        repo.repository.projectId,
        parent.gitlabIid,
        comment.discussionId,
        body
      )
      const update: DocumentUpdate<DocSyncInfo> = {
        key: noteKey(threadKey, note.id),
        parent: threadKey,
        repository: repo.repository._id,
        external: note,
        current: { body: comment.body },
        lastModified: Date.parse(note.updated_at),
        needSync: GITLAB_SYNC_VERSION,
        error: null
      }
      // Stored before the lock is released, so the refresh that lists this note finds it instead of importing a copy
      await this.provider.derived.update(info, update)
      return update
    })
  }

  private async createInHuly (
    repo: RepositoryContext,
    info: DocSyncInfo,
    context: CommentContext,
    external: GitlabNoteInfo
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const { client, persons } = this.provider
    if (context.thread.deleted === true) return DONE
    const mr = await this.mergeRequestDoc(context.mergeRequest)
    const thread = await client.findOne(gitlab.class.GitlabReviewThread, {
      _id: context.thread._id as unknown as Ref<GitlabReviewThread>
    })
    // Created once the thread exists: the thread's sync re-queues its comments
    if (mr === undefined || thread === undefined) return DONE
    const body = await this.provider.content.toMarkup(repo, external.body)
    const author: PersonId = await persons.personIdFor(repo.integration.host, external.author)
    await client.addCollection(
      gitlab.class.GitlabReviewComment,
      info.space,
      mr._id,
      mr._class,
      'reviewComments',
      { discussionId: thread.discussionId, body },
      info._id as unknown as Ref<GitlabReviewComment>,
      Date.parse(external.created_at),
      author
    )
    return { ...DONE, current: { body }, error: null }
  }

  private async mergeExisting (
    repo: RepositoryContext,
    comment: GitlabReviewComment,
    info: DocSyncInfo,
    context: CommentContext,
    external: GitlabNoteInfo
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const remote: CommentSnapshot = { body: await this.provider.content.toMarkup(repo, external.body) }
    const base = (info.current as CommentSnapshot | undefined) ?? remote
    const { toPlatform, toGitlab, merged } = mergeFields(base, { body: comment.body }, remote, {
      body: areEqualMarkups
    })
    let latest = external
    if (toGitlab.body !== undefined) {
      const body = await this.provider.content.toMarkdown(repo, toGitlab.body)
      if (!compareMarkdown(body, external.body)) {
        const api = await this.provider.apiFor(repo.integration, comment.modifiedBy)
        if (api === undefined) {
          return { ...DONE, error: 'GitLab authorization expired', retryable: true }
        }
        const { mergeRequest, thread } = context
        latest = await this.provider.runner.exec(mergeRequest.key, async () => {
          const updated = await api.updateMergeRequestDiscussionNote(
            repo.repository.projectId,
            mergeRequest.gitlabIid,
            discussionIdOf(thread.key),
            external.id,
            body
          )
          await this.provider.derived.update(info, {
            external: updated,
            current: merged,
            lastModified: Date.parse(updated.updated_at)
          })
          return updated
        })
      }
    }
    if (toPlatform.body !== undefined) {
      const author = await this.provider.persons.personIdFor(repo.integration.host, external.author)
      await this.provider.client.update(
        comment,
        { body: toPlatform.body },
        false,
        Date.parse(external.updated_at),
        author
      )
    }
    return { ...DONE, current: merged, external: latest, lastModified: Date.parse(latest.updated_at), error: null }
  }
}
