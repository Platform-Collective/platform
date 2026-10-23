// SPDX-License-Identifier: EPL-2.0

import type { Ref, Status } from '@hcengineering/core'
import type { Issue } from '@hcengineering/tracker'

export interface IssuePlanningConstraints {
  blockers: string[]
  startDate: number | undefined
}

const HOUR = 60 * 60 * 1000
/** Longest default slot: one working day. Larger estimates can be extended or split by the user. */
const MAX_SLOT_HOURS = 8

/** Default slot length in milliseconds, using the issue's remaining hours (capped at 8 h) when positive. */
export function getIssueSlotDuration (
  issue: Pick<Issue, 'estimation' | 'reportedTime'> | undefined,
  fallback: number = HOUR / 2
): number {
  const remaining = (issue?.estimation ?? 0) - (issue?.reportedTime ?? 0)
  return Number.isFinite(remaining) && remaining > 0 ? Math.min(remaining, MAX_SLOT_HOURS) * HOUR : fallback
}

/**
 * Advisory constraints. Only loaded blocker issues are considered: references that are still loading,
 * inaccessible or not issues are skipped, so rows do not flash or show raw ids.
 */
export function getIssuePlanningConstraints (
  issue: Pick<Issue, 'blockedBy' | 'startDate'> | undefined,
  blockers: readonly Issue[],
  resolvedStatuses: ReadonlySet<Ref<Status>>,
  now: number
): IssuePlanningConstraints {
  const byId = new Map(blockers.map((blocker) => [blocker._id, blocker]))
  const unresolved: string[] = []
  for (const relation of issue?.blockedBy ?? []) {
    const blocker = byId.get(relation._id as Ref<Issue>)
    if (blocker === undefined || resolvedStatuses.has(blocker.status)) continue
    unresolved.push(`${blocker.identifier}: ${blocker.title}`)
  }
  return {
    blockers: unresolved,
    startDate: issue?.startDate != null && issue.startDate > now ? issue.startDate : undefined
  }
}
