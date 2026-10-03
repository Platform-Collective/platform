//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Issue } from '@hcengineering/tracker'
import type { TsvValue } from '@hcengineering/tracker'
import type { BuildModelKey } from '@hcengineering/view'

/** A column of the exported file: its header and how to read a cell from an issue. */
export interface ExportColumn {
  id: string
  header: string
  value: (issue: Issue) => TsvValue
}

/** What the columns need from the view that is exported. */
export interface ExportEnv {
  // How a cell of the table is written as text (the same text as copying it), by column key; custom fields are `cf_<key>`
  cell: (key: string) => { format: (issue: Issue) => string } | undefined
  // Header text of a column of the view
  label: (id: string, entry: BuildModelKey | string) => string
  taskTypeName: (kind: string) => string
  issueUrl: (issue: Issue) => string
  // What the identifier column of a draft item says
  draftLabel: string
  // Headers of the columns that every export starts with
  headers: { title: string, identifier: string, url: string }
}

/**
 * The id of a column of the view config: the `key` of its display properties, or the attribute it shows. Entries that
 * are no column (spacers, the extension area) have none.
 */
export function exportColumnId (entry: BuildModelKey | string): string | undefined {
  const id = typeof entry === 'string' ? entry : (entry.displayProps?.key ?? entry.key)
  return id === '' ? undefined : id
}

const CELL_COLUMNS = new Set(['priority', 'status', 'assignee', 'component', 'milestone', 'dueDate', 'estimation', 'labels'])

// Columns that the file always starts with, so that they are not written twice
const FIXED_IDS = new Set(['title', 'issue', 'number'])

const iso = (time: number | null | undefined): string =>
  time === null || time === undefined || !Number.isFinite(time) ? '' : new Date(time).toISOString()

function customFieldId (id: string): boolean {
  return id.startsWith('cf_')
}

function columnFor (id: string, header: string, env: ExportEnv): ExportColumn | undefined {
  if (CELL_COLUMNS.has(id) || customFieldId(id)) {
    const cell = env.cell(id)
    if (cell === undefined) return undefined
    // Numbers stay numbers in the file, so that a spreadsheet can sum them
    if (id === 'estimation') return { id, header, value: (issue) => (issue.estimation > 0 ? issue.estimation : '') }
    return { id, header, value: (issue) => cell.format(issue) }
  }
  switch (id) {
    case 'kind':
      return { id, header, value: (issue) => env.taskTypeName(issue.kind) }
    case 'comments':
      return { id, header, value: (issue) => issue.comments }
    case 'attachments':
      return { id, header, value: (issue) => (issue as Issue & { attachments?: number }).attachments ?? 0 }
    case 'attachedTo':
    case 'parent':
      return { id, header, value: (issue) => issue.parents?.[0]?.identifier ?? '' }
    case 'modified':
    case 'modifiedOn':
      return { id, header, value: (issue) => iso(issue.modifiedOn) }
    case 'createdOn':
      return { id, header, value: (issue) => iso(issue.createdOn) }
    default:
      return undefined
  }
}

/**
 * The columns of an export (GitHub "Export view data"): Title, Identifier and URL first, then the visible fields of the
 * view in the order of the view. Columns that have nothing to write (the sub-issue counter, the extension area, a custom
 * field that no longer exists) are left out; a column that is listed twice is written once.
 */
export function buildExportColumns (config: ReadonlyArray<BuildModelKey | string>, env: ExportEnv): ExportColumn[] {
  const columns: ExportColumn[] = [
    { id: 'title', header: env.headers.title, value: (issue) => issue.title },
    {
      id: 'identifier',
      header: env.headers.identifier,
      value: (issue) => (issue.isDraft === true ? env.draftLabel : issue.identifier)
    },
    { id: 'url', header: env.headers.url, value: (issue) => env.issueUrl(issue) }
  ]
  const seen = new Set<string>()
  for (const entry of config) {
    const id = exportColumnId(entry)
    if (id === undefined || FIXED_IDS.has(id) || seen.has(id)) continue
    const column = columnFor(id, env.label(id, entry), env)
    if (column === undefined) continue
    seen.add(id)
    columns.push(column)
  }
  return columns
}
