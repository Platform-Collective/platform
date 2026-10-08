// SPDX-License-Identifier: EPL-2.0

import chunter, { type ChatMessage } from '@hcengineering/chunter'
import type { Doc, DocumentUpdate, Markup, MeasureContext, PersonId, Ref } from '@hcengineering/core'
import gitlab, { type DocSyncInfo } from '@hcengineering/gitlab'
import { areEqualMarkups } from '@hcengineering/text'
import tracker, { type Issue } from '@hcengineering/tracker'
import type { GitlabApi } from '../gitlab/api'
import type { GitlabIssueInfo, GitlabNoteInfo } from '../gitlab/types'
import { issueKey, noteKey } from './keys'
import { compareMarkdown, mergeFields } from './merge'
import type { DocSyncManager, RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION } from './versions'

export interface NoteSnapshot {
  message: Markup
}

const DONE: DocumentUpdate<DocSyncInfo> = { needSync: GITLAB_SYNC_VERSION }

/** Notes written by people and visible to everyone who sees the issue. */
export function isSyncedNote (note: GitlabNoteInfo): boolean {
  return !note.system && note.internal !== true && note.confidential !== true
}

export class NoteSyncManager implements DocSyncManager {
  constructor (private readonly provider: SyncProvider) {}

  /** Fetches the note a webhook names; serialised with note creation on the same issue. */
  async handleNoteEvent (ctx: MeasureContext, repo: RepositoryContext, api: GitlabApi, iid: number, noteId: number): Promise<void> {
    const parent = issueKey(repo.integration.host, repo.repository.projectId, iid)
    await this.provider.runner.exec(parent, async () => {
      const note = await api.getIssueNote(repo.repository.projectId, iid, noteId)
      await this.upsertExternal(repo, parent, note)
    })
  }

  /** Stores every note of an issue and removes Huly comments whose note is gone from the complete listing. */
  async refreshNotes (ctx: MeasureContext, repo: RepositoryContext, api: GitlabApi, issue: GitlabIssueInfo): Promise<void> {
    if (issue.confidential) return
    const parent = issueKey(repo.integration.host, repo.repository.projectId, issue.iid)
    await this.provider.runner.exec(parent, async () => {
      const notes = (await api.listIssueNotes(repo.repository.projectId, issue.iid)).filter(isSyncedNote)
      for (const note of notes) {
        await this.upsertExternal(repo, parent, note)
      }
      const present = new Set(notes.map((it) => noteKey(parent, it.id)))
      const known = await this.provider.derived.findAll(gitlab.class.DocSyncInfo, {
        space: repo.project._id,
        parent,
        objectClass: chunter.class.ChatMessage
      })
      for (const info of known) {
        if (info.key !== '' && !present.has(info.key)) {
          await this.removeDeletedNote(ctx, info)
        }
      }
    })
  }

  async sync (
    ctx: MeasureContext,
    existing: Doc | undefined,
    info: DocSyncInfo,
    parent: DocSyncInfo | undefined
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    if (info.objectClass !== chunter.class.ChatMessage) return DONE
    if (info.key === '') {
      return await this.createInGitlab(existing as ChatMessage | undefined, info, parent)
    }
    const repo = this.provider.repositoryContext(info.repository)
    const external = info.external as GitlabNoteInfo | undefined
    if (repo === undefined || external === undefined || parent === undefined) return DONE
    if (existing === undefined) {
      return await this.createInHuly(repo, info, parent, external)
    }
    return await this.mergeExisting(repo, existing as ChatMessage, info, parent, external)
  }

  async handleDelete (ctx: MeasureContext, info: DocSyncInfo): Promise<boolean> {
    const external = info.external as GitlabNoteInfo | undefined
    const repo = this.provider.repositoryContext(info.repository)
    if (external === undefined || info.key === '' || info.parent === undefined || repo === undefined) return true
    const parent = await this.provider.derived.findOne(gitlab.class.DocSyncInfo, { key: info.parent })
    // Comments removed together with their issue: the GitLab issue is closed, its notes stay
    if (parent === undefined || parent.deleted === true) return true
    const issue = await this.provider.client.findOne(tracker.class.Issue, { _id: parent._id as unknown as Ref<Issue> })
    if (issue === undefined) return true
    const api = await this.provider.integrationApi(repo.integration)
    if (api === undefined) {
      throw new Error('GitLab authorization expired')
    }
    await api.deleteIssueNote(repo.repository.projectId, parent.gitlabIid, external.id)
    return true
  }

  private async upsertExternal (repo: RepositoryContext, parent: string, note: GitlabNoteInfo): Promise<void> {
    if (!isSyncedNote(note)) return
    const { derived } = this.provider
    const key = noteKey(parent, note.id)
    const lastModified = Date.parse(note.updated_at)
    const info = await derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key })
    if (info === undefined) {
      await derived.createDoc(gitlab.class.DocSyncInfo, repo.project._id, {
        key,
        parent,
        objectClass: chunter.class.ChatMessage,
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

  private async removeDeletedNote (ctx: MeasureContext, info: DocSyncInfo): Promise<void> {
    const message = await this.provider.client.findOne(chunter.class.ChatMessage, { _id: info._id as unknown as Ref<ChatMessage> })
    if (message !== undefined) {
      // Written as System, so the trigger does not queue a deletion back to GitLab
      await this.provider.client.removeCollection(
        message._class,
        message.space,
        message._id,
        message.attachedTo,
        message.attachedToClass,
        message.collection
      )
    }
    await this.provider.derived.remove(info)
    ctx.info('gitlab note deleted, Huly comment removed', { key: info.key })
  }

  private async createInGitlab (
    message: ChatMessage | undefined,
    info: DocSyncInfo,
    parent: DocSyncInfo | undefined
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    // The issue sync re-queues its comments once the GitLab issue exists
    if (message === undefined || parent === undefined || parent.key === '') return DONE
    const repo = this.provider.repositoryContext(parent.repository)
    if (repo === undefined) return DONE
    const body = this.provider.markdown.toMarkdown(message.message)
    if (body.trim() === '') return DONE
    const api = await this.provider.apiFor(repo.integration, message.modifiedBy)
    if (api === undefined) {
      return { ...DONE, error: 'GitLab authorization expired', retryable: true }
    }
    const parentKey = parent.key
    return await this.provider.runner.exec(parentKey, async () => {
      const note = await api.createIssueNote(repo.repository.projectId, parent.gitlabIid, body)
      const update: DocumentUpdate<DocSyncInfo> = {
        key: noteKey(parentKey, note.id),
        parent: parentKey,
        repository: repo.repository._id,
        external: note,
        current: { message: message.message },
        lastModified: Date.parse(note.updated_at),
        needSync: GITLAB_SYNC_VERSION,
        error: null
      }
      // Stored before the lock is released, so the webhook for this note finds it instead of importing a copy
      await this.provider.derived.update(info, update)
      return update
    })
  }

  private async createInHuly (
    repo: RepositoryContext,
    info: DocSyncInfo,
    parent: DocSyncInfo,
    external: GitlabNoteInfo
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const issue = await this.provider.client.findOne(tracker.class.Issue, { _id: parent._id as unknown as Ref<Issue> })
    // Created once the issue arrives: the issue sync re-queues its notes
    if (issue === undefined) return DONE
    const message = this.provider.markdown.toMarkup(external.body)
    const author: PersonId = await this.provider.persons.personIdFor(repo.integration.host, external.author)
    await this.provider.client.addCollection(
      chunter.class.ChatMessage,
      info.space,
      issue._id,
      issue._class,
      'comments',
      { message, attachments: 0 },
      info._id as unknown as Ref<ChatMessage>,
      Date.parse(external.created_at),
      author
    )
    return { ...DONE, current: { message }, error: null }
  }

  private async mergeExisting (
    repo: RepositoryContext,
    message: ChatMessage,
    info: DocSyncInfo,
    parent: DocSyncInfo,
    external: GitlabNoteInfo
  ): Promise<DocumentUpdate<DocSyncInfo>> {
    const remote: NoteSnapshot = { message: this.provider.markdown.toMarkup(external.body) }
    const base = (info.current as NoteSnapshot | undefined) ?? remote
    const { toPlatform, toGitlab, merged } = mergeFields(base, { message: message.message }, remote, { message: areEqualMarkups })
    let latest = external
    if (toGitlab.message !== undefined) {
      const body = this.provider.markdown.toMarkdown(toGitlab.message)
      if (!compareMarkdown(body, external.body)) {
        const api = await this.provider.apiFor(repo.integration, message.modifiedBy)
        if (api === undefined) {
          return { ...DONE, error: 'GitLab authorization expired', retryable: true }
        }
        latest = await this.provider.runner.exec(parent.key, async () => {
          const updated = await api.updateIssueNote(repo.repository.projectId, parent.gitlabIid, external.id, body)
          await this.provider.derived.update(info, { external: updated, current: merged, lastModified: Date.parse(updated.updated_at) })
          return updated
        })
      }
    }
    if (toPlatform.message !== undefined) {
      const author = await this.provider.persons.personIdFor(repo.integration.host, external.author)
      await this.provider.client.update(message, { message: toPlatform.message }, false, Date.parse(external.updated_at), author)
    }
    return { ...DONE, current: merged, external: latest, lastModified: Date.parse(latest.updated_at), error: null }
  }
}
