//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

export interface RoadmapGroupOf<T> {
  id: string
  // Value of the group (an id, an option value...); undefined for the items without a value
  value: string | undefined
  items: T[]
}

export const EMPTY_GROUP_ID = 'group:'

export function groupIdOf (value: string | undefined): string {
  return value === undefined ? EMPTY_GROUP_ID : `group:${value}`
}

/**
 * Splits items into groups by a value. Groups appear in the order of `order` when it is given (values that are
 * not listed follow in the order they are met), otherwise in first-seen order; the group without a value is last.
 * Items keep their relative order inside a group, so a sort applied before grouping is preserved.
 * `includeEmpty` also lists the groups of `order` that have no items.
 */
export function groupItems<T> (
  items: readonly T[],
  valueOf: (item: T) => string | undefined,
  order?: ReadonlyArray<string | undefined>,
  includeEmpty: boolean = false
): Array<RoadmapGroupOf<T>> {
  const buckets = new Map<string | undefined, T[]>()
  for (const item of items) {
    const raw = valueOf(item)
    const value = raw === '' || raw === null ? undefined : raw
    const bucket = buckets.get(value)
    if (bucket === undefined) buckets.set(value, [item])
    else bucket.push(item)
  }

  const res: Array<RoadmapGroupOf<T>> = []
  const push = (value: string | undefined): void => {
    const bucket = buckets.get(value)
    if (bucket === undefined && !includeEmpty) return
    res.push({ id: groupIdOf(value), value, items: bucket ?? [] })
    buckets.delete(value)
  }

  for (const value of order ?? []) {
    if (value !== undefined) push(value)
  }
  for (const value of [...buckets.keys()]) {
    if (value !== undefined) push(value)
  }
  if (buckets.has(undefined) || (includeEmpty && (order ?? []).includes(undefined))) push(undefined)
  return res
}

/** Orders groups by a label (the group without a value stays last). */
export function sortGroupsByLabel<T> (
  groups: Array<RoadmapGroupOf<T>>,
  labelOf: (value: string) => string
): Array<RoadmapGroupOf<T>> {
  return [...groups].sort((a, b) => {
    if (a.value === undefined || b.value === undefined) return a.value === b.value ? 0 : a.value === undefined ? 1 : -1
    return labelOf(a.value).localeCompare(labelOf(b.value))
  })
}
