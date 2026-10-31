// SPDX-License-Identifier: EPL-2.0

import { type IntlString } from '@hcengineering/platform'
import gitlab from './plugin'

/** The badge for GitLab's detailed_merge_status; undefined for statuses not worth a badge. */
export function mergeStatusLabel (status: string, hasConflicts: boolean): IntlString | undefined {
  if (hasConflicts || status === 'conflict' || status === 'need_rebase') return gitlab.string.Conflict
  switch (status) {
    case 'mergeable':
      return gitlab.string.ReadyToMerge
    case 'checking':
    case 'unchecked':
    case 'preparing':
    case 'approvals_syncing':
      return gitlab.string.Checking
    case 'ci_must_pass':
    case 'ci_still_running':
      return gitlab.string.PipelinePending
    case 'discussions_not_resolved':
      return gitlab.string.UnresolvedDiscussions
    case 'not_approved':
    case 'requested_changes':
      return gitlab.string.NeedsApproval
    case 'draft_status':
      return gitlab.string.Draft
    default:
      return undefined
  }
}
