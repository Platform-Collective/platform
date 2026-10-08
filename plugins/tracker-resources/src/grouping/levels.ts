//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/** The "No grouping" value of the group-by view option (it is `noCategory` of the view plugin). */
export const NO_GROUPING = '#no_category'

/** Levels of grouping a layout offers: the Table nests up to three, the Board and the Roadmap two. */
export const MAX_TABLE_GROUP_LEVELS = 3
export const MAX_BOARD_GROUP_LEVELS = 2
export const MAX_ROADMAP_GROUP_LEVELS = 2

export interface GroupLevelsOptions {
  // The most levels of the layout
  max: number
  // Keys that are not a level here (the board does not group by the field of its columns)
  exclude?: readonly string[]
  // Keys that can be grouped by in this project; a key that is not available (a deleted custom field) is skipped
  isAvailable?: (key: string) => boolean
}

/**
 * The levels of grouping a layout draws, from the `groupBy` of the view options. "No grouping" ends the list (the
 * view options keep it only as the single entry), a key that repeats an earlier level, an excluded or an
 * unavailable key is skipped, and at most `max` levels are used. A stored single `groupBy` gives the same single
 * level as it always did.
 */
export function resolveGroupLevels (groupBy: readonly string[] | undefined, options: GroupLevelsOptions): string[] {
  const res: string[] = []
  for (const key of groupBy ?? []) {
    if (typeof key !== 'string' || key === '' || key === NO_GROUPING) break
    if (res.includes(key) || options.exclude?.includes(key) === true) continue
    if (options.isAvailable !== undefined && !options.isAvailable(key)) continue
    res.push(key)
    if (res.length >= options.max) break
  }
  return res
}

/** Layouts that keep state of their groups per view. */
export type GroupLayout = 'table' | 'roadmap' | 'board'

/**
 * Identity of a view for the state its groups keep (collapsed groups): the project and the saved view. The table
 * adds the group path to it, the roadmap and the board store a set of collapsed group ids under it.
 */
export function groupStateScope (project: string | undefined, viewId: string | undefined): string | undefined {
  return viewId === undefined || viewId === '' ? undefined : `${project ?? 'all'}.${viewId}`
}

/** Local storage key of the collapsed groups of one view in one layout. */
export function collapsedGroupsStorageKey (layout: GroupLayout, scope: string): string {
  return `tracker.groups.collapsed.${layout}.${scope}`
}
