// SPDX-License-Identifier: EPL-2.0

/** Names of the `gitlab.string` ids that describe an open merge request's merge status. */
export type MergeStatusKey =
  | 'Conflict'
  | 'ReadyToMerge'
  | 'Checking'
  | 'PipelinePending'
  | 'UnresolvedDiscussions'
  | 'NeedsApproval'
  | 'Draft'

/** What to show for GitLab's detailed_merge_status; undefined for statuses not worth a badge. */
export function mergeStatusKey (status: string, hasConflicts: boolean): MergeStatusKey | undefined {
  if (hasConflicts || status === 'conflict' || status === 'need_rebase') return 'Conflict'
  switch (status) {
    case 'mergeable':
      return 'ReadyToMerge'
    case 'checking':
    case 'unchecked':
    case 'preparing':
    case 'approvals_syncing':
      return 'Checking'
    case 'ci_must_pass':
    case 'ci_still_running':
      return 'PipelinePending'
    case 'discussions_not_resolved':
      return 'UnresolvedDiscussions'
    case 'not_approved':
    case 'requested_changes':
      return 'NeedsApproval'
    case 'draft_status':
      return 'Draft'
    default:
      return undefined
  }
}
