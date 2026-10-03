//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { CategoryType, Doc, SortingOrder } from '@hcengineering/core'
import type { AnySvelteComponent } from '@hcengineering/ui'
import type { BuildModelKey, ViewOptions } from '@hcengineering/view'
import { get, writable, type Readable } from 'svelte/store'

/**
 * Option offered in the Group-by / Order-by dropdowns.
 * @public
 */
export interface ClientViewKey {
  id: string
  // Plain (already translated) label
  label: string
}

/**
 * Optional list column offered in "Configure columns".
 * @public
 */
export interface ClientViewColumn {
  key: BuildModelKey
  // Plain (already translated) label
  label: string
}

/**
 * Tree display of a list: the documents are shown nested under their parents. A list takes part only when
 * `isEnabled` accepts its view options, so lists of other views are never affected.
 * @public
 */
export interface ClientHierarchy {
  // Whether the view options ask for the tree
  isEnabled: (viewOptions: ViewOptions) => boolean
  // Id of the parent of a document; undefined for a document without a parent
  parentOf: (doc: Doc) => string | undefined
  // Levels of nesting, 8 by default
  maxDepth?: number
  // Ids of the documents whose children are shown
  expanded: Readable<ReadonlySet<string>>
  toggle: (id: string) => void
  // Tooltip of the expander of a parent row, e.g. the progress of its children
  describe?: Readable<(doc: Doc) => string | undefined>
}

/**
 * Summary that is shown at the end of every group header, e.g. the sums of number fields of the group.
 * It is shown only when `isEnabled` accepts the view options of the list.
 * @public
 */
export interface ClientGroupSummary {
  isEnabled: (viewOptions: ViewOptions) => boolean
  // Document properties the summary reads, they are loaded together with the group-by keys
  projection: (viewOptions: ViewOptions) => string[]
  // Receives `docs` (the documents of the group), `viewOptions`, `value` (the category), `groupKey` and `space`
  component: AnySvelteComponent
}

/**
 * Lets a host plugin provide group-by / order-by keys and columns that are not model attributes
 * (e.g. user-defined fields stored in an untyped record). Grouping and ordering by such keys is
 * performed on the client over the loaded documents.
 * @public
 */
export interface ClientViewExtension {
  // True when the key (used in viewOptions.groupBy / orderBy) is owned by the extension
  handlesKey: (key: string) => boolean
  groupByKeys: () => ClientViewKey[]
  orderByKeys: () => ClientViewKey[]
  columns: () => ClientViewColumn[]
  // Top-level document property that has to be loaded to evaluate the key
  projectionKey: (key: string) => string
  // Further properties of the documents that the group header needs (see `getGroupExtras`)
  extraProjection?: (key: string) => string[]
  // Ordered categories (group values) for the documents
  getCategories: (key: string, docs: Doc[], viewOptions: ViewOptions) => CategoryType[]
  // Presenter of a group header, receives the category as `value`
  getGroupHeader: (key: string) => AnySvelteComponent | undefined
  // Component shown at the end of a group header, e.g. totals and a menu of the group. It receives the
  // category as `value`, the documents of the group as `docs` and the `space` of the list
  getGroupExtras?: (key: string) => AnySvelteComponent | undefined
  // Label of the group of documents without a value
  emptyGroupLabel: (key: string) => string | undefined
  // Client-side comparator, undefined when there is nothing to sort by
  compare: (key: string, order: SortingOrder) => ((a: Doc, b: Doc) => number) | undefined
  // Upper bound of documents to load per group when sorting on the client
  scanLimit: number
  // Nests documents under their parents, for lists that turn it on in their view options
  hierarchy?: ClientHierarchy
  // Totals shown in the group headers, for lists that turn it on in their view options
  groupSummary?: ClientGroupSummary
}

/**
 * Extension of the currently displayed view, if any.
 * @public
 */
export const clientViewExtension = writable<ClientViewExtension | undefined>(undefined)

/**
 * @public
 */
export function getClientViewExtension (): ClientViewExtension | undefined {
  return get(clientViewExtension)
}

/**
 * Whether the key is handled by the active extension.
 * @public
 */
export function isClientViewKey (ext: ClientViewExtension | undefined, key: string | undefined): boolean {
  return ext !== undefined && key !== undefined && ext.handlesKey(key)
}
