// SPDX-License-Identifier: EPL-2.0

import type { AttachedDoc, Class, Doc, DocumentQuery, MixinData, Ref, TxOperations } from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabIssue } from '@hcengineering/gitlab'
import type { Issue } from '@hcengineering/tracker'
import type { GitlabNoteInfo } from '../gitlab/types'
import { noteKey } from './keys'
import type { RepositoryContext, SyncProvider } from './types'

/** Marks the sync docs a query names as pending. */
export async function requeueSyncDocs (derived: TxOperations, query: DocumentQuery<DocSyncInfo>): Promise<void> {
  for (const info of await derived.findAll(gitlab.class.DocSyncInfo, query)) {
    await derived.update(info, { needSync: '' })
  }
}

export async function removeSyncDocs (derived: TxOperations, query: DocumentQuery<DocSyncInfo>): Promise<void> {
  for (const info of await derived.findAll(gitlab.class.DocSyncInfo, query)) {
    await derived.remove(info)
  }
}

/** Removes an attached doc from its collection; written as the client's account (System), so no sync is queued back. */
export async function removeAttached (client: TxOperations, doc: AttachedDoc): Promise<void> {
  await client.removeCollection(doc._class, doc.space, doc._id, doc.attachedTo, doc.attachedToClass, doc.collection)
}

/**
 * Writes the GitlabIssue mixin of an issue or merge request: created the first time, updated afterwards.
 * The data carries the mixin's required fields, so a first write creates a complete mixin.
 */
export async function upsertGitlabIssueMixin (
  client: TxOperations,
  issue: Issue,
  data: MixinData<Issue, GitlabIssue>
): Promise<void> {
  if (client.getHierarchy().hasMixin(issue, gitlab.mixin.GitlabIssue)) {
    await client.updateMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, data)
  } else {
    await client.createMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, data)
  }
}

/** Stores a GitLab note for the sync loop: a new sync doc, or a newer version of a known one. */
export async function storeExternalNote (
  provider: Pick<SyncProvider, 'derived' | 'triggerSync'>,
  repo: RepositoryContext,
  parent: string,
  objectClass: Ref<Class<Doc>>,
  note: GitlabNoteInfo
): Promise<void> {
  const { derived } = provider
  const key = noteKey(parent, note.id)
  const lastModified = Date.parse(note.updated_at)
  const info = await derived.findOne(gitlab.class.DocSyncInfo, { space: repo.project._id, key })
  if (info === undefined) {
    await derived.createDoc(gitlab.class.DocSyncInfo, repo.project._id, {
      key,
      parent,
      objectClass,
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
  provider.triggerSync()
}
