//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { normalizeLimit } from './config'

/**
 * Column limits of the board are advisory (GitHub "Set column limit"): they never stop an item from being
 * dropped on a column, the header only shows the count against the limit and turns red when it is exceeded.
 */
export type LimitState = 'none' | 'within' | 'reached' | 'exceeded'

/** How the count of a column relates to its limit. */
export function limitState (count: number, limit: number | undefined): LimitState {
  const value = normalizeLimit(limit)
  if (value === undefined) return 'none'
  if (count > value) return 'exceeded'
  return count === value ? 'reached' : 'within'
}

/** The count as shown in the column header: `3` without a limit, `3/5` with one. */
export function formatColumnCount (count: number, limit: number | undefined): string {
  const value = normalizeLimit(limit)
  return value === undefined ? String(count) : `${count}/${value}`
}

export type LimitInput =
  // A new limit
  | { ok: true, limit: number }
  // An empty input removes the limit
  | { ok: true, limit: undefined }
  | { ok: false }

/**
 * Reads what the user typed (or what the number input of the popup returned) as a limit. Empty or zero means
 * "no limit"; anything else that is not a positive whole number is rejected.
 */
export function parseLimitInput (raw: unknown): LimitInput {
  if (raw === undefined || raw === null) return { ok: true, limit: undefined }
  const n = typeof raw === 'string' ? (raw.trim() === '' ? undefined : Number(raw.trim())) : raw
  if (n === undefined || n === 0) return { ok: true, limit: undefined }
  const limit = normalizeLimit(n)
  return limit === undefined ? { ok: false } : { ok: true, limit }
}
