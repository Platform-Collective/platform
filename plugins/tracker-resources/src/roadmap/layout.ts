//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ItemSchedule } from './dates'
import type { RoadmapScale } from './timeScale'

export const ROW_HEIGHT = 36
export const GROUP_ROW_HEIGHT = 32
// Narrowest a bar is drawn, so that a one day item stays visible and can be grabbed at the year zoom
export const MIN_BAR_WIDTH = 8
export const MARKER_SIZE = 12

export interface ItemShape {
  kind: 'bar' | 'marker'
  // Left edge and width in pixels, relative to the start of the axis
  x: number
  width: number
  // Horizontal middle
  center: number
}

/**
 * Where an item is drawn: a range is a bar from the first to the end of the last day, a single date is a marker
 * in the middle of its day. Items without dates have no shape.
 */
export function itemShape (schedule: ItemSchedule, scale: RoadmapScale): ItemShape | undefined {
  switch (schedule.kind) {
    case 'unscheduled':
      return undefined
    case 'marker': {
      const center = scale.dayToX(schedule.day) + scale.pxPerDay / 2
      return { kind: 'marker', x: center - MARKER_SIZE / 2, width: MARKER_SIZE, center }
    }
    case 'range': {
      const x = scale.dayToX(schedule.start)
      const width = Math.max(scale.dayToX(schedule.target + 1) - x, MIN_BAR_WIDTH)
      return { kind: 'bar', x, width, center: x + width / 2 }
    }
  }
}

export type LabelPlacement = 'inside' | 'left' | 'right'

/**
 * Where the text of an item goes: inside the bar when it fits, otherwise next to it on the side that has room.
 */
export function placeLabel (shape: ItemShape, textWidth: number, axisWidth: number, gap: number = 8): LabelPlacement {
  if (shape.kind === 'bar' && shape.width >= textWidth + gap * 2) return 'inside'
  if (shape.x + shape.width + gap + textWidth <= axisWidth) return 'right'
  if (shape.x - gap - textWidth >= 0) return 'left'
  return 'right'
}

export function estimateTextWidth (text: string, charWidth: number = 7): number {
  return text.length * charWidth
}

// ---- rows ----

export interface RowGroup<T> {
  id: string
  // Items that have dates; for a group with sub groups all the items below it
  items: T[]
  // Sub groups (nested grouping). A group with sub groups draws them instead of its own items.
  children?: ReadonlyArray<RowGroup<T>>
}

export type RoadmapRow<T> =
  // `depth` is the nesting level of the group, 0 for the first level
  | { type: 'group', id: string, depth: number, y: number, height: number, count: number, collapsed: boolean }
  | { type: 'item', id: string, item: T, y: number, height: number, unscheduled: boolean }
  | { type: 'unscheduled', id: string, y: number, height: number, count: number, collapsed: boolean }

export interface RowParams<T> {
  groups: ReadonlyArray<RowGroup<T>>
  // Items without dates; they are listed after all groups under one header
  unscheduled: readonly T[]
  idOf: (item: T) => string
  // Ids of the collapsed groups; the id UNSCHEDULED_ID collapses the unscheduled section
  collapsed: ReadonlySet<string>
  // Without grouping there are no group headers
  showGroupHeaders: boolean
  rowHeight?: number
  groupHeight?: number
}

export const UNSCHEDULED_ID = '#unscheduled'

export interface RowsLayout<T> {
  rows: Array<RoadmapRow<T>>
  height: number
}

/**
 * Vertical layout of the roadmap: an optional header per group followed by its sub groups (or, at the last level,
 * its items), and the section of the items without dates at the end.
 */
export function buildRows<T> (params: RowParams<T>): RowsLayout<T> {
  const rowHeight = params.rowHeight ?? ROW_HEIGHT
  const groupHeight = params.groupHeight ?? GROUP_ROW_HEIGHT
  const rows: Array<RoadmapRow<T>> = []
  let y = 0

  const addGroups = (groups: ReadonlyArray<RowGroup<T>>, depth: number): void => {
    for (const group of groups) {
      const collapsed = params.collapsed.has(group.id)
      if (params.showGroupHeaders) {
        rows.push({ type: 'group', id: group.id, depth, y, height: groupHeight, count: group.items.length, collapsed })
        y += groupHeight
      }
      if (collapsed && params.showGroupHeaders) continue
      if (group.children !== undefined && group.children.length > 0) {
        addGroups(group.children, depth + 1)
        continue
      }
      for (const item of group.items) {
        rows.push({ type: 'item', id: params.idOf(item), item, y, height: rowHeight, unscheduled: false })
        y += rowHeight
      }
    }
  }
  addGroups(params.groups, 0)

  if (params.unscheduled.length > 0) {
    const collapsed = params.collapsed.has(UNSCHEDULED_ID)
    rows.push({
      type: 'unscheduled',
      id: UNSCHEDULED_ID,
      y,
      height: groupHeight,
      count: params.unscheduled.length,
      collapsed
    })
    y += groupHeight
    if (!collapsed) {
      for (const item of params.unscheduled) {
        rows.push({ type: 'item', id: params.idOf(item), item, y, height: rowHeight, unscheduled: true })
        y += rowHeight
      }
    }
  }
  return { rows, height: y }
}

/**
 * Index range [first, last) of the rows that intersect the viewport, widened by `overscan` rows.
 * Rows are ordered by `y`.
 */
export function visibleRowRange (
  rows: ReadonlyArray<Pick<RoadmapRow<unknown>, 'y' | 'height'>>,
  top: number,
  viewportHeight: number,
  overscan: number = 4
): [number, number] {
  if (rows.length === 0) return [0, 0]
  const bottom = top + viewportHeight
  // First row whose bottom edge is below the top of the viewport
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].y + rows[mid].height <= top) lo = mid + 1
    else hi = mid
  }
  const first = lo
  // First row that starts below the viewport
  lo = first
  hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].y < bottom) lo = mid + 1
    else hi = mid
  }
  return [Math.max(0, first - overscan), Math.min(rows.length, lo + overscan)]
}
