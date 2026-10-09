// SPDX-License-Identifier: EPL-2.0

import { createHash } from 'crypto'
import { type GitlabApi, GitlabApiError } from '../gitlab/api'
import type { GitlabMergeRequestDiff } from '../gitlab/types'

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

export function countPatchFiles (patch: string): number {
  return patch.match(/^diff --git /gm)?.length ?? 0
}

/** Added and removed lines inside hunks; diff headers (---/+++) are outside hunks. */
export function countPatchLines (patch: string): { additions: number, deletions: number } {
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) inHunk = false
    else if (line.startsWith('@@')) inHunk = true
    else if (inHunk && line.startsWith('+')) additions++
    else if (inHunk && line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

/** The merge request diff: raw_diffs (GitLab 17.9+), else assembled from the per-file diffs. */
export async function fetchMergeRequestPatch (
  api: Pick<GitlabApi, 'getMergeRequestRawDiffs' | 'listMergeRequestDiffs'>,
  projectId: number,
  iid: number
): Promise<string> {
  try {
    return await api.getMergeRequestRawDiffs(projectId, iid)
  } catch (err: unknown) {
    if (!(err instanceof GitlabApiError && err.status === 404)) throw err
  }
  return assembleUnifiedDiff(await api.listMergeRequestDiffs(projectId, iid))
}
