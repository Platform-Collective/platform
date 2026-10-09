// SPDX-License-Identifier: EPL-2.0

import attachment from '@hcengineering/attachment'
import chunter, { type ChatMessage } from '@hcengineering/chunter'
import { SortingOrder, type Doc, type DocumentUpdate, type Markup, type MeasureContext, type PersonId, type Ref } from '@hcengineering/core'
import gitlab, { type DocSyncInfo } from '@hcengineering/gitlab'
import { areEqualMarkups } from '@hcengineering/text'
import type { GitlabApi } from '../gitlab/api'
import type { GitlabNoteable, GitlabNoteInfo } from '../gitlab/types'
import { attachmentBlock, attachmentLink, splitAttachmentBlock, withAttachments } from './attachments'
import { errorMessage, isPermanentError } from './errors'
import { noteKey, objectKey } from './keys'
import { compareMarkdown, mergeFields } from './merge'
import type { DocSyncManager, RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION } from './versions'

export interface NoteSnapshot {
  message: Markup
}

/** What note syncing needs from an issue or merge request. */
export interface NoteTarget {
  iid: number
  // Issues only
  confidential?: boolean
}

interface NoteOps {
  list: (projectId: number, iid: number) => Promise<GitlabNoteInfo[]>
  get: (projectId: number, iid: number, noteId: number) => Promise<GitlabNoteInfo>
  create: (projectId: number, iid: number, body: string) => Promise<GitlabNoteInfo>
  update: (projectId: number, iid: number, noteId: number, body: string) => Promise<GitlabNoteInfo>
  remove: (projectId: number, iid: number, noteId: number) => Promise<void>
}

function noteOps (api: GitlabApi, noteable: GitlabNoteable): NoteOps {
  if (noteable === 'merge_requests') {
    return {
      list: async (projectId, iid) => await api.listMergeRequestNotes(projectId, iid),
      get: async (projectId, iid, noteId) => await api.getMergeRequestNote(projectId, iid, noteId),
      create: async (projectId, iid, body) => await api.createMergeRequestNote(projectId, iid, body),
      update: async (projectId, iid, noteId, body) => await api.updateMergeRequestNote(projectId, iid, noteId, body),
      remove: async (projectId, iid, noteId) => { await api.deleteMergeRequestNote(projectId, iid, noteId) }
    }
  }
  return {
    list: async (projectId, iid) => await api.listIssueNotes(projectId, iid),
    get: async (projectId, iid, noteId) => await api.getIssueNote(projectId, iid, noteId),
    create: async (projectId, iid, body) => await api.createIssueNote(projectId, iid, body),
    update: async (projectId, iid, noteId, body) => await api.updateIssueNote(projectId, iid, noteId, body),
    remove: async (projectId, iid, noteId) => { await api.deleteIssueNote(projectId, iid, noteId) }
  }
}

/** Which kind of GitLab object a parent sync doc stands for. */
export function noteableOf (parent: Pick<DocSyncInfo, 'objectClass'>): GitlabNoteable {
  return parent.objectClass === gitlab.class.GitlabMergeRequest ? 'merge_requests' : 'issues'
}

const DONE: DocumentUpdate<DocSyncInfo> = { needSync: GITLAB_SYNC_VERSION }

/** Notes written by people and visible to everyone who sees the issue. */
export function isVisibleNote (note: GitlabNoteInfo): boolean {
  return !note.system && note.internal !== true && note.confidential !== true
}

/** Visible notes that are not attached to a diff line (diff notes belong to review threads). */
export function isSyncedNote (note: GitlabNoteInfo): boolean {
  return isVisibleNote(note) && note.type !== 'DiffNote'
}

/**
 * A parent closed or detached from Huly (an issue deleted or moved out, a merge request moved): its
 * GitLab notes and threads are not imported any more.
 */
export async function isTombstoned (provider: Pick<SyncProvider, 'derived'>, repo: RepositoryContext, parentKey: string): Promise<boolean> {
  const parent = await provider.derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key: parentKey })
  return parent?.deleted === true
}

/**
 * Pairs an issue's notes with their copies after a GitLab issue move. GitLab copies the author and
 * created_at, so those match first; what is left is paired in order per author. Returns sync doc id → copy.
 */
export function pairMovedNotes (known: Array<{ id: string, note: GitlabNoteInfo }>, moved: GitlabNoteInfo[]): Map<string, GitlabNoteInfo> {
  const pairs = new Map<string, GitlabNoteInfo>()
  const free = [...moved]
  const take = (match: (note: GitlabNoteInfo) => boolean): GitlabNoteInfo | undefined => {
    const index = free.findIndex(match)
    return index < 0 ? undefined : free.splice(index, 1)[0]
  }
  const rest: Array<{ id: string, note: GitlabNoteInfo }> = []
  for (const it of known) {
    const copy = take((note) => note.author.id === it.note.author.id && note.created_at === it.note.created_at)
    if (copy !== undefined) pairs.set(it.id, copy)
    else rest.push(it)
  }
  for (const it of rest.sort((a, b) => a.note.created_at.localeCompare(b.note.created_at))) {
    const copy = take((note) => note.author.id === it.note.author.id)
    if (copy !== undefined) pairs.set(it.id, copy)
  }
  return pairs
}

export class NoteSyncManager implements DocSyncManager {
  constructor (private readonly provider: SyncProvider) {}

  /** Fetches the note a webhook names; serialised with note creation on the same issue or merge request. */
  async handleNoteEvent (
    ctx: MeasureContext,
    repo: RepositoryContext,
    api: GitlabApi,
    iid: number,
    noteId: number,
    noteable: GitlabNoteable = 'issues'
  ): Promise<void> {
    const parent = objectKey(repo.integration.host, repo.repository.projectId, noteable, iid)
    await this.provider.runner.exec(parent, async () => {
      if (await isTombstoned(this.provider, repo, parent)) return
      const note = await noteOps(api, noteable).get(repo.repository.projectId, iid, noteId)
      await this.upsertExternal(repo, parent, note)
    })
  }

  /** Stores every note of an issue or merge request and removes Huly comments whose note is gone from the listing. */
  async refreshNotes (
    ctx: MeasureContext,
    repo: RepositoryContext,
    api: GitlabApi,
    target: NoteTarget,
    noteable: GitlabNoteable = 'issues'
  ): Promise<void> {
    if (target.confidential === true) return
    const parent = objectKey(repo.integration.host, repo.repository.projectId, noteable, target.iid)
    await this.provider.runner.exec(parent, async () => {
      if (await isTombstoned(this.provider, repo, parent)) return
      const notes = (await noteOps(api, noteable).list(repo.repository.projectId, target.iid)).filter(isSyncedNote)
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
    // Comments removed together with their issue or merge request: its GitLab notes stay
    if (parent === undefined || parent.deleted === true) return true
    if ((await this.parentDoc(parent)) === undefined) return true
    const api = await this.provider.integrationApi(repo.integration)
    if (api === undefined) {
      throw new Error('GitLab authorization expired')
    }
    await noteOps(api, noteableOf(parent)).remove(repo.repository.projectId, parent.gitlabIid, external.id)
    return true
  }

  /** The Huly issue or merge request of a parent sync doc (both share the sync doc's _id). */
  private async parentDoc (parent: DocSyncInfo): Promise<Doc | undefined> {
    return await this.provider.client.findOne(parent.objectClass, { _id: parent._id as unknown as Ref<Doc> })
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

  // The GitLab block for the comment's Huly attachments; '' without any. Throws when GitLab refuses
  // an upload, so the note is retried instead of sent without it.
  private async attachmentBlockFor (repo: RepositoryContext, message: ChatMessage): Promise<string> {
    const attachments = await this.provider.client.findAll(
      attachment.class.Attachment,
      { attachedTo: message._id },
      { sort: { createdOn: SortingOrder.Ascending } }
    )
    const links: string[] = []
    for (const it of attachments) {
      const path = await this.provider.content.uploadFile(repo, it.file, it.name)
      if (path !== undefined) links.push(attachmentLink(it.name, it.type, path))
    }
    return attachmentBlock(links)
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
    const text = await this.provider.content.toMarkdown(repo, message.message)
    const body = withAttachments(text, await this.attachmentBlockFor(repo, message))
    if (body.trim() === '') return DONE
    const api = await this.provider.apiFor(repo.integration, message.modifiedBy)
    if (api === undefined) {
      return { ...DONE, error: 'GitLab authorization expired', retryable: true }
    }
    const parentKey = parent.key
    return await this.provider.runner.exec(parentKey, async () => {
      const note = await noteOps(api, noteableOf(parent)).create(repo.repository.projectId, parent.gitlabIid, body)
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
    const target = await this.parentDoc(parent)
    // Created once the issue or merge request arrives: its sync re-queues its notes
    if (target === undefined) return DONE
    const message = await this.provider.content.toMarkup(repo, splitAttachmentBlock(external.body).text)
    const author: PersonId = await this.provider.persons.personIdFor(repo.integration.host, external.author)
    await this.provider.client.addCollection(
      chunter.class.ChatMessage,
      info.space,
      target._id,
      target._class,
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
    const { text, block } = splitAttachmentBlock(external.body)
    const remote: NoteSnapshot = { message: await this.provider.content.toMarkup(repo, text) }
    const base = (info.current as NoteSnapshot | undefined) ?? remote
    const { toPlatform, toGitlab, merged } = mergeFields(base, { message: message.message }, remote, { message: areEqualMarkups })
    let latest = external
    // A refused upload must not hold back GitLab's edits: they are applied below, and the note is retried
    let wanted: string | undefined
    let blockError: unknown
    try {
      wanted = await this.attachmentBlockFor(repo, message)
    } catch (err: unknown) {
      blockError = err
    }
    let body: string | undefined
    if (wanted === undefined) {
      // Nothing is sent without the attachments
    } else if (toGitlab.message !== undefined) {
      const candidate = withAttachments(await this.provider.content.toMarkdown(repo, toGitlab.message), wanted)
      if (!compareMarkdown(candidate, external.body)) body = candidate
    } else if (!compareMarkdown(wanted, block)) {
      // Only the attachments changed: GitLab's text stays as written
      body = withAttachments(text, wanted)
    }
    // GitLab refuses an empty note: a text-less comment without attachments leaves the note as it is
    if (body !== undefined && body.trim() === '') body = undefined
    if (body !== undefined) {
      const api = await this.provider.apiFor(repo.integration, message.modifiedBy)
      if (api === undefined) {
        return { ...DONE, error: 'GitLab authorization expired', retryable: true }
      }
      const sent = body
      latest = await this.provider.runner.exec(parent.key, async () => {
        const updated = await noteOps(api, noteableOf(parent)).update(repo.repository.projectId, parent.gitlabIid, external.id, sent)
        await this.provider.derived.update(info, { external: updated, current: merged, lastModified: Date.parse(updated.updated_at) })
        return updated
      })
    }
    if (toPlatform.message !== undefined) {
      const author = await this.provider.persons.personIdFor(repo.integration.host, external.author)
      await this.provider.client.update(message, { message: toPlatform.message }, false, Date.parse(external.updated_at), author)
    }
    if (blockError !== undefined) {
      // A Huly edit not sent yet stays pending: the snapshot advances only when nothing was owed to GitLab
      const pending = toGitlab.message !== undefined ? {} : { current: merged }
      return { ...DONE, ...pending, error: errorMessage(blockError), retryable: !isPermanentError(blockError) }
    }
    return { ...DONE, current: merged, external: latest, lastModified: Date.parse(latest.updated_at), error: null }
  }
}
