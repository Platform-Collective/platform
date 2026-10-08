//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Tab separated clipboard text, as produced and understood by spreadsheets: cells are separated by a tab,
// rows by a line break, and a cell holding a tab, a line break or a quote is wrapped in quotes with inner quotes doubled.

function encodeCell (cell: string): string {
  return /[\t\r\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/**
 * Encode a block of cells to clipboard text.
 * @public
 */
export function encodeTsv (rows: ReadonlyArray<readonly string[]>): string {
  return rows.map((row) => row.map(encodeCell).join('\t')).join('\n')
}

/**
 * Decode clipboard text to a block of cells. A single trailing line break (added by spreadsheets
 * when copying) does not make an extra row. Empty text gives no rows.
 * @public
 */
export function decodeTsv (text: string): string[][] {
  if (text === '') return []
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let cellStart = true

  const endCell = (): void => {
    row.push(cell)
    cell = ''
    cellStart = true
  }
  const endRow = (): void => {
    endCell()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && cellStart) {
      quoted = true
      cellStart = false
    } else if (ch === '\t') {
      endCell()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else {
      cell += ch
      cellStart = false
    }
  }
  // The last row has no line break after it, unless the text ended with one
  if (cell !== '' || row.length > 0 || quoted) endRow()
  return rows
}
