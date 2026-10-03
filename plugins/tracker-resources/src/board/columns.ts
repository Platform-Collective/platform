//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Iteration, ProjectField } from '@hcengineering/tracker'
import { buildIterationGroupCategories, ProjectFieldType } from '@hcengineering/tracker'
import { buildGroupCategories, parseCustomFieldViewKey } from '../projectFields/query'

/**
 * Pure logic of the board columns and swimlanes that come from a custom field (a single-select or an Iteration
 * field). The values live in the untyped `Issue.customFields` record, so the grouping runs on the client over the
 * issues of the board. Columns and swimlanes that come from a built-in attribute use the generic view machinery.
 *
 * A "category" is what a column or a swimlane stands for: an option id or an iteration id of the field, or
 * `undefined` for the issues without a value ("No <field>").
 */

type WithCustomFields = { customFields?: Record<string, unknown> }

// Documents are typed by what the caller has; the custom fields are read from them when they are there
const customFieldsOf = (item: object): Record<string, unknown> | undefined => (item as WithCustomFields).customFields

/** Key under which a category is stored in the buckets of the items; the one `groupBy` of the view plugin uses. */
export function categoryKey (category: unknown): string {
  if (category !== null && typeof category === 'object') {
    const name = (category as { name?: unknown }).name
    return String(name)
  }
  return String(category)
}

/** Whether the view key addresses a custom field. */
export function isCustomDimensionKey (key: string): boolean {
  return parseCustomFieldViewKey(key) !== undefined
}

/** The custom field a view key addresses, if it exists in the project. */
export function fieldOfKey<F extends Pick<ProjectField, 'key'>> (
  key: string,
  byKey: ReadonlyMap<string, F>
): F | undefined {
  const fieldKey = parseCustomFieldViewKey(key)
  return fieldKey === undefined ? undefined : byKey.get(fieldKey)
}

/** Value of the field of an item as a category: an id, or `undefined` when the item has no value. */
export function categoryOfItem (item: object, fieldKey: string): string | undefined {
  const value = customFieldsOf(item)?.[fieldKey]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Groups the items by the value of a custom field. The keys of the result are `categoryKey` of the categories,
 * the order of the items is kept.
 */
export function groupByCustomField<T extends object> (
  items: readonly T[],
  fieldKey: string
): Record<string, T[]> {
  const res: Record<string, T[]> = {}
  for (const item of items) {
    const key = categoryKey(categoryOfItem(item, fieldKey))
    ;(res[key] ??= []).push(item)
  }
  return res
}

/**
 * Columns of a board whose column field is a single-select or an Iteration field, left to right: "No <field>",
 * then every option (or iteration, in calendar order) even when it has no items, then values found on items that
 * are no option any more.
 */
export function buildColumnCategories (
  field: Pick<ProjectField, 'key' | 'type' | 'options'>,
  iterations: ReadonlyArray<Pick<Iteration, '_id' | 'startDate' | 'number' | 'isBreak'>>,
  items: readonly object[]
): Array<string | undefined> {
  // With `includeEmpty` the builders list every option, and "No <field>" as the last one
  const docs = items as readonly WithCustomFields[]
  const all =
    field.type === ProjectFieldType.Iteration
      ? buildIterationGroupCategories(iterations, docs, field.key, true)
      : buildGroupCategories(field, docs, true)
  return [undefined, ...all.filter((c) => c !== undefined)]
}

/**
 * Swimlanes of a board whose "Group by" is a single-select or an Iteration field: the options (or iterations) that
 * have items, in their order, then values that are no option any more, and "No <field>" last. All of them are
 * listed with `includeEmpty`.
 */
export function buildLaneCategories (
  field: Pick<ProjectField, 'key' | 'type' | 'options'>,
  iterations: ReadonlyArray<Pick<Iteration, '_id' | 'startDate' | 'number' | 'isBreak'>>,
  items: readonly object[],
  includeEmpty: boolean
): Array<string | undefined> {
  const docs = items as readonly WithCustomFields[]
  return field.type === ProjectFieldType.Iteration
    ? buildIterationGroupCategories(iterations, docs, field.key, includeEmpty)
    : buildGroupCategories(field, docs, includeEmpty)
}

/** A category that is not hidden. */
export function isVisibleCategory (category: unknown, hidden: readonly string[]): boolean {
  return !hidden.includes(categoryKey(category))
}

/** Splits the columns into the visible ones and the hidden ones, keeping their order. */
export function partitionColumns<C> (
  columns: readonly C[],
  hidden: readonly string[]
): { visible: C[], hidden: C[] } {
  const visible: C[] = []
  const hiddenColumns: C[] = []
  for (const column of columns) {
    if (isVisibleCategory(column, hidden)) visible.push(column)
    else hiddenColumns.push(column)
  }
  return { visible, hidden: hiddenColumns }
}
