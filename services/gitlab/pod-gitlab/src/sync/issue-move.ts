// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import { type Doc, generateId, type Hyperlink, type MeasureContext, type Ref } from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabProject } from '@hcengineering/gitlab'
import tracker, { type Issue } from '@hcengineering/tracker'
import type { GitlabApi } from '../gitlab/api'
import type { GitlabIssueInfo, GitlabNoteInfo } from '../gitlab/types'
import { removeSyncDocs, upsertGitlabIssueMixin } from './docs'
import { EXPIRED_ERROR } from './errors'
import { hostKey, issueKey, noteKey, repositoryLockKey } from './keys'
import { isSyncedNote } from './notes'
import type { RepositoryContext, SyncProvider } from './types'
import { GITLAB_SYNC_VERSION } from './versions'

/**
 * Pairs an issue's notes with their copies after a GitLab issue move. GitLab copies the author and
 * created_at, so those match first; what is left is paired in order per author. Returns sync doc id → copy.
 */
export function pairMovedNotes (
  known: Array<{ id: string, note: GitlabNoteInfo }>,
  moved: GitlabNoteInfo[]
): Map<string, GitlabNoteInfo> {
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

/** Follows a Huly issue moved to another project: moves its GitLab issue, or closes it and unlinks the Huly issue. */
export class IssueMover {
  constructor (
    private readonly provider: SyncProvider,
    private readonly closeInGitlab: (info: DocSyncInfo, repo: RepositoryContext) => Promise<boolean>
  ) {}

  /**
   * A Huly issue moved to another project. The GitLab issue follows it into the new project's only
   * repository on the same host. Otherwise the GitLab issue is closed and the Huly issue stays in Huly only. Writes the
   * sync docs itself.
   */
  async handleMove (ctx: MeasureContext, existing: Doc, info: DocSyncInfo): Promise<void> {
    const issue = existing as Issue
    if (info.key === '') {
      // Not in GitLab yet: created where the issue is now
      await this.dropStalePick(issue)
      await this.provider.derived.update(info, { space: issue.space, repository: null, needSync: '', error: null })
      this.provider.triggerSync()
      return
    }
    const source = this.provider.repositoryContext(info.repository)
    const target = source === undefined ? undefined : this.moveTarget(issue, source)
    const external = info.external as GitlabIssueInfo | undefined
    if (source !== undefined && target !== undefined && external !== undefined) {
      await this.moveInGitlab(ctx, issue, info, external, source, target)
    } else {
      await this.detach(ctx, issue, info, source)
    }
  }

  /**
   * A repository picked in the old project names no target in the new one: the new project's only repository takes
   * over; otherwise null, and the header offers the picker again.
   */
  private async dropStalePick (issue: Issue): Promise<void> {
    const h = this.provider.client.getHierarchy()
    if (!h.hasMixin(issue, gitlab.mixin.GitlabIssue)) return
    const picked = h.as(issue, gitlab.mixin.GitlabIssue).repository
    if (picked == null || this.provider.repositoryContext(picked)?.project._id === issue.space) return
    const candidates = this.provider.projectRepositories(issue.space as Ref<GitlabProject>)
    const repository = candidates.length === 1 ? candidates[0].repository._id : null
    await this.provider.client.updateMixin(issue._id, issue._class, issue.space, gitlab.mixin.GitlabIssue, {
      repository,
      syncError: null
    })
  }

  private moveTarget (issue: Issue, source: RepositoryContext): RepositoryContext | undefined {
    const host = hostKey(source.integration.host)
    const candidates = this.provider
      .projectRepositories(issue.space as Ref<GitlabProject>)
      .filter((it) => hostKey(it.integration.host) === host)
    return candidates.length === 1 ? candidates[0] : undefined
  }

  private async moveInGitlab (
    ctx: MeasureContext,
    issue: Issue,
    info: DocSyncInfo,
    external: GitlabIssueInfo,
    source: RepositoryContext,
    target: RepositoryContext
  ): Promise<void> {
    const api = await this.provider.apiFor(source.integration, issue.modifiedBy)
    if (api === undefined) {
      throw new Error(EXPIRED_ERROR)
    }
    const oldKey = info.key
    const { runner } = this.provider
    // The locks of the original issue's webhooks first (repository, then key, as they take them): its "closed" event
    // must not read the sync doc before the move rewrote it
    await runner.exec(repositoryLockKey(source.repository._id), async () => {
      await runner.exec(oldKey, async () => {
        await this.moveLocked(ctx, api, issue, info, external, source, target)
      })
    })
  }

  private async moveLocked (
    ctx: MeasureContext,
    api: GitlabApi,
    issue: Issue,
    info: DocSyncInfo,
    external: GitlabIssueInfo,
    source: RepositoryContext,
    target: RepositoryContext
  ): Promise<void> {
    const oldKey = info.key
    // The target lock also covers the note re-keying: events for the copies wait until their sync docs exist
    await this.provider.runner.exec(repositoryLockKey(target.repository._id), async () => {
      const result = await api.moveIssue(source.repository.projectId, external.iid, target.repository.projectId)
      // Stored before the lock is released: the webhook for the new GitLab issue finds it instead of importing a copy
      await this.provider.derived.update(info, {
        space: issue.space,
        key: issueKey(target.integration.host, target.repository.projectId, result.iid),
        repository: target.repository._id,
        gitlabIid: result.iid,
        external: result,
        lastModified: Date.parse(result.updated_at),
        needSync: GITLAB_SYNC_VERSION,
        error: null,
        retryable: false
      })
      const { client } = this.provider
      const link = {
        url: result.web_url,
        gitlabIid: result.iid,
        repository: target.repository._id,
        syncError: null
      }
      await upsertGitlabIssueMixin(client, issue, link)
      await this.moveNotes(ctx, api, issue, oldKey, target, result)
      ctx.info('gitlab issue moved with its Huly issue', { from: oldKey, iid: result.iid })
    })
  }

  /** Points the sync docs of the issue's comments at the copies GitLab made. */
  private async moveNotes (
    ctx: MeasureContext,
    api: GitlabApi,
    issue: Issue,
    oldKey: string,
    target: RepositoryContext,
    moved: GitlabIssueInfo
  ): Promise<void> {
    const { derived } = this.provider
    const newKey = issueKey(target.integration.host, target.repository.projectId, moved.iid)
    const synced = await derived.findAll(gitlab.class.DocSyncInfo, {
      parent: oldKey,
      objectClass: chunter.class.ChatMessage
    })
    const known = synced.flatMap((it) =>
      it.external === undefined ? [] : [{ id: it._id, note: it.external as GitlabNoteInfo }]
    )
    const copies =
      known.length === 0
        ? []
        : (await api.listNotes(target.repository.projectId, 'issues', moved.iid)).filter(isSyncedNote)
    const pairs = pairMovedNotes(known, copies)
    for (const info of synced) {
      const copy = pairs.get(info._id)
      if (copy === undefined) {
        // No copy found: the Huly comment stays, no longer synchronized
        await derived.remove(info)
        continue
      }
      await derived.update(info, {
        space: issue.space,
        parent: newKey,
        key: noteKey(newKey, copy.id),
        repository: target.repository._id,
        external: copy,
        lastModified: Date.parse(copy.updated_at),
        needSync: GITLAB_SYNC_VERSION,
        error: null,
        retryable: false
      })
    }
    // Comments not in GitLab yet go to the moved issue
    for (const info of await derived.findAll(gitlab.class.DocSyncInfo, {
      attachedTo: issue._id,
      objectClass: chunter.class.ChatMessage,
      key: ''
    })) {
      await derived.update(info, { space: issue.space, needSync: '', error: null })
    }
    if (pairs.size < known.length) {
      ctx.warn('gitlab notes without a copy after an issue move', { key: newKey, unpaired: known.length - pairs.size })
    }
    this.provider.triggerSync()
  }

  /** No single repository on this host in the new project: GitLab closes the issue, Huly keeps it unlinked. */
  private async detach (
    ctx: MeasureContext,
    issue: Issue,
    info: DocSyncInfo,
    source: RepositoryContext | undefined
  ): Promise<void> {
    if (source !== undefined) await this.closeInGitlab(info, source)
    await removeSyncDocs(this.provider.derived, { attachedTo: info._id, objectClass: chunter.class.ChatMessage })
    await removeSyncDocs(this.provider.derived, { parent: info.key })
    await this.provider.derived.remove(info)
    // The Huly issue keeps its _id for a later "Create in GitLab"; a separate tombstone keeps the closed GitLab issue
    // from being imported back into the old project
    await this.provider.derived.createDoc(
      gitlab.class.DocSyncInfo,
      info.space,
      {
        key: info.key,
        objectClass: tracker.class.Issue,
        repository: info.repository,
        gitlabIid: info.gitlabIid,
        needSync: GITLAB_SYNC_VERSION,
        deleted: true
      },
      generateId<DocSyncInfo>()
    )
    const { client } = this.provider
    // repository null: kept in Huly on purpose; the header offers "Create in GitLab" in a linked project
    const data = { url: '' as Hyperlink, gitlabIid: 0, repository: null, syncError: null }
    await upsertGitlabIssueMixin(client, issue, data)
    ctx.info('gitlab issue closed, its Huly issue moved to a project without its repository', { key: info.key })
  }
}
