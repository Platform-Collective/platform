//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Pure geometry of a cell grid: focus movement, rectangular selection, paste placement and fill-down.
// Rows and columns are zero based indexes into the grid that is currently displayed.

/** @public */
export interface CellPos {
  row: number
  col: number
}

/** Inclusive rectangle of cells. */
export interface CellRect {
  top: number
  left: number
  bottom: number
  right: number
}

/** Number of displayed rows and columns. */
export interface GridDims {
  rows: number
  cols: number
}

/** Anchor is where a selection started, focus is the moving end (and the cell that is edited). */
export interface CellSelection {
  anchor: CellPos
  focus: CellPos
}

export type MoveDirection = 'up' | 'down' | 'left' | 'right'

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

export function clampPos (pos: CellPos, dims: GridDims): CellPos {
  return { row: clamp(pos.row, 0, Math.max(dims.rows - 1, 0)), col: clamp(pos.col, 0, Math.max(dims.cols - 1, 0)) }
}

export function samePos (a: CellPos, b: CellPos): boolean {
  return a.row === b.row && a.col === b.col
}

export function rectOf (a: CellPos, b: CellPos): CellRect {
  return {
    top: Math.min(a.row, b.row),
    bottom: Math.max(a.row, b.row),
    left: Math.min(a.col, b.col),
    right: Math.max(a.col, b.col)
  }
}

export function selectionRect (selection: CellSelection): CellRect {
  return rectOf(selection.anchor, selection.focus)
}

export function rectContains (rect: CellRect, pos: CellPos): boolean {
  return pos.row >= rect.top && pos.row <= rect.bottom && pos.col >= rect.left && pos.col <= rect.right
}

export function rectRows (rect: CellRect): number {
  return rect.bottom - rect.top + 1
}

export function rectCols (rect: CellRect): number {
  return rect.right - rect.left + 1
}

export function isSingleCell (rect: CellRect): boolean {
  return rectRows(rect) === 1 && rectCols(rect) === 1
}

/** All cells of a rectangle, row by row. */
export function rectCells (rect: CellRect): CellPos[] {
  const res: CellPos[] = []
  for (let row = rect.top; row <= rect.bottom; row++) {
    for (let col = rect.left; col <= rect.right; col++) res.push({ row, col })
  }
  return res
}

/**
 * Move a cell by one step, or to the edge of the grid when `jump` is set. The result stays inside the grid.
 */
export function movePos (pos: CellPos, dir: MoveDirection, dims: GridDims, jump = false): CellPos {
  const lastRow = Math.max(dims.rows - 1, 0)
  const lastCol = Math.max(dims.cols - 1, 0)
  switch (dir) {
    case 'up':
      return clampPos({ row: jump ? 0 : pos.row - 1, col: pos.col }, dims)
    case 'down':
      return clampPos({ row: jump ? lastRow : pos.row + 1, col: pos.col }, dims)
    case 'left':
      return clampPos({ row: pos.row, col: jump ? 0 : pos.col - 1 }, dims)
    case 'right':
      return clampPos({ row: pos.row, col: jump ? lastCol : pos.col + 1 }, dims)
  }
}

/** Arrow key: the selection collapses to the moved focus cell. */
export function moveSelection (selection: CellSelection, dir: MoveDirection, dims: GridDims, jump = false): CellSelection {
  const focus = movePos(selection.focus, dir, dims, jump)
  return { anchor: focus, focus }
}

/** Shift + arrow key: the anchor stays, the focus end moves, so the selection stays a rectangle. */
export function extendSelection (
  selection: CellSelection,
  dir: MoveDirection,
  dims: GridDims,
  jump = false
): CellSelection {
  return { anchor: selection.anchor, focus: movePos(selection.focus, dir, dims, jump) }
}

/**
 * Tab / Shift+Tab: one cell to the right (left); past the end of a row it continues on the next (previous) row.
 * Stays on the first (last) cell at the grid edge.
 */
export function tabPos (pos: CellPos, dims: GridDims, backwards: boolean): CellPos {
  if (dims.rows === 0 || dims.cols === 0) return pos
  if (!backwards) {
    if (pos.col + 1 < dims.cols) return { row: pos.row, col: pos.col + 1 }
    return pos.row + 1 < dims.rows ? { row: pos.row + 1, col: 0 } : pos
  }
  if (pos.col > 0) return { row: pos.row, col: pos.col - 1 }
  return pos.row > 0 ? { row: pos.row - 1, col: dims.cols - 1 } : pos
}

export interface PasteTarget {
  target: CellPos
  // Index of the clipboard row / column the text comes from
  fromRow: number
  fromCol: number
}

export interface PastePlacement {
  cells: PasteTarget[]
  // Clipboard cells that did not fit into the grid
  clipped: number
}

/**
 * Where the cells of a pasted block go. A single value fills every selected cell; a larger block is placed
 * from the top left cell of the selection and is cut at the edge of the grid.
 */
export function placePaste (selection: CellRect, block: ReadonlyArray<readonly string[]>, dims: GridDims): PastePlacement {
  const blockRows = block.length
  const blockCols = block.reduce((max, row) => Math.max(max, row.length), 0)
  if (blockRows === 0 || blockCols === 0) return { cells: [], clipped: 0 }

  if (blockRows === 1 && blockCols === 1) {
    return {
      cells: rectCells(selection).map((target) => ({ target, fromRow: 0, fromCol: 0 })),
      clipped: 0
    }
  }
  const cells: PasteTarget[] = []
  let clipped = 0
  for (let r = 0; r < blockRows; r++) {
    for (let c = 0; c < block[r].length; c++) {
      const target = { row: selection.top + r, col: selection.left + c }
      if (target.row >= dims.rows || target.col >= dims.cols) clipped++
      else cells.push({ target, fromRow: r, fromCol: c })
    }
  }
  return { cells, clipped }
}

export interface FillTarget {
  target: CellPos
  source: CellPos
}

/**
 * Drag the fill handle of a selection down to `toRow`: the selected rows are repeated downwards
 * (a one row selection is copied to every row). Dragging to or above the selection fills nothing.
 */
export function fillDown (selection: CellRect, toRow: number, dims: GridDims): FillTarget[] {
  const last = Math.min(toRow, dims.rows - 1)
  if (last <= selection.bottom) return []
  const height = rectRows(selection)
  const res: FillTarget[] = []
  for (let row = selection.bottom + 1; row <= last; row++) {
    const sourceRow = selection.top + ((row - selection.top) % height)
    for (let col = selection.left; col <= selection.right; col++) {
      res.push({ target: { row, col }, source: { row: sourceRow, col } })
    }
  }
  return res
}

/** The selection after a fill: it grows to cover the filled rows. */
export function extendRectDown (selection: CellRect, toRow: number, dims: GridDims): CellRect {
  return { ...selection, bottom: Math.max(selection.bottom, Math.min(toRow, dims.rows - 1)) }
}
