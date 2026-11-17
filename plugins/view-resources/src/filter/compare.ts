//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//
import view, { type Filter } from '@hcengineering/view'

/**
 * Compares filters the way a person reads them: as sets of selected values.
 *
 * A saved view keeps its filters as JSON, and the filter bar and the saved-view
 * list used to compare that JSON with the current filters as plain strings.
 * Unticking a value and ticking it again appends it to the end of the filter's
 * `value` array, so the same filters gave a different string: the view looked
 * changed ("Save" / "Save as" appeared) and, after a reload, no saved view
 * matched any more.
 *
 * For the modes below the order of `value` has no meaning (they all become
 * `$in` / `$nin` / `$all` style queries), so their values are put in a fixed
 * order before comparing. Every other mode (dates, "contains", nested filters
 * themselves) keeps its order, because there it can matter.
 */
const UNORDERED_MODES = new Set<string>([
  view.filter.FilterObjectIn,
  view.filter.FilterObjectNin,
  view.filter.FilterValueIn,
  view.filter.FilterValueNin,
  view.filter.FilterArrayAll,
  view.filter.FilterArrayAny
])

// JSON.stringify(undefined) is undefined; inside an array it is written as null.
function valueKey (value: unknown): string {
  return JSON.stringify(value) ?? 'null'
}

function normalizeFilter (filter: Filter): Filter {
  const value =
    UNORDERED_MODES.has(filter.mode) && Array.isArray(filter.value)
      ? [...filter.value].sort((a, b) => {
          const ka = valueKey(a)
          const kb = valueKey(b)
          return ka < kb ? -1 : ka > kb ? 1 : 0
        })
      : filter.value
  const nested = filter.nested !== undefined ? normalizeFilter(filter.nested) : undefined
  return { ...filter, value, ...(nested !== undefined ? { nested } : {}) }
}

/**
 * A string that is equal for two filter lists exactly when they select the same
 * values. Accepts filters, or the JSON a FilteredView stores in `filters`.
 * Unreadable JSON is returned unchanged, so it still compares as before.
 */
export function filtersKey (filters: Filter[] | string): string {
  let parsed: unknown = filters
  if (typeof filters === 'string') {
    try {
      parsed = JSON.parse(filters)
    } catch {
      return filters
    }
  }
  if (!Array.isArray(parsed)) return typeof filters === 'string' ? filters : JSON.stringify(filters)
  return JSON.stringify((parsed as Filter[]).map(normalizeFilter))
}

/**
 * True when both filter lists select the same values, whatever order the
 * values of an "is" / "is not" style filter were ticked in.
 */
export function sameFilters (a: Filter[] | string, b: Filter[] | string): boolean {
  return filtersKey(a) === filtersKey(b)
}
