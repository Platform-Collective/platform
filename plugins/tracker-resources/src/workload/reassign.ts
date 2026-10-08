//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { assigneeOfRow, rowKeyOf } from './rows'

export type ReassignFailure = 'same' | 'readonly'

export type ReassignPlan =
  | { ok: true, assignee: string | null, patch: { assignee: string | null } }
  | { ok: false, reason: ReassignFailure }

/**
 * What dropping an item on a row writes: the assignee of the row (null for the unassigned row). Dropping on the row
 * the item is in changes nothing, and a read-only viewer cannot change anything.
 */
export function planReassign (
  issue: { assignee?: string | null },
  targetRow: string,
  options: { readonly: boolean }
): ReassignPlan {
  if (options.readonly) return { ok: false, reason: 'readonly' }
  if (rowKeyOf(issue.assignee) === targetRow) return { ok: false, reason: 'same' }
  const assignee = assigneeOfRow(targetRow)
  return { ok: true, assignee, patch: { assignee } }
}
