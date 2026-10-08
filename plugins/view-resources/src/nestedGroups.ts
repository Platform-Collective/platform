//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Pure logic of the nested (multi-level) grouping of a list: the rows of the "Group by / Then by" controls of the
// Customize View popup and the order of the groups of a level. Kept free of UI and platform imports so that it can be
// unit tested.

/** The "No grouping" choice of a group-by control; it is `noCategory` of the view options. */
export const NO_GROUPING = '#no_category'

/**
 * The rows of the group-by controls for the levels chosen so far: one row per level and, while the layout allows
 * another level (`depth`; unlimited when absent), one more row to choose it.
 */
export function groupByRows (groupBy: readonly string[], depth?: number): string[] {
  const rows = [...groupBy]
  if (rows.length === 0) return [NO_GROUPING]
  const complete = rows[rows.length - 1] === NO_GROUPING || (depth !== undefined && rows.length >= depth)
  return complete ? rows : [...rows, NO_GROUPING]
}

/**
 * The rows after `value` was chosen for the row `index`. Choosing "No grouping" ends the levels there. Choosing a
 * key keeps the levels below it, except a key that is now repeated, and offers a row for the next level while the
 * layout allows one.
 */
export function selectGroupLevel (rows: readonly string[], index: number, value: string, depth?: number): string[] {
  const above = rows.slice(0, index)
  if (value === NO_GROUPING) return [...above, NO_GROUPING]
  const below = rows.slice(index + 1).filter((key) => key !== NO_GROUPING && key !== value && !above.includes(key))
  const levels = [...above, value, ...below]
  const capped = depth === undefined ? levels : levels.slice(0, depth)
  return depth === undefined || capped.length < depth ? [...capped, NO_GROUPING] : capped
}

/** The `groupBy` view option for the rows of the controls: the chosen levels, or the single "No grouping". */
export function groupByFromRows (rows: readonly string[]): string[] {
  return rows.length > 1 ? rows.filter((key) => key !== NO_GROUPING) : [...rows]
}

/** Whether a group (category) stands for the documents without a value. */
export function isEmptyCategory (category: unknown): boolean {
  if (category === undefined || category === null) return true
  return typeof category === 'object' && (category as { name?: unknown }).name === undefined
}

/**
 * The groups of a level with the group of the documents without a value last; the other groups keep their order.
 * The same array is returned when it already is in that order.
 */
export function emptyCategoryLast<T> (categories: readonly T[]): T[] {
  const firstEmpty = categories.findIndex(isEmptyCategory)
  if (firstEmpty === -1) return categories as T[]
  const empty = categories.filter(isEmptyCategory)
  const rest = categories.filter((it) => !isEmptyCategory(it))
  const res = [...rest, ...empty]
  return res.every((it, i) => it === categories[i]) ? (categories as T[]) : res
}

/**
 * The groups of a level below the first that hold documents. A level under a group lists only what is in that group,
 * so a group that the host listed for being empty (show empty groups) is left out there.
 */
export function categoriesWithDocs<T> (categories: readonly T[], countOf: (category: T) => number): T[] {
  return categories.filter((category) => countOf(category) > 0)
}
