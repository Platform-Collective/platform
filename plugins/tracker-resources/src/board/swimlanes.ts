//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { categoryKey } from './columns'

/** Items of one swimlane that fall into one column. */
export interface BoardCell<T, C = unknown> {
  columnKey: string
  column: C
  items: T[]
}

export interface BoardLane<T, C = unknown> {
  // Unique key of the lane: the key of its category, for a sub-lane the key of its swimlane and its own (a path)
  key: string
  // What the swimlane stands for (an id, a category object of a built-in field, or `undefined` for "No <field>")
  category: C
  // The categories from the swimlane down to this lane: one for a swimlane, two for a sub-lane
  path: C[]
  // 0 for a swimlane, 1 for a sub-lane
  depth: number
  // All items of the lane, also those in hidden columns
  items: T[]
  // One cell per visible column, in the order of the columns; empty for a swimlane that has sub-lanes (they hold
  // the cells)
  cells: Array<BoardCell<T, C>>
  // Items of the lane in visible columns
  count: number
  // Sub-lanes ("Then by"), top to bottom; empty when the board has one level of swimlanes
  subLanes: Array<BoardLane<T, C>>
}

export interface BoardGrid<T, C = unknown> {
  lanes: Array<BoardLane<T, C>>
  // Items per column key over all swimlanes
  columnTotals: Map<string, number>
}

export interface BoardGridInput<T, C = unknown> {
  items: readonly T[]
  // Swimlanes top to bottom
  lanes: readonly C[]
  // Visible columns left to right
  columns: readonly C[]
  // Groups items into buckets named by `categoryKey`; the grouping of the field of the swimlanes
  bucketLanes: (items: readonly T[]) => Record<string, T[]>
  // The same for the field of the columns
  bucketColumns: (items: readonly T[]) => Record<string, T[]>
  // Swimlanes without items are dropped unless this is set
  showEmptyLanes: boolean
  // Sub-lanes of every swimlane ("Then by") and the grouping of their field. A sub-lane without items in its
  // swimlane is dropped, so "show empty groups" applies to the first level only.
  subLanes?: readonly C[]
  bucketSubLanes?: (items: readonly T[]) => Record<string, T[]>
}

/**
 * Lays the items out as swimlanes of columns, optionally with a second level of sub-lanes inside every swimlane. An
 * item is in exactly one swimlane (and sub-lane) and one column. An item whose swimlane, sub-lane or column is not
 * among the given ones (for example a hidden column) is in none of the cells.
 */
export function buildBoardGrid<T, C = unknown> (input: BoardGridInput<T, C>): BoardGrid<T, C> {
  const { items, lanes, columns } = input

  const makeCells = (laneItems: readonly T[]): Array<BoardCell<T, C>> => {
    const byColumn = input.bucketColumns(laneItems)
    return columns.map((column) => {
      const columnKey = categoryKey(column)
      return { columnKey, column, items: byColumn[columnKey] ?? [] }
    })
  }

  const byLane = input.bucketLanes(items)
  const lanesOut: Array<BoardLane<T, C>> = []
  for (const category of lanes) {
    const key = categoryKey(category)
    const laneItems = byLane[key] ?? []
    if (laneItems.length === 0 && !input.showEmptyLanes) continue

    const subLanes: Array<BoardLane<T, C>> = []
    if (input.subLanes !== undefined && input.bucketSubLanes !== undefined) {
      const bySub = input.bucketSubLanes(laneItems)
      for (const sub of input.subLanes) {
        const subItems = bySub[categoryKey(sub)] ?? []
        if (subItems.length === 0) continue
        const cells = makeCells(subItems)
        subLanes.push({
          key: `${key}\u0000${categoryKey(sub)}`,
          category: sub,
          path: [category, sub],
          depth: 1,
          items: subItems,
          cells,
          count: cells.reduce((sum, c) => sum + c.items.length, 0),
          subLanes: []
        })
      }
    }

    const cells = subLanes.length > 0 ? [] : makeCells(laneItems)
    lanesOut.push({
      key,
      category,
      path: [category],
      depth: 0,
      items: laneItems,
      cells,
      count: subLanes.length > 0 ? subLanes.reduce((sum, l) => sum + l.count, 0) : cells.reduce((sum, c) => sum + c.items.length, 0),
      subLanes
    })
  }
  const totals = new Map<string, number>()
  for (const [key, bucket] of Object.entries(input.bucketColumns(items))) totals.set(key, bucket.length)
  return { lanes: lanesOut, columnTotals: totals }
}

/** The lanes that hold cells, top to bottom: a swimlane without sub-lanes, or the sub-lanes of a swimlane. */
export function cellLanes<T, C> (grid: BoardGrid<T, C>): Array<BoardLane<T, C>> {
  return grid.lanes.flatMap((lane) => (lane.subLanes.length > 0 ? lane.subLanes : [lane]))
}

/** The collapsed swimlanes after one of them was collapsed or expanded. */
export function toggleLane (collapsed: ReadonlySet<string>, laneKey: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(laneKey)) next.delete(laneKey)
  else next.add(laneKey)
  return next
}

/** Items of the grid in the order a keyboard moves through them: lane by lane, column by column. */
export function gridOrder<T, C> (grid: BoardGrid<T, C>, collapsed: ReadonlySet<string>): T[] {
  const res: T[] = []
  for (const lane of grid.lanes) {
    if (collapsed.has(lane.key)) continue
    for (const own of lane.subLanes.length > 0 ? lane.subLanes : [lane]) {
      if (collapsed.has(own.key)) continue
      for (const cell of own.cells) res.push(...cell.items)
    }
  }
  return res
}
