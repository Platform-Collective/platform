//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Which parent rows of the hierarchy a viewer has expanded. The state is kept per viewer and per view (in local
// storage), so that the tree stays the way it was left when the view is opened again. Pure helpers; the store
// that uses them is in expansionStore.ts.

/** The most ids that are remembered per view; the oldest are forgotten first. */
export const MAX_EXPANDED_IDS = 2000

/** Local storage key of the expanded rows of one view. */
export function expansionStorageKey (project: string, viewId: string): string {
  return `tracker.hierarchy.expanded.${project}.${viewId}`
}

/** The ids stored in a raw value; anything damaged yields an empty set instead of breaking the view. */
export function parseExpanded (raw: string | null | undefined): Set<string> {
  if (raw === null || raw === undefined || raw === '') return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    const ids = parsed.filter((it): it is string => typeof it === 'string' && it !== '')
    return new Set(ids.slice(-MAX_EXPANDED_IDS))
  } catch {
    return new Set()
  }
}

export function serializeExpanded (ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids])
}

/**
 * The set with the row expanded or collapsed. A new set is returned, the given one is not changed. An expanded
 * row is the newest of the set; above `MAX_EXPANDED_IDS` the oldest are dropped.
 */
export function toggleExpanded (ids: ReadonlySet<string>, id: string, cap: number = MAX_EXPANDED_IDS): Set<string> {
  const next = new Set(ids)
  if (next.has(id)) {
    next.delete(id)
    return next
  }
  next.add(id)
  while (next.size > cap) {
    const oldest = next.values().next().value as string
    next.delete(oldest)
  }
  return next
}
