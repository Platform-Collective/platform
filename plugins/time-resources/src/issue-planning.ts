// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Ref, Status } from '@hcengineering/core'
import type { ToDo } from '@hcengineering/time'
import type { Issue } from '@hcengineering/tracker'

export interface IssuePlanningConstraints {
  blockers: string[]
  startDate: number | undefined
}

const HOUR = 60 * 60 * 1000
/** Longest default slot: one working day. Larger estimates can be extended or split by the user. */
const MAX_SLOT_HOURS = 8

/**
 * Default slot length in milliseconds for a slot starting at `start`.
 *
 * Uses the issue's positive remaining hours, capped at one working day and at the end of the start
 * day. Missing or non-positive remaining time keeps the previous, uncapped default.
 *
 * The remaining time is derived from `estimation` and `reportedTime` on purpose instead of reading the
 * server-maintained `remainingTime`: older issues may not have that field filled in, and both values
 * are already kept in sync with time reports.
 */
export function getIssueSlotDuration (
  issue: Pick<Issue, 'estimation' | 'reportedTime'> | undefined,
  start: number,
  fallback: number = HOUR / 2
): number {
  const remaining = (issue?.estimation ?? 0) - (issue?.reportedTime ?? 0)
  if (!Number.isFinite(remaining) || remaining <= 0) return fallback
  const endOfDay = new Date(start).setHours(24, 0, 0, 0)
  return Math.min(remaining * HOUR, MAX_SLOT_HOURS * HOUR, endOfDay - start)
}

/** Unique ids of all issues that block any of the given issues. */
export function getBlockerIds (issues: readonly Issue[]): Array<Ref<Issue>> {
  const ids = new Set<Ref<Issue>>()
  for (const issue of issues) {
    for (const relation of issue.blockedBy ?? []) {
      ids.add(relation._id as Ref<Issue>)
    }
  }
  return Array.from(ids)
}

/**
 * Advisory constraints. Only loaded blocker issues are considered: references that are still loading,
 * inaccessible or not issues are skipped, so rows do not flash or show raw ids.
 */
export function getIssuePlanningConstraints (
  issue: Pick<Issue, 'blockedBy' | 'startDate'> | undefined,
  blockers: ReadonlyMap<Ref<Issue>, Issue>,
  resolvedStatuses: ReadonlySet<Ref<Status>>,
  now: number
): IssuePlanningConstraints {
  const unresolved: string[] = []
  for (const relation of issue?.blockedBy ?? []) {
    const blocker = blockers.get(relation._id as Ref<Issue>)
    if (blocker === undefined || resolvedStatuses.has(blocker.status)) continue
    unresolved.push(`${blocker.identifier}: ${blocker.title}`)
  }
  return {
    blockers: unresolved,
    startDate: issue?.startDate != null && issue.startDate > now ? issue.startDate : undefined
  }
}

/**
 * Constraints for a whole ToDo list, computed once at list level. Only unplanned, open ToDos attached
 * to a loaded issue get an entry, and only when they actually have a blocker or a future start date.
 */
export function getToDoPlanningConstraints (
  todos: ReadonlyArray<Pick<ToDo, '_id' | 'attachedTo' | 'workslots' | 'doneOn'>>,
  issues: ReadonlyMap<Ref<Issue>, Issue>,
  blockers: ReadonlyMap<Ref<Issue>, Issue>,
  resolvedStatuses: ReadonlySet<Ref<Status>>,
  now: number,
  previous = new Map<Ref<ToDo>, IssuePlanningConstraints>()
): Map<Ref<ToDo>, IssuePlanningConstraints> {
  const result = new Map<Ref<ToDo>, IssuePlanningConstraints>()
  for (const todo of todos) {
    if (todo.workslots !== 0 || todo.doneOn != null) continue
    const issue = issues.get(todo.attachedTo as Ref<Issue>)
    if (issue === undefined) continue
    const constraints = getIssuePlanningConstraints(issue, blockers, resolvedStatuses, now)
    if (constraints.blockers.length > 0 || constraints.startDate !== undefined) {
      const old = previous.get(todo._id)
      const unchanged =
        old !== undefined &&
        old.startDate === constraints.startDate &&
        old.blockers.length === constraints.blockers.length &&
        old.blockers.every((blocker, index) => blocker === constraints.blockers[index])
      result.set(todo._id, unchanged ? old : constraints)
    }
  }
  return result.size === previous.size && Array.from(result).every(([id, value]) => previous.get(id) === value)
    ? previous
    : result
}

/** Sorted, unique issue IDs for rows that can show planning hints. */
export function getPlanningIssueIds (
  todos: ReadonlyArray<Pick<ToDo, 'attachedTo' | 'attachedToClass' | 'workslots' | 'doneOn'>>,
  isIssue: (clazz: Ref<Class<Doc>>) => boolean
): Array<Ref<Issue>> {
  return Array.from(
    new Set(
      todos
        .filter((todo) => todo.workslots === 0 && todo.doneOn == null && isIssue(todo.attachedToClass))
        .map((todo) => todo.attachedTo as Ref<Issue>)
    )
  ).sort()
}
