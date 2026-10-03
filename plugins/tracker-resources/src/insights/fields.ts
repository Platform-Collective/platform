//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { filterGrammar } from '@hcengineering/view-resources'
import { BUILTIN_SLICE_FIELDS, listsEmptyValues, sliceFieldId } from '../slice/fields'

type FieldSpec = filterGrammar.FieldSpec

/**
 * What a field can be in a chart: the buckets of an axis or the series (`category`: one of its options), the dates
 * of a continuous X-axis (`date`), or the numbers the Y-axis adds up (`number`). Text fields have no use in a chart.
 */
export type ChartFieldKind = 'category' | 'date' | 'number'

export interface ChartOption {
  id: string
  label: string
}

/** A field of the project a chart can use. */
export interface ChartField {
  // Id the chart stores the field by, see `chartFieldId`
  id: string
  // Already translated
  label: string
  kind: ChartFieldKind
  // The filter field it comes from: how its value is read and what the filter string calls it
  spec: FieldSpec
  // Options of a category field in the order of the axis
  options: ChartOption[]
  // List the options that no item has (with 0): the fields that belong to the project do, the others list what is used
  includeEmpty: boolean
}

export interface ChartFields {
  // The fields that can be the X-axis: category fields first, then date fields
  axis: ChartField[]
  // The fields that can make the series
  groups: ChartField[]
  // The fields the Y-axis can add up
  numbers: ChartField[]
  byId: ReadonlyMap<string, ChartField>
}

export interface ChartFieldsInput {
  // The filter schema of the project, see `buildIssueFilterSchema`
  schema: readonly FieldSpec[]
  // Translated labels of the built-in fields by filter name; the label of the schema is used for the others
  labels?: ReadonlyMap<string, string>
  // Status ids in the order of the workflow; the other statuses follow
  statusOrder?: readonly string[]
}

/** The id a chart stores a field by: the filter name of a built-in field, `customFields.<key>` for a custom one. */
export const chartFieldId = sliceFieldId

/** Built-in fields whose options are sorted by their label, because their order has no meaning. */
const SORTED_BY_LABEL = new Set(['assignee', 'label', 'component', 'milestone'])

function kindOf (spec: FieldSpec): ChartFieldKind | undefined {
  // The time of the last change is a filter (`updated:`), not something a chart is drawn over
  if (spec.source === 'attribute' && spec.name === 'updated') return undefined
  if (spec.type === 'date') return 'date'
  if (spec.type === 'number') return 'number'
  if (spec.source === 'custom') {
    return spec.type === 'select' || spec.type === 'multi' || spec.type === 'iteration' ? 'category' : undefined
  }
  return BUILTIN_SLICE_FIELDS.includes(spec.name) ? 'category' : undefined
}

function orderedOptions (spec: FieldSpec, statusOrder: readonly string[] | undefined): ChartOption[] {
  const seen = new Set<string>()
  let options: ChartOption[] = []
  for (const o of spec.options ?? []) {
    const id = String(o.id)
    if (seen.has(id)) continue
    seen.add(id)
    options.push({ id, label: o.name })
  }
  if (spec.source === 'attribute' && SORTED_BY_LABEL.has(spec.name)) {
    options = options.sort((a, b) => a.label.localeCompare(b.label))
  } else if (spec.source === 'attribute' && spec.name === 'status' && statusOrder !== undefined) {
    const position = new Map(statusOrder.map((id, i) => [String(id), i]))
    const rank = (o: ChartOption): number => position.get(o.id) ?? Number.MAX_SAFE_INTEGER
    options = options.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((it) => it.o)
  }
  return options
}

/**
 * The fields a chart can use, from the filter schema of the project: the same built-in fields as the slice panel and
 * the single select, multi select and iteration fields as buckets and series, the date fields (due date, start date,
 * deadline and the Date fields) for a date X-axis, the estimation and the Number fields for the Y-axis.
 */
export function buildChartFields (input: ChartFieldsInput): ChartFields {
  const categories: ChartField[] = []
  const dates: ChartField[] = []
  const numbers: ChartField[] = []
  for (const spec of input.schema) {
    const kind = kindOf(spec)
    if (kind === undefined) continue
    const field: ChartField = {
      id: chartFieldId(spec),
      label: spec.source === 'custom' ? spec.label : (input.labels?.get(spec.name) ?? spec.label),
      kind,
      spec,
      options: kind === 'category' ? orderedOptions(spec, input.statusOrder) : [],
      includeEmpty: listsEmptyValues(spec)
    }
    if (kind === 'category') categories.push(field)
    else if (kind === 'date') dates.push(field)
    else numbers.push(field)
  }
  // Built-in fields keep the order of the slice panel, the custom ones follow in the order of the project
  const rank = (f: ChartField): number => {
    const i = f.spec.source === 'attribute' ? BUILTIN_SLICE_FIELDS.indexOf(f.spec.name) : -1
    return i === -1 ? BUILTIN_SLICE_FIELDS.length : i
  }
  const sortedCategories = categories.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((it) => it.f)
  const byId = new Map<string, ChartField>()
  for (const f of [...sortedCategories, ...dates, ...numbers]) if (!byId.has(f.id)) byId.set(f.id, f)
  return { axis: [...sortedCategories, ...dates], groups: sortedCategories, numbers, byId }
}

/** Document properties a chart reads, to project the scan with. */
export function chartProjection (fields: ReadonlyArray<ChartField | undefined>): string[] {
  const res = new Set<string>(['_id'])
  for (const field of fields) {
    if (field === undefined) continue
    res.add(field.spec.source === 'custom' ? 'customFields' : field.spec.key)
    for (const dependency of field.spec.dependsOn ?? []) res.add(dependency)
  }
  return [...res]
}
