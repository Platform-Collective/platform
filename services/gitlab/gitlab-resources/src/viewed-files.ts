// SPDX-License-Identifier: EPL-2.0

import type { GitlabViewedFile } from '@hcengineering/gitlab'

/** The viewed files after one tick or untick; a file counts as viewed per version (sha). */
export function toggleViewed (
  files: GitlabViewedFile[],
  fileName: string,
  sha: string,
  viewed: boolean
): GitlabViewedFile[] {
  const rest = files.filter((it) => !(it.fileName === fileName && it.sha === sha))
  return viewed ? [...rest, { fileName, sha }] : rest
}
