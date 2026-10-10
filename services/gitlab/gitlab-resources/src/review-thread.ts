// SPDX-License-Identifier: EPL-2.0

import { type Blob, type PersonId, type Ref } from '@hcengineering/core'
import { type GitlabReviewThread } from '@hcengineering/gitlab'
import { findHunk, type PatchFile } from './hunk'

/** Where a thread points: the new line, else the removed (old) line, else the file. */
export function threadLocation (thread: Pick<GitlabReviewThread, 'path' | 'oldPath' | 'line' | 'oldLine'>): string {
  if (thread.line !== null) return `${thread.path}:${thread.line}`
  if (thread.oldLine !== null) return `${thread.oldPath}:${thread.oldLine}`
  return thread.path
}

/** The thread change that reopens a resolved thread or resolves an open one; the GitLab service mirrors it. */
export function resolveChange (resolved: boolean, by: PersonId): Pick<GitlabReviewThread, 'isResolved' | 'resolvedBy'> {
  return resolved ? { isResolved: false, resolvedBy: null } : { isResolved: true, resolvedBy: by }
}

export interface HunkRequest {
  file: Ref<Blob> | undefined
  path: string
  line: number | null
  oldLine: number | null
  outdated: boolean
}

/**
 * Cuts a thread's hunk from the stored diff. Every call is a new request: an answer, or a failure, for an older request
 * resolves to undefined, so a slower download never overwrites what a newer request decided (a newer diff, or the
 * thread turning outdated).
 */
export function createHunkLoader (
  loadFiles: (file: Ref<Blob>) => Promise<PatchFile[]>
): (request: HunkRequest) => Promise<string | undefined> {
  let latest = 0
  return async (request) => {
    const token = ++latest
    // An outdated thread shows its location only
    if (request.file === undefined || request.outdated) return ''
    try {
      const files = await loadFiles(request.file)
      return token === latest ? findHunk(files, request.path, request.line, request.oldLine) : undefined
    } catch {
      // The diff panel reports download failures; a thread shows its location only
      return token === latest ? '' : undefined
    }
  }
}
