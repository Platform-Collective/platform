//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Pure logic of the tree display of a list (GitHub-Projects style "Show hierarchy"): turns a flat list
// of items into the ordered rows of a tree. Kept free of UI and platform imports so that it can be unit tested.

/** Levels of nesting a tree shows, the same as GitHub Projects. */
export const MAX_HIERARCHY_DEPTH = 8

export interface HierarchyOptions<T> {
  idOf: (item: T) => string
  // Id of the parent of an item; undefined (or an id that is not in the list) makes the item a top level row
  parentOf: (item: T) => string | undefined
  // Ids of the items whose children are shown
  expanded: ReadonlySet<string>
  // Levels of nesting, defaults to MAX_HIERARCHY_DEPTH
  maxDepth?: number
}

export interface HierarchyRow<T> {
  item: T
  // Nesting level, 0 for a top level row
  depth: number
  // Number of children of the item that are in the list
  childCount: number
  // Whether the row can be expanded (it has children that are nested under it)
  hasChildren: boolean
  expanded: boolean
}

interface Frame<T> {
  item: T
  depth: number
  visible: boolean
}

/**
 * The visible rows of a tree, in display order (a parent is followed by its expanded children).
 *
 * - Only items of the list take part: an item whose parent is not in the list (the parent was filtered
 *   out, is in another group, ...) is a top level row, so nothing is lost.
 * - The order of the list is kept among the siblings, so a sort applied before is preserved.
 * - Items below the deepest level are not nested any more: they follow as top level rows right after
 *   the tree they belong to.
 * - A broken reference (a cycle) never loops; the items of a cycle are shown as top level rows.
 */
export function buildHierarchyRows<T>(items: readonly T[], options: HierarchyOptions<T>): Array<HierarchyRow<T>> {
  const { idOf, parentOf, expanded } = options
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? MAX_HIERARCHY_DEPTH))

  // The first occurrence of an id wins
  const ids = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const id = idOf(item)
    if (ids.has(id)) continue
    ids.add(id)
    unique.push(item)
  }

  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const item of unique) {
    const id = idOf(item)
    const parent = parentOf(item)
    if (parent === undefined || parent === id || !ids.has(parent)) {
      roots.push(item)
      continue
    }
    const list = children.get(parent)
    if (list === undefined) children.set(parent, [item])
    else list.push(item)
  }

  const rows: Array<HierarchyRow<T>> = []
  const visited = new Set<string>()

  // Walks one tree; returns the items that are too deep to be nested
  function walk (root: T): T[] {
    const overflow: T[] = []
    const stack: Array<Frame<T>> = [{ item: root, depth: 0, visible: true }]
    while (stack.length > 0) {
      const frame = stack.pop() as Frame<T>
      const id = idOf(frame.item)
      if (visited.has(id)) continue
      visited.add(id)
      const kids = (children.get(id) ?? []).filter((it) => !visited.has(idOf(it)))
      const nestable = frame.depth < maxDepth - 1
      const hasChildren = nestable && kids.length > 0
      const isExpanded = hasChildren && expanded.has(id)
      // Hidden rows are still visited, so that they are not picked up as stray top level rows
      if (frame.visible) {
        rows.push({
          item: frame.item,
          depth: frame.depth,
          childCount: nestable ? kids.length : 0,
          hasChildren,
          expanded: isExpanded
        })
      }
      if (nestable) {
        for (let i = kids.length - 1; i >= 0; i--) {
          stack.push({ item: kids[i], depth: frame.depth + 1, visible: frame.visible && isExpanded })
        }
      } else if (frame.visible) {
        for (const kid of kids) overflow.push(kid)
      } else {
        // Below a collapsed row: everything stays hidden, but is visited
        for (let i = kids.length - 1; i >= 0; i--) stack.push({ item: kids[i], depth: frame.depth + 1, visible: false })
      }
    }
    return overflow
  }

  // Places a top level row and the items that are too deep to be nested under it, right after its tree
  const place = (root: T): void => {
    const stack: T[] = [root]
    while (stack.length > 0) {
      const next = stack.pop() as T
      if (visited.has(idOf(next))) continue
      const overflow = walk(next)
      for (let i = overflow.length - 1; i >= 0; i--) stack.push(overflow[i])
    }
  }
  for (const root of roots) place(root)
  // Whatever is left is part of a cycle
  for (const item of unique) {
    if (!visited.has(idOf(item))) place(item)
  }
  return rows
}

/**
 * Ids of the items that have children in the list and are therefore worth expanding.
 */
export function expandableIds<T> (
  items: readonly T[],
  idOf: (item: T) => string,
  parentOf: (item: T) => string | undefined
): string[] {
  const ids = new Set(items.map(idOf))
  const parents = new Set<string>()
  for (const item of items) {
    const parent = parentOf(item)
    if (parent !== undefined && parent !== idOf(item) && ids.has(parent)) parents.add(parent)
  }
  return [...parents]
}
