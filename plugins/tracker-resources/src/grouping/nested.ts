//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/**
 * Pure logic of nested (multi-level) grouping: the items are split by the value of a first field, every group by a
 * second field and so on. It is used by the layouts that draw their own groups (the roadmap rows and the board
 * swimlanes); the table uses the generic nested list of the view plugin.
 *
 * A "value" is what an item has in a field: an id, an option value, a number turned into a string... or `undefined`
 * for an item without a value ("No <field>"). The group without a value is always the last one of its level.
 */

/** How the items are split at one level. */
export interface GroupLevel<T> {
  // Value of an item at this level; `undefined`, `null` and an empty string mean "no value"
  valueOf: (item: T) => string | undefined | null
  // Known values in their display order: the options of a field, the iterations in calendar order. Values that are
  // not listed follow, in the order of `compare` (or in the order they are met without it).
  order?: ReadonlyArray<string | undefined>
  // Orders the values that `order` does not list, e.g. alphabetically by their label
  compare?: (a: string, b: string) => number
  // Also list the values of `order` that have no items
  includeEmpty?: boolean
}

export interface NestedGroup<T> {
  // Unique and stable path of the group (see `groupPathId`): it does not change when other groups come or go,
  // so it can key the collapsed state of the group
  id: string
  // 0 for the first level
  level: number
  // Value of the group at its own level; `undefined` for "No <field>"
  value: string | undefined
  parentId: string | undefined
  // Every item below the group, in the order of the input
  items: T[]
  // Groups of the next level; empty at the last level
  children: Array<NestedGroup<T>>
}

/** Row of the flat, drawn form of the groups. */
export type NestedRow<T> =
  | { type: 'group', group: NestedGroup<T>, depth: number, collapsed: boolean }
  | { type: 'item', item: T, depth: number, group: NestedGroup<T> }

const NO_VALUE = ''

/** Path id of a group: the id of its parent and its own value (empty for "No <field>"). */
export function groupPathId (parentId: string | undefined, value: string | undefined): string {
  return `${parentId ?? ''}/${value === undefined ? NO_VALUE : encodeURIComponent(value)}`
}

function normalize (raw: string | undefined | null): string | undefined {
  return raw === undefined || raw === null || raw === '' ? undefined : String(raw)
}

interface Bucket<T> {
  value: string | undefined
  items: T[]
}

// The buckets of one level in display order
function bucketLevel<T> (items: readonly T[], level: GroupLevel<T>): Array<Bucket<T>> {
  const buckets = new Map<string | undefined, T[]>()
  for (const item of items) {
    const value = normalize(level.valueOf(item))
    const bucket = buckets.get(value)
    if (bucket === undefined) buckets.set(value, [item])
    else bucket.push(item)
  }

  const res: Array<Bucket<T>> = []
  const emit = (value: string | undefined, includeIfEmpty: boolean): void => {
    const bucket = buckets.get(value)
    if (bucket === undefined && !includeIfEmpty) return
    res.push({ value, items: bucket ?? [] })
    buckets.delete(value)
  }

  const listed = new Set<string>()
  for (const value of level.order ?? []) {
    if (value === undefined || listed.has(value)) continue
    listed.add(value)
    emit(value, level.includeEmpty === true)
  }
  const rest = [...buckets.keys()].filter((v): v is string => v !== undefined)
  if (level.compare !== undefined) rest.sort(level.compare)
  for (const value of rest) emit(value, false)
  // "No <field>" is last; with `includeEmpty` it is listed when the order mentions it
  const noValueListed = (level.order ?? []).includes(undefined)
  emit(undefined, level.includeEmpty === true && noValueListed)
  return res
}

function build<T> (
  items: readonly T[],
  levels: ReadonlyArray<GroupLevel<T>>,
  depth: number,
  parentId: string | undefined
): Array<NestedGroup<T>> {
  const level = levels[depth]
  return bucketLevel(items, level).map(({ value, items: own }) => {
    const id = groupPathId(parentId, value)
    return {
      id,
      level: depth,
      value,
      parentId,
      items: own,
      children: depth + 1 < levels.length ? build(own, levels, depth + 1, id) : []
    }
  })
}

/**
 * Splits the items into nested groups, one level per entry of `levels`. Items keep their relative order inside a
 * group, so a sort applied before grouping is preserved. Without levels there are no groups.
 *
 * `includeEmpty` of a level lists the values of its `order` without items under every group of the level above, so
 * a caller that wants "show empty groups" for the first level only sets it there only.
 */
export function buildNestedGroups<T> (
  items: readonly T[],
  levels: ReadonlyArray<GroupLevel<T>>
): Array<NestedGroup<T>> {
  if (levels.length === 0) return []
  return build(items, levels, 0, undefined)
}

/** Every group of the tree, parents before their children. */
export function allGroups<T> (groups: ReadonlyArray<NestedGroup<T>>): Array<NestedGroup<T>> {
  const res: Array<NestedGroup<T>> = []
  const visit = (list: ReadonlyArray<NestedGroup<T>>): void => {
    for (const group of list) {
      res.push(group)
      visit(group.children)
    }
  }
  visit(groups)
  return res
}

/**
 * The groups drawn top to bottom: a group header, then (unless the group is collapsed) its sub groups, or at the
 * last level its items. A collapsed group hides everything below it, not itself.
 */
export function flattenNestedGroups<T> (
  groups: ReadonlyArray<NestedGroup<T>>,
  collapsed: ReadonlySet<string>
): Array<NestedRow<T>> {
  const rows: Array<NestedRow<T>> = []
  const visit = (list: ReadonlyArray<NestedGroup<T>>, depth: number): void => {
    for (const group of list) {
      const isCollapsed = collapsed.has(group.id)
      rows.push({ type: 'group', group, depth, collapsed: isCollapsed })
      if (isCollapsed) continue
      if (group.children.length > 0) {
        visit(group.children, depth + 1)
      } else {
        for (const item of group.items) rows.push({ type: 'item', item, depth: depth + 1, group })
      }
    }
  }
  visit(groups, 0)
  return rows
}

/** Items in the order they are drawn, without those of collapsed groups; the order a keyboard moves through them. */
export function visibleNestedItems<T> (groups: ReadonlyArray<NestedGroup<T>>, collapsed: ReadonlySet<string>): T[] {
  const res: T[] = []
  const visit = (list: ReadonlyArray<NestedGroup<T>>): void => {
    for (const group of list) {
      if (collapsed.has(group.id)) continue
      if (group.children.length > 0) visit(group.children)
      else res.push(...group.items)
    }
  }
  visit(groups)
  return res
}

/**
 * A value computed from the items of every group, at every level (e.g. the sum of a field). The map is keyed by
 * the group id; a group without items is not in it.
 */
export function summarizeGroups<T, R> (
  groups: ReadonlyArray<NestedGroup<T>>,
  summarize: (items: readonly T[]) => R | undefined
): Map<string, R> {
  const res = new Map<string, R>()
  for (const group of allGroups(groups)) {
    if (group.items.length === 0) continue
    const summary = summarize(group.items)
    if (summary !== undefined) res.set(group.id, summary)
  }
  return res
}

/** The collapsed groups after one group was collapsed or expanded; the given set is not changed. */
export function toggleGroupCollapsed (collapsed: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
