// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Side-effect-free helpers used by the trigger. Kept separate so unit tests
// can import them without pulling in a TriggerControl mock chain.

import type { Ref } from '@hcengineering/core'
import type { IssueStatus } from '@hcengineering/tracker'
import type { WorkflowRule } from '@hcengineering/workflow-rules'

/**
 * Pure helper: decide whether a transition `from -> to` on the TARGET side
 * is a regression that is NOT in `allowedLoops`. Takes just the status ids
 * and rank table (`statuses` array from the counterpart's TaskType) so the
 * regression-guard tests don't need a Huly control plane.
 *
 * Fails closed on an unknown status. Rank-table membership is checked
 * before the loop allow-list so a stale or foreign status reference can
 * never be waved through by an `allowedLoops` entry that names it. The
 * trigger validates TaskType membership upstream and should not call this
 * helper with unknown statuses, but if it does the result refuses to
 * apply the write rather than silently letting the reference through.
 *
 * @public
 */
export function isRegression (
  from: Ref<IssueStatus>,
  to: Ref<IssueStatus>,
  rank: Array<Ref<IssueStatus>>,
  allowedLoops: WorkflowRule['allowedLoops']
): boolean {
  const fromIdx = rank.indexOf(from)
  const toIdx = rank.indexOf(to)
  if (fromIdx === -1 || toIdx === -1) return true
  for (const loop of allowedLoops) {
    if (loop.from === from && loop.to === to) return false
  }
  return toIdx < fromIdx
}
