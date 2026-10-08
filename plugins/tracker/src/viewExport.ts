//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// "Export view data" (GitHub Projects): the rows of a view as a tab separated file. Pure helpers, kept free of the
// platform and the UI so that they can be unit tested.

/** Largest number of rows an export holds: the most items a project can have. @public */
export const MAX_EXPORT_ROWS = 50000

/**
 * A value of an exported cell. Lists are joined with `, `, `Date` is written as an ISO 8601 timestamp, `null` and
 * `undefined` are empty. A number stays a plain number (it is never taken for a formula, even a negative one).
 * @public
 */
export type TsvValue = string | number | boolean | Date | null | undefined | readonly TsvValue[]

/** A column of the exported table. @public */
export interface TsvColumn {
  header: string
}

/** @public */
export interface TsvOptions {
  /**
   * Prefix text cells that a spreadsheet would read as a formula (they start with `=`, `+`, `-` or `@`) with a single
   * quote. On by default. GitHub does not do this; it is a safe default for files that end up in Excel or Sheets.
   */
  escapeFormulas?: boolean
}

const FORMULA_START = /^[=+\-@]/
// A tab or a line break would move the text to another cell or row
const SEPARATORS = /[\t\r\n\u2028\u2029]+/g

function textOf (value: TsvValue): { text: string, numeric: boolean } {
  if (value === null || value === undefined) return { text: '', numeric: false }
  if (typeof value === 'number') return { text: Number.isFinite(value) ? String(value) : '', numeric: true }
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false', numeric: false }
  if (value instanceof Date) return { text: Number.isNaN(value.getTime()) ? '' : value.toISOString(), numeric: false }
  if (typeof value === 'string') return { text: value, numeric: false }
  const parts: string[] = []
  for (const item of value) {
    const part = textOf(item).text.replace(SEPARATORS, ' ').trim()
    if (part !== '') parts.push(part)
  }
  return { text: parts.join(', '), numeric: false }
}

/**
 * The text of one cell: separators replaced by a space, lists joined, formulas neutralised.
 * @public
 */
export function formatTsvCell (value: TsvValue, escapeFormulas: boolean = true): string {
  const { text, numeric } = textOf(value)
  const clean = text.replace(SEPARATORS, ' ')
  return escapeFormulas && !numeric && FORMULA_START.test(clean) ? `'${clean}` : clean
}

/**
 * Builds the file: a header row of the column names, then one line per row, cells separated by a tab. A tab or a line
 * break inside a value is replaced by a space, so every row is exactly one line. A row with fewer cells than there are
 * columns is padded with empty cells, extra cells are ignored. The text ends with a line break.
 * @public
 */
export function buildViewTsv (
  columns: readonly TsvColumn[],
  rows: ReadonlyArray<readonly TsvValue[]>,
  options: TsvOptions = {}
): string {
  const escape = options.escapeFormulas !== false
  const width = columns.length
  const lines: string[] = new Array(rows.length + 1)
  lines[0] = columns.map((c) => formatTsvCell(c.header, escape)).join('\t')
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const cells: string[] = new Array(width)
    for (let c = 0; c < width; c++) cells[c] = formatTsvCell(row[c], escape)
    lines[r + 1] = cells.join('\t')
  }
  return lines.join('\n') + '\n'
}

/**
 * Name of the downloaded file: the project and the view, without characters that file systems refuse.
 * @public
 */
export function viewExportFileName (project: string, view: string): string {
  const clean = (text: string): string =>
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const parts = [clean(project), clean(view)].filter((it) => it !== '')
  return `${parts.length > 0 ? parts.join(' - ') : 'view'}.tsv`
}

/**
 * A group of a list as the list builds it: a plain value (`undefined` for "no value"), or a category that stands for
 * several values (the same status of several projects) and lists the documents that are its values.
 * @public
 */
export type GroupCategory = undefined | null | string | number | { name?: unknown, values: ReadonlyArray<{ _id: unknown }> }

/**
 * One level of grouping: the groups in the order the list shows them and how to read the group value of a row.
 * @public
 */
export interface GroupLevel<T> {
  categories: readonly GroupCategory[]
  valueOf: (row: T) => unknown
}

function isEmpty (value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function inCategory (category: GroupCategory, value: unknown): boolean {
  const candidates = Array.isArray(value) ? value : [value]
  if (category !== null && typeof category === 'object') {
    return candidates.some((v) => category.values.some((it) => it._id === v))
  }
  if (category === undefined || category === null) return candidates.every(isEmpty)
  return candidates.some((v) => v === category)
}

/**
 * Puts rows in the order a grouped list shows them: group after group (the first level in the order of its
 * categories, inside it the next level), and inside the last group the order the rows come in. Every row appears
 * once, in the first group it fits; rows that fit none go to the end. Without levels the rows are returned as they are.
 * @public
 */
export function orderRowsByGroups<T> (rows: readonly T[], levels: ReadonlyArray<GroupLevel<T>>): T[] {
  if (levels.length === 0) return [...rows]
  const [level, ...rest] = levels
  const buckets: T[][] = level.categories.map(() => [])
  const unplaced: T[] = []
  for (const row of rows) {
    const value = level.valueOf(row)
    const index = level.categories.findIndex((c) => inCategory(c, value))
    if (index === -1) unplaced.push(row)
    else buckets[index].push(row)
  }
  // Appended one by one: spreading a big array into `push` would overflow the call stack
  const result: T[] = []
  for (const bucket of [...buckets, unplaced]) {
    for (const row of orderRowsByGroups(bucket, rest)) result.push(row)
  }
  return result
}
