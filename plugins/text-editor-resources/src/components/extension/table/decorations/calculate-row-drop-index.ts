// SPDX-License-Identifier: EPL-2.0

export interface TableRow {
  topPx: number
  heightPx: number
}

/** Calculate the destination row index after removing the dragged row. */
export function calculateRowDropIndex (row: number, rows: TableRow[], top: number): number {
  const rowCenterPx = top + rows[row].heightPx / 2
  const index = rows.findIndex((p) => rowCenterPx < p.topPx + p.heightPx / 2)
  return index !== -1 ? (index > row ? index - 1 : index) : rows.length - 1
}
