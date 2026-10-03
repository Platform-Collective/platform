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
  key: string
  // What the swimlane stands for (an id, a category object of a built-in field, or `undefined` for "No <field>")
  category: C
  // All items of the swimlane, also those in hidden columns
  items: T[]
  // One cell per visible column, in the order of the columns
  cells: Array<BoardCell<T, C>>
  // Items of the swimlane in visible columns
  count: number
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
}

/**
 * Lays the items out as swimlanes of columns. Both axes are single level: an item is in exactly one swimlane and
 * one column. An item whose swimlane or column is not among the given ones (for example a hidden column) is in
 * none of the cells.
 */
export function buildBoardGrid<T, C = unknown> (input: BoardGridInput<T, C>): BoardGrid<T, C> {
  const { items, lanes, columns } = input
  const byLane = input.bucketLanes(items)
  const lanesOut: Array<BoardLane<T, C>> = []
  for (const category of lanes) {
    const key = categoryKey(category)
    const laneItems = byLane[key] ?? []
    if (laneItems.length === 0 && !input.showEmptyLanes) continue
    const byColumn = input.bucketColumns(laneItems)
    const cells = columns.map((column) => {
      const columnKey = categoryKey(column)
      return { columnKey, column, items: byColumn[columnKey] ?? [] }
    })
    lanesOut.push({ key, category, items: laneItems, cells, count: cells.reduce((sum, c) => sum + c.items.length, 0) })
  }
  const totals = new Map<string, number>()
  for (const [key, bucket] of Object.entries(input.bucketColumns(items))) totals.set(key, bucket.length)
  return { lanes: lanesOut, columnTotals: totals }
}

/** The collapsed swimlanes after one of them was collapsed or expanded. */
export function toggleLane (collapsed: ReadonlySet<string>, laneKey: string): Set<string> {
  const next = new Set(collapsed)
  if (next.has(laneKey)) next.delete(laneKey)
  else next.add(laneKey)
  return next
}

/** Items of the grid in the order a keyboard moves through them: swimlane by swimlane, column by column. */
export function gridOrder<T, C> (grid: BoardGrid<T, C>, collapsed: ReadonlySet<string>): T[] {
  const res: T[] = []
  for (const lane of grid.lanes) {
    if (collapsed.has(lane.key)) continue
    for (const cell of lane.cells) res.push(...cell.items)
  }
  return res
}
