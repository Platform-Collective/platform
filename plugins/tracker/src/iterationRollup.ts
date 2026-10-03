//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/**
 * Totals of the issues in one iteration group.
 * @public
 */
export interface IterationRollup {
  // Issues in the group
  count: number
  // Issues whose status is completed (category Won)
  done: number
  // Sum of the estimations, in hours
  estimation: number
}

/**
 * @public
 */
export interface RollupIssue {
  status: string
  estimation?: number
  customFields?: Record<string, unknown>
}

/** @public */
export const EMPTY_ROLLUP: IterationRollup = { count: 0, done: 0, estimation: 0 }

/**
 * Totals of a list of issues. `doneStatuses` are the ids of the statuses of category Won.
 * @public
 */
export function computeRollup (issues: readonly RollupIssue[], doneStatuses: ReadonlySet<string>): IterationRollup {
  const res: IterationRollup = { count: 0, done: 0, estimation: 0 }
  for (const issue of issues) {
    res.count++
    if (doneStatuses.has(issue.status)) res.done++
    if (typeof issue.estimation === 'number' && Number.isFinite(issue.estimation)) res.estimation += issue.estimation
  }
  return res
}

/**
 * Totals per iteration of one Iteration field. The key `undefined` is the group of issues without an iteration.
 * @public
 */
export function computeIterationRollups (
  issues: readonly RollupIssue[],
  fieldKey: string,
  doneStatuses: ReadonlySet<string>
): Map<string | undefined, IterationRollup> {
  const groups = new Map<string | undefined, RollupIssue[]>()
  for (const issue of issues) {
    const raw = issue.customFields?.[fieldKey]
    const key = typeof raw === 'string' && raw !== '' ? raw : undefined
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [issue])
    else list.push(issue)
  }
  const res = new Map<string | undefined, IterationRollup>()
  for (const [key, list] of groups) res.set(key, computeRollup(list, doneStatuses))
  return res
}
