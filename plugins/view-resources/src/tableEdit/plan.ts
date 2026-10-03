//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { coalesceOps, countTargets, isNoop, type EditOp } from './journal'
import type { CellRect } from './grid'
import type { ParseFailure, ParseResult } from './values'

/**
 * How one column of the table reads and writes its cells.
 * @public
 */
export interface CellColumn<D = any> {
  // Key of the column as it is marked on the rendered cells
  key: string
  // Text of the cell on the clipboard
  format: (doc: D) => string
  // Operations that set the cell to the value of `text`. Empty text clears the cell.
  // Absent for columns that cannot be edited.
  edit?: (doc: D, text: string) => ParseResult<EditOp[]>
  // Whether the cell may be cleared with Delete
  clearable?: boolean
}

/** @public */
export interface CellAdapter<D = any> {
  column: (key: string) => CellColumn<D> | undefined
  // Applies the operations in one atomic batch
  run: (ops: readonly EditOp[]) => Promise<void>
}

export interface CellEdit<D = any> {
  doc: D
  key: string
  text: string
}

export interface EditPlan {
  ops: EditOp[]
  // Cells that changed
  applied: number
  // Cells that already held the value
  unchanged: number
  // Cells that were left alone because the text did not fit them
  skipped: number
  skippedBy: Partial<Record<ParseFailure, number>>
  // Documents touched
  items: number
}

function docId (doc: any): string {
  return doc._id as string
}

/**
 * Work out the operations of a set of cell edits without applying them. Edits that cannot be applied
 * (wrong type, unknown value, read-only column) are skipped and counted, the others still go through.
 * Several cells of one document are combined, each seeing the result of the previous ones.
 */
export function planEdits<D> (edits: ReadonlyArray<CellEdit<D>>, adapter: Pick<CellAdapter<D>, 'column'>): EditPlan {
  const plan: EditPlan = { ops: [], applied: 0, unchanged: 0, skipped: 0, skippedBy: {}, items: 0 }
  const working = new Map<string, any>()
  const all: EditOp[] = []

  const skip = (reason: ParseFailure): void => {
    plan.skipped++
    plan.skippedBy[reason] = (plan.skippedBy[reason] ?? 0) + 1
  }

  for (const edit of edits) {
    const column = adapter.column(edit.key)
    if (column === undefined) {
      skip('noColumn')
      continue
    }
    if (column.edit === undefined) {
      skip('readonly')
      continue
    }
    const id = docId(edit.doc)
    const current = working.get(id) ?? edit.doc
    const res = column.edit(current, edit.text)
    if (!res.ok) {
      skip(res.reason)
      continue
    }
    if (res.value.every(isNoop) && !res.value.some((op) => op.kind !== 'update')) {
      plan.unchanged++
      continue
    }
    let next = current
    for (const op of res.value) {
      if (op.kind === 'update') next = { ...next, ...op.after }
      all.push(op)
    }
    working.set(id, next)
    plan.applied++
  }
  plan.ops = coalesceOps(all)
  plan.items = countTargets(plan.ops)
  return plan
}

/** The cells of a rectangle to clear; a column that cannot be cleared is skipped and counted. */
export function planClear<D> (
  cells: ReadonlyArray<{ doc: D, key: string }>,
  adapter: Pick<CellAdapter<D>, 'column'>
): EditPlan {
  const clearable: Array<CellEdit<D>> = []
  const rejected: EditPlan = { ops: [], applied: 0, unchanged: 0, skipped: 0, skippedBy: {}, items: 0 }
  for (const cell of cells) {
    const column = adapter.column(cell.key)
    if (column?.edit !== undefined && column.clearable !== true) {
      rejected.skipped++
      rejected.skippedBy.notClearable = (rejected.skippedBy.notClearable ?? 0) + 1
      continue
    }
    clearable.push({ ...cell, text: '' })
  }
  const plan = planEdits(clearable, adapter)
  plan.skipped += rejected.skipped
  for (const [reason, count] of Object.entries(rejected.skippedBy)) {
    plan.skippedBy[reason as ParseFailure] = (plan.skippedBy[reason as ParseFailure] ?? 0) + (count ?? 0)
  }
  return plan
}

/**
 * Text of the cells of a rectangle for the clipboard. `read` gives the text of one cell.
 */
export function copyRect (rect: CellRect, read: (row: number, col: number) => string): string[][] {
  const rows: string[][] = []
  for (let row = rect.top; row <= rect.bottom; row++) {
    const cells: string[] = []
    for (let col = rect.left; col <= rect.right; col++) cells.push(read(row, col))
    rows.push(cells)
  }
  return rows
}
