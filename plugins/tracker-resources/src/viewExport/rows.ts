//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  getObjectValue,
  SortingOrder,
  type CategoryType,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindOptions,
  type Ref,
  type TxOperations
} from '@hcengineering/core'
import { MAX_EXPORT_ROWS, orderRowsByGroups, type GroupCategory, type GroupLevel, type Issue } from '@hcengineering/tracker'

/** What decides which rows an export has and in which order. */
export interface ExportRowsParams {
  // What the view shows: the query of the view (filter, search, slice) merged with the query its view options add
  query: DocumentQuery<Issue>
  // Find options of the view options (without sort and limit)
  options?: FindOptions<Issue>
  // Sort of the view, as the view options have it: the key and the direction
  orderBy?: [string, SortingOrder]
  // Group keys of the view, outermost first; keys that mean "no grouping" are left out by the caller
  groupBy: readonly string[]
  // Whether a key is evaluated on the client (a custom field), with its comparator and the groups it has
  client?: {
    handlesKey: (key: string) => boolean
    compare: (key: string, order: SortingOrder) => ((a: Doc, b: Doc) => number) | undefined
    getCategories: (key: string, docs: Doc[]) => CategoryType[]
  }
  // The groups of a built-in key, as the list makes them
  getCategories: (docs: Doc[], key: string) => Promise<CategoryType[]>
}

export interface ExportRows {
  rows: Issue[]
  // The view holds more rows than an export can have, the rest is cut off
  truncated: boolean
}

function withoutLookupQuery (query: DocumentQuery<Issue>): DocumentQuery<Issue> {
  const res: DocumentQuery<Issue> = {}
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('$lookup.')) (res as Record<string, unknown>)[key] = value
  }
  return res
}

/**
 * Loads the rows of a view for an export, in the order the list shows them: the sort of the view, then group after
 * group. The rows are flat, a view that nests sub-issues under their parents exports every issue on its own row.
 */
export async function loadExportRows (
  client: Pick<TxOperations, 'findAll'>,
  _class: Ref<Class<Issue>>,
  params: ExportRowsParams
): Promise<ExportRows> {
  const { client: ext, orderBy } = params
  const clientSorted = orderBy !== undefined && ext?.handlesKey(orderBy[0]) === true
  // Lookups, projections and a limit of the view would only make the rows differ from what is exported
  const options: FindOptions<Issue> = { ...(params.options ?? {}) }
  delete options.lookup
  delete options.sort
  delete options.limit
  delete options.projection
  const found = await client.findAll(_class, withoutLookupQuery(params.query), {
    ...options,
    ...(orderBy !== undefined && !clientSorted ? { sort: { [orderBy[0]]: orderBy[1] } } : {}),
    limit: MAX_EXPORT_ROWS + 1
  })
  const truncated = found.length > MAX_EXPORT_ROWS
  let rows: Issue[] = truncated ? found.slice(0, MAX_EXPORT_ROWS) : [...found]

  if (clientSorted && orderBy !== undefined) {
    const compare = ext?.compare(orderBy[0], orderBy[1])
    if (compare !== undefined) rows = [...rows].sort((a, b) => compare(a, b))
  }

  const levels: Array<GroupLevel<Issue>> = []
  for (const key of params.groupBy) {
    const categories =
      ext?.handlesKey(key) === true ? ext.getCategories(key, rows) : await params.getCategories(rows, key)
    levels.push({
      categories: categories as GroupCategory[],
      valueOf: (row) => getObjectValue(key, row)
    })
  }
  return { rows: orderRowsByGroups(rows, levels), truncated }
}
