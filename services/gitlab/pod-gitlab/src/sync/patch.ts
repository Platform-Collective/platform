// SPDX-License-Identifier: EPL-2.0

import type { Blob, DocumentUpdate, MeasureContext, Ref } from '@hcengineering/core'
import gitlab, { type DocSyncInfo, type GitlabMergeRequest } from '@hcengineering/gitlab'
import { createHash } from 'crypto'
import { type GitlabApi, isNotFound } from '../gitlab/api'
import type { GitlabMergeRequestDiff, GitlabMergeRequestInfo } from '../gitlab/types'
import { removeAttached } from './docs'
import { errorMessage, isPermanentError } from './errors'
import type { PatchStore, RepositoryContext, SyncProvider } from './types'

/** Larger diffs are not stored. */
export const MAX_PATCH_BYTES = 5 * 1024 * 1024

function fileDiff (file: GitlabMergeRequestDiff): string {
  const lines = [`diff --git a/${file.old_path} b/${file.new_path}`]
  if (file.new_file) {
    lines.push(`new file mode ${file.b_mode}`)
  } else if (file.deleted_file) {
    lines.push(`deleted file mode ${file.a_mode}`)
  } else if (file.a_mode !== file.b_mode) {
    lines.push(`old mode ${file.a_mode}`, `new mode ${file.b_mode}`)
  }
  if (file.renamed_file) {
    lines.push(`rename from ${file.old_path}`, `rename to ${file.new_path}`)
  }
  if (file.diff !== '') {
    // GitLab's per-file diffs carry no blob ids; a digest of the file's diff stands in, so the diff view sees a new
    // version of a file (and resets its viewed mark) exactly when its changes differ
    const digest = createHash('sha1').update(file.diff).digest('hex').slice(0, 12)
    lines.push(`index 000000000000..${digest}`)
    lines.push(file.new_file ? '--- /dev/null' : `--- a/${file.old_path}`)
    lines.push(file.deleted_file ? '+++ /dev/null' : `+++ b/${file.new_path}`)
    lines.push(file.diff.endsWith('\n') ? file.diff.slice(0, -1) : file.diff)
  }
  return lines.join('\n') + '\n'
}

/** A `git diff`-style patch from GitLab's per-file diffs, for GitLab versions without raw_diffs. */
export function assembleUnifiedDiff (diffs: GitlabMergeRequestDiff[]): string {
  return diffs.map(fileDiff).join('')
}

/** Reading stops here; the counts then cover the part read, already far over every limit of the UI. */
const MAX_COUNTED_PATCH_BYTES = 50 * 1024 * 1024

// Enough of a line to tell a file header, a hunk header, an added and a removed line apart
const LINE_PREFIX = 64

export interface PatchSummary {
  // The diff; undefined when it is over MAX_PATCH_BYTES
  patch: string | undefined
  files: number
  additions: number
  deletions: number
  bytes: number
  // Over MAX_COUNTED_PATCH_BYTES: the counts cover its first part only
  truncated: boolean
}

/** Counts a diff read in chunks, and keeps its text while it fits `maxKept`. */
export class PatchReader {
  private files = 0
  private additions = 0
  private deletions = 0
  private bytes = 0
  private inHunk = false
  // Start of the line still being read
  private partial = ''
  private chunks: string[] | undefined = []
  private truncated = false

  constructor (
    private readonly maxKept = MAX_PATCH_BYTES,
    private readonly maxRead = MAX_COUNTED_PATCH_BYTES
  ) {}

  /** Adds a chunk; false once reading should stop. */
  push (text: string): boolean {
    this.bytes += Buffer.byteLength(text)
    if (this.chunks !== undefined) {
      if (this.bytes > this.maxKept) this.chunks = undefined
      else this.chunks.push(text)
    }
    const lines = (this.partial + text).split('\n')
    const last = lines.pop() ?? ''
    this.partial = last.slice(0, LINE_PREFIX)
    for (const line of lines) this.countLine(line)
    if (this.bytes > this.maxRead) {
      this.truncated = true
      return false
    }
    return true
  }

  finish (): PatchSummary {
    // The last line of a cut-off diff may be incomplete: only a complete diff counts it
    if (this.partial !== '' && !this.truncated) this.countLine(this.partial)
    this.partial = ''
    return {
      patch: this.chunks?.join(''),
      files: this.files,
      additions: this.additions,
      deletions: this.deletions,
      bytes: this.bytes,
      truncated: this.truncated
    }
  }

  private countLine (line: string): void {
    if (line.startsWith('diff --git ')) {
      this.files++
      this.inHunk = false
    } else if (line.startsWith('@@')) this.inHunk = true
    else if (this.inHunk && line.startsWith('+')) this.additions++
    else if (this.inHunk && line.startsWith('-')) this.deletions++
  }
}

/** The merge request diff, counted and kept up to MAX_PATCH_BYTES: raw_diffs (GitLab 17.9+), else the per-file diffs. */
export async function fetchMergeRequestPatch (
  api: Pick<GitlabApi, 'readMergeRequestRawDiffs' | 'listMergeRequestDiffPages'>,
  projectId: number,
  iid: number
): Promise<PatchSummary> {
  const raw = new PatchReader()
  try {
    await api.readMergeRequestRawDiffs(projectId, iid, (text) => raw.push(text))
    return raw.finish()
  } catch (err: unknown) {
    if (!isNotFound(err)) throw err
  }
  const assembled = new PatchReader()
  for await (const page of api.listMergeRequestDiffPages(projectId, iid)) {
    // Leaving the loop stops the paging
    if (!assembled.push(assembleUnifiedDiff(page))) break
  }
  return assembled.finish()
}

/**
 * Stores the diff when the head commit changed since the last stored one. A failure is logged and
 * leaves patchSha as it was, so the next sync of this merge request tries again; it never fails the sync.
 */
export async function syncMergeRequestPatch (
  ctx: MeasureContext,
  provider: SyncProvider,
  repo: RepositoryContext,
  mergeRequest: GitlabMergeRequest,
  info: DocSyncInfo,
  external: GitlabMergeRequestInfo
): Promise<DocumentUpdate<DocSyncInfo>> {
  const store = provider.patches
  if (store === undefined || external.sha === null || info.patchSha === external.sha) return {}
  try {
    const api = await provider.integrationApi(repo.integration)
    if (api === undefined) return {}
    const projectId = repo.repository.projectId
    const summary = await fetchMergeRequestPatch(api, projectId, external.iid)
    const commits = (await api.listMergeRequestCommits(projectId, external.iid)).length
    const { files, additions, deletions } = summary
    if (summary.patch === undefined) {
      ctx.warn('gitlab merge request diff too large, not stored', {
        key: info.key,
        bytes: summary.bytes,
        truncated: summary.truncated
      })
      // The stored diff belongs to an older version
      await removePatch(ctx, provider, store, mergeRequest)
    } else {
      await storePatch(ctx, provider, store, mergeRequest, summary.patch, Date.parse(external.updated_at))
    }
    if (
      mergeRequest.commits !== commits ||
      mergeRequest.files !== files ||
      mergeRequest.additions !== additions ||
      mergeRequest.deletions !== deletions
    ) {
      await provider.client.update(mergeRequest, { commits, files, additions, deletions })
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
async function storePatch (
  ctx: MeasureContext,
  provider: Pick<SyncProvider, 'client'>,
  store: PatchStore,
  mergeRequest: GitlabMergeRequest,
  patch: string,
  lastModified: number
): Promise<void> {
  const { client } = provider
  const existing = await client.findOne(gitlab.class.GitlabPatch, { attachedTo: mergeRequest._id })
  const stored = await store.put(ctx, patch)
  try {
    if (existing === undefined) {
      await client.addCollection(
        gitlab.class.GitlabPatch,
        mergeRequest.space,
        mergeRequest._id,
        mergeRequest._class,
        'patch',
        {
          file: stored.file as Ref<Blob>,
          size: stored.size,
          lastModified
        }
      )
    } else {
      await client.update(existing, { file: stored.file as Ref<Blob>, size: stored.size, lastModified })
    }
  } catch (err: unknown) {
    await removeBlob(ctx, store, stored.file)
    throw err
  }
  if (existing !== undefined) await removeBlob(ctx, store, existing.file)
}

/** Removes a stored diff that no longer matches the merge request. */
async function removePatch (
  ctx: MeasureContext,
  provider: Pick<SyncProvider, 'client'>,
  store: PatchStore,
  mergeRequest: GitlabMergeRequest
): Promise<void> {
  const { client } = provider
  const existing = await client.findOne(gitlab.class.GitlabPatch, { attachedTo: mergeRequest._id })
  if (existing === undefined) return
  await removeAttached(client, existing)
  await removeBlob(ctx, store, existing.file)
}

// An orphan blob is harmless: a failed removal is only logged
async function removeBlob (ctx: MeasureContext, store: PatchStore, file: string): Promise<void> {
  try {
    await store.remove(ctx, file)
  } catch (err: unknown) {
    ctx.warn('gitlab merge request diff blob not removed', { file, error: errorMessage(err) })
  }
}
