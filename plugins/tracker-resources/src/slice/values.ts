//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { filterGrammar } from '@hcengineering/view-resources'
import { SLICE_NONE, type SliceConfig } from './config'

type FieldSpec = filterGrammar.FieldSpec

/** One value of a slice panel. */
export interface SliceValue {
  // The id the option is stored by, as text
  id: string
  label: string
  // Items with this value; an item with several values (labels) is counted for each
  count: number
}

export interface SliceValues {
  values: SliceValue[]
  // Items without a value in the field
  none: number
  // All the items counted ("All")
  total: number
}

export interface CollectOptions {
  // List the values that no item has (with a count of 0)
  includeEmpty?: boolean
  // Ids in the order they are shown (e.g. statuses in the order of the workflow); values that are not listed follow
  order?: ReadonlyArray<string | number>
  // Sort by label instead of by the order of the options (people, labels, ...)
  sortByLabel?: boolean
  // Ids that are listed even when no item has them, e.g. the chosen ones, so that a choice can always be seen and undone
  keep?: readonly string[]
}

function valuesOf (spec: FieldSpec, doc: unknown): string[] {
  const raw = filterGrammar.readFieldValue(spec, doc)
  if (Array.isArray(raw)) return raw.filter((v) => v !== null && v !== undefined && v !== '').map(String)
  if (filterGrammar.isEmptyValue(raw)) return []
  return [String(raw)]
}

/**
 * The values of an item in a field: the ids of its options that exist, each once. An item without a value (or only
 * with a value that is not an option any more) has none.
 */
export function sliceValueIds (spec: FieldSpec, doc: unknown, known: ReadonlySet<string> = optionIdSet(spec)): string[] {
  return [...new Set(valuesOf(spec, doc).filter((id) => known.has(id)))]
}

/** The ids of the options of the field, as text. */
export function optionIdSet (spec: Pick<FieldSpec, 'options'>): Set<string> {
  return new Set((spec.options ?? []).map((o) => String(o.id)))
}

/**
 * The values of a field with the number of items that have each of them. A value that is not an option of the field
 * (a deleted iteration, a status that was removed) counts as no value. The items are the ones the view shows without
 * the slice itself, so the counts tell what choosing a value will leave.
 */
export function collectSliceValues (spec: FieldSpec, docs: readonly unknown[], options: CollectOptions = {}): SliceValues {
  const known = optionIdSet(spec)
  const counts = new Map<string, number>()
  let none = 0
  for (const doc of docs) {
    const ids = sliceValueIds(spec, doc, known)
    if (ids.length === 0) {
      none++
      continue
    }
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const keep = new Set(options.keep ?? [])
  let values: SliceValue[] = []
  for (const option of spec.options ?? []) {
    const id = String(option.id)
    const count = counts.get(id) ?? 0
    if (count === 0 && options.includeEmpty !== true && !keep.has(id)) continue
    // The same id can only be listed once, even if the schema repeats it
    if (values.some((v) => v.id === id)) continue
    values.push({ id, label: option.name, count })
  }

  if (options.order !== undefined) {
    const position = new Map(options.order.map((id, i) => [String(id), i]))
    const rank = (v: SliceValue): number => position.get(v.id) ?? Number.MAX_SAFE_INTEGER
    values = values
      .map((v, i) => ({ v, i }))
      .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
      .map((it) => it.v)
  } else if (options.sortByLabel === true) {
    values.sort((a, b) => a.label.localeCompare(b.label))
  }
  return { values, none, total: docs.length }
}

/**
 * Whether an item is in the slice: its value is one of the chosen ones (`SLICE_NONE` chooses the items without a
 * value). Nothing chosen ("All") lets every item through.
 */
export function createSlicePredicate (spec: FieldSpec, config: SliceConfig | undefined): (doc: unknown) => boolean {
  if (config === undefined || config.value.length === 0) return () => true
  const chosen = new Set(config.value.filter((id) => id !== SLICE_NONE))
  const wantsNone = config.value.includes(SLICE_NONE)
  const known = optionIdSet(spec)
  return (doc) => {
    const own = sliceValueIds(spec, doc, known)
    if (own.length === 0) return wantsNone
    return own.some((id) => chosen.has(id))
  }
}
