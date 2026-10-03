//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { CategoryType, Doc, SortingOrder } from '@hcengineering/core'
import type { AnySvelteComponent } from '@hcengineering/ui'
import type { BuildModelKey, ViewOptions } from '@hcengineering/view'
import { get, writable } from 'svelte/store'

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
  // Ordered categories (group values) for the documents
  getCategories: (key: string, docs: Doc[], viewOptions: ViewOptions) => CategoryType[]
  // Presenter of a group header, receives the category as `value`
  getGroupHeader: (key: string) => AnySvelteComponent | undefined
  // Label of the group of documents without a value
  emptyGroupLabel: (key: string) => string | undefined
  // Client-side comparator, undefined when there is nothing to sort by
  compare: (key: string, order: SortingOrder) => ((a: Doc, b: Doc) => number) | undefined
  // Upper bound of documents to load per group when sorting on the client
  scanLimit: number
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
