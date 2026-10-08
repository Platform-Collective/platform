//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Timestamp } from '@hcengineering/core'

// Archiving an item (GitHub Projects "Archive item"): the issue stays where it is and keeps all of its field
// values, it only gets a timestamp that makes the project views, slice and Insights skip it. Restoring clears it.
// (Huly's `hideArchived` option is about archived *projects*, so issues need a marker of their own.)

/**
 * Whether an issue is archived: a restored issue carries `null`, an issue that was never archived has no value.
 * @public
 */
export function isIssueArchived (issue: { archivedAt?: Timestamp | null }): boolean {
  return issue.archivedAt !== undefined && issue.archivedAt !== null
}

/**
 * The update that archives an issue.
 * @public
 */
export function archiveUpdate (now: Timestamp = Date.now()): { archivedAt: Timestamp } {
  return { archivedAt: now }
}

/**
 * The update that restores an archived issue. It sets `null`, because an update cannot remove a property.
 * @public
 */
export function restoreUpdate (): { archivedAt: null } {
  return { archivedAt: null }
}

/**
 * The part of a `DocumentQuery` that selects archived issues (`true`), or the ones that are not archived (`false`).
 * @public
 */
export function archivedQuery (archived: boolean): { archivedAt: null } | { archivedAt: { $ne: null } } {
  return archived ? { archivedAt: { $ne: null } } : { archivedAt: null }
}
