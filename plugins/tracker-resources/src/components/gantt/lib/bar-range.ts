//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

export interface IssueDateRange {
  startDate: number | null | undefined
  dueDate: number | null | undefined
}

export interface BarDateRange {
  startDate: number
  dueDate: number
  /** True when startDate is a display/editing fallback, not a persisted value. */
  hasInferredStart: boolean
}

/**
 * Resolve the date range used to draw an issue bar.
 *
 * A due-date-only issue is still a scheduled commitment: give it the same
 * single inclusive day ending on its due date. The inferred start is deliberately
 * returned separately so callers can persist it only after the user changes
 * the bar.
 */
export function getIssueBarRange (issue: IssueDateRange): BarDateRange | null {
  if (issue.startDate != null && issue.dueDate != null) {
    return { startDate: issue.startDate, dueDate: issue.dueDate, hasInferredStart: false }
  }
  if (issue.startDate == null && issue.dueDate != null) {
    return {
      startDate: issue.dueDate,
      dueDate: issue.dueDate,
      hasInferredStart: true
    }
  }
  return null
}
