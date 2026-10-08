//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref, TxOperations } from '@hcengineering/core'
import { archiveUpdate, isIssueArchived, restoreUpdate, type Issue } from '@hcengineering/tracker'

/**
 * Items an archive or restore of one batch handles at most; a bigger selection is cut, so one click never turns into
 * an unbounded write.
 */
export const MAX_ARCHIVE_BATCH = 500

/**
 * The issues a batch handles: the ones that are not in the wanted state yet (so archiving twice does nothing), each
 * once, up to the cap.
 */
export function selectArchiveTargets<T extends Pick<Issue, '_id' | 'archivedAt'>> (
  issues: readonly T[],
  archive: boolean
): T[] {
  const seen = new Set<Ref<Issue>>()
  const result: T[] = []
  for (const issue of issues) {
    if (seen.has(issue._id) || isIssueArchived(issue) === archive) continue
    seen.add(issue._id)
    result.push(issue)
    if (result.length >= MAX_ARCHIVE_BATCH) break
  }
  return result
}

/**
 * Archives (`archive`) or restores issues in one batch. The ones that are in the wanted state are left alone.
 */
export async function setArchived (client: TxOperations, issues: Issue[], archive: boolean): Promise<void> {
  const targets = selectArchiveTargets(issues, archive)
  if (targets.length === 0) return
  const now = Date.now()
  const ops = client.apply()
  for (const issue of targets) {
    await ops.update(issue, archive ? archiveUpdate(now) : restoreUpdate())
  }
  await ops.commit()
}
