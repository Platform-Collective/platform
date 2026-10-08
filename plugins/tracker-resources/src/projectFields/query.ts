//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Iteration, ProjectField } from '@hcengineering/tracker'
import { getFieldValue, ProjectFieldType, resolveRelativeIteration } from '@hcengineering/tracker'

/**
 * Pure helpers for filtering, sorting and grouping issues by custom field values.
 * Values live in an untyped `Issue.customFields` record (plan D1), so all of this runs on
 * the client over a bounded set of issues, see `DEFAULT_CUSTOM_FIELD_SCAN_LIMIT`.
 */

/** Prefix of the view-option keys (groupBy / orderBy) that address a custom field. */
export const CUSTOM_FIELD_KEY_PREFIX = 'customFields.'

/** Default value of the `TRACKER_CUSTOM_FIELD_SCAN_LIMIT` setting. */
export const DEFAULT_CUSTOM_FIELD_SCAN_LIMIT = 5000

/**
 * Normalize a configured scan limit. Anything that is not a positive integer falls back to the default.
 */
export function resolveScanLimit (raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : DEFAULT_CUSTOM_FIELD_SCAN_LIMIT
}

/**
 * Custom-field filter/sort/group works on a scanned window of `limit` issues. When the scan returned
 * more than that, the features must be disabled instead of silently working on a truncated set.
 * `scanned` is the size of a scan that was capped at `limit + 1`.
 */
export function exceedsScanLimit (scanned: number, limit: number): boolean {
  return scanned > limit
}

export function toCustomFieldViewKey (fieldKey: string): string {
  return `${CUSTOM_FIELD_KEY_PREFIX}${fieldKey}`
}

/**
 * Field key addressed by a view-option key, or undefined for regular attributes.
 */
export function parseCustomFieldViewKey (key: string): string | undefined {
  return key.startsWith(CUSTOM_FIELD_KEY_PREFIX) && key.length > CUSTOM_FIELD_KEY_PREFIX.length
    ? key.slice(CUSTOM_FIELD_KEY_PREFIX.length)
    : undefined
}

/** @public */
export type FieldFilterOperator =
  | 'contains'
  | 'eq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'anyOf'
  | 'isEmpty'
  | 'isNotEmpty'

export interface FieldRange {
  from?: number
  to?: number
}

/**
 * What an Iteration field needs to be filtered or sorted: its iterations (by field key) and what `now` is.
 */
export interface IterationContext {
  iterations: (fieldKey: string) => ReadonlyArray<Pick<Iteration, '_id' | 'startDate' | 'duration' | 'number' | 'isBreak'>>
  now: number
}

// An iteration is picked by id or relative to today: `@current`, `@next`, `@previous`, optionally `+N` / `-N`
const ITERATION_TOKEN = /^@(current|next|previous)(?:([+-])(\d+))?$/

/**
 * Keywords offered next to the iterations of a field in a filter.
 */
export const ITERATION_KEYWORDS = ['@current', '@next', '@previous'] as const

export type FieldFilterValue = string | number | string[] | FieldRange | undefined

/**
 * One rule of the custom-field filter. Rules are combined with AND.
 */
export interface CustomFieldFilter {
  id: string
  fieldKey: string
  operator: FieldFilterOperator
  value?: FieldFilterValue
}

const EMPTY_OPERATORS: FieldFilterOperator[] = ['isEmpty', 'isNotEmpty']

/**
 * Operators offered for a field type. The first one is the default.
 */
export function operatorsFor (type: ProjectFieldType): FieldFilterOperator[] {
  switch (type) {
    case ProjectFieldType.Text:
      return ['contains', ...EMPTY_OPERATORS]
    case ProjectFieldType.Number:
      return ['eq', 'gt', 'gte', 'lt', 'lte', 'between', ...EMPTY_OPERATORS]
    case ProjectFieldType.Date:
      return ['before', 'after', 'between', ...EMPTY_OPERATORS]
    case ProjectFieldType.SingleSelect:
    case ProjectFieldType.MultiSelect:
    case ProjectFieldType.Iteration:
      return ['anyOf', ...EMPTY_OPERATORS]
    default:
      return []
  }
}

/** Field types that can be filtered on. */
export function isFilterableType (type: ProjectFieldType): boolean {
  return operatorsFor(type).length > 0
}

/** Field types that can be sorted on. Multi-select has no meaningful order (GitHub parity). */
export function isSortableType (type: ProjectFieldType): boolean {
  return (
    type === ProjectFieldType.Text ||
    type === ProjectFieldType.Number ||
    type === ProjectFieldType.Date ||
    type === ProjectFieldType.SingleSelect ||
    type === ProjectFieldType.Iteration
  )
}

/** Only single-select and iteration fields can be grouped by (GitHub parity). */
export function isGroupableType (type: ProjectFieldType): boolean {
  return type === ProjectFieldType.SingleSelect || type === ProjectFieldType.Iteration
}

function isRange (value: FieldFilterValue): value is FieldRange {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A rule without a usable value is a draft the user is still editing; it must not affect the result.
 */
export function isFilterComplete (filter: Pick<CustomFieldFilter, 'operator' | 'value'>): boolean {
  if (EMPTY_OPERATORS.includes(filter.operator)) return true
  const { value } = filter
  switch (filter.operator) {
    case 'contains':
      return typeof value === 'string' && value.trim() !== ''
    case 'eq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'before':
    case 'after':
      return typeof value === 'number' && Number.isFinite(value)
    case 'between':
      return isRange(value) && (typeof value.from === 'number' || typeof value.to === 'number')
    case 'anyOf':
      return Array.isArray(value) && value.length > 0
    default:
      return false
  }
}

/** Start of the local calendar day containing the timestamp. */
export function startOfDay (ts: number): number {
  return new Date(ts).setHours(0, 0, 0, 0)
}

/** Last millisecond of the local calendar day containing the timestamp. */
export function endOfDay (ts: number): number {
  return new Date(ts).setHours(23, 59, 59, 999)
}

function isEmptyValue (value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}

export type CustomFieldsRecord = Record<string, unknown> | undefined

/**
 * Iteration ids a list of picked ids and relative keywords stands for. A keyword that has no iteration
 * (no current iteration, say) stands for nothing.
 */
export function resolveIterationValues (
  fieldKey: string,
  values: readonly string[],
  context: IterationContext | undefined
): string[] {
  const res: string[] = []
  for (const v of values) {
    const m = ITERATION_TOKEN.exec(v)
    if (m === null) {
      res.push(v)
      continue
    }
    if (context === undefined) continue
    const offset = m[2] === undefined ? 0 : Number(m[3]) * (m[2] === '-' ? -1 : 1)
    const target = resolveRelativeIteration(
      context.iterations(fieldKey),
      m[1] as 'current' | 'next' | 'previous',
      offset,
      context.now
    )
    if (target !== undefined) res.push(target._id)
  }
  return res
}

/**
 * Build a predicate over `Issue.customFields` for one filter rule.
 * Incomplete rules match everything. Date bounds are whole calendar days: "before D" excludes D,
 * "after D" starts the day after D, and a range includes both end days.
 */
export function buildFieldPredicate (
  field: Pick<ProjectField, 'key' | 'type' | 'options'>,
  filter: Pick<CustomFieldFilter, 'operator' | 'value'>,
  iterationContext?: IterationContext
): (customFields: CustomFieldsRecord) => boolean {
  if (!isFilterComplete(filter)) return () => true
  const read = (cf: CustomFieldsRecord): ReturnType<typeof getFieldValue> => getFieldValue(cf, field)
  const { operator, value } = filter

  if (operator === 'isEmpty') return (cf) => isEmptyValue(read(cf))
  if (operator === 'isNotEmpty') return (cf) => !isEmptyValue(read(cf))

  if (operator === 'contains') {
    const needle = (value as string).trim().toLowerCase()
    return (cf) => {
      const v = read(cf)
      return typeof v === 'string' && v.toLowerCase().includes(needle)
    }
  }

  if (operator === 'anyOf') {
    const wanted = new Set(
      field.type === ProjectFieldType.Iteration
        ? resolveIterationValues(field.key, value as string[], iterationContext)
        : (value as string[])
    )
    return (cf) => {
      const v = read(cf)
      if (Array.isArray(v)) return v.some((x) => wanted.has(x))
      return typeof v === 'string' && wanted.has(v)
    }
  }

  const isDate = field.type === ProjectFieldType.Date

  if (operator === 'between') {
    const range = value as FieldRange
    const from = isDate && range.from !== undefined ? startOfDay(range.from) : range.from
    const to = isDate && range.to !== undefined ? endOfDay(range.to) : range.to
    return (cf) => {
      const v = read(cf)
      if (typeof v !== 'number') return false
      return (from === undefined || v >= from) && (to === undefined || v <= to)
    }
  }

  const bound = value as number
  const dayStart = isDate ? startOfDay(bound) : bound
  const dayEnd = isDate ? endOfDay(bound) : bound
  const compare = (check: (v: number) => boolean) => (cf: CustomFieldsRecord) => {
    const v = read(cf)
    return typeof v === 'number' && check(v)
  }
  switch (operator) {
    case 'eq':
      return compare((v) => v === bound)
    case 'gt':
      return compare((v) => v > bound)
    case 'after':
      return compare((v) => v > dayEnd)
    case 'gte':
      return compare((v) => v >= bound)
    case 'lt':
      return compare((v) => v < bound)
    case 'before':
      return compare((v) => v < dayStart)
    case 'lte':
      return compare((v) => v <= bound)
    default:
      return () => true
  }
}

/**
 * Combine all rules with AND. A rule that refers to a field that no longer exists matches nothing,
 * so a stale rule is never silently ignored.
 */
export function buildFiltersPredicate (
  fieldsByKey: ReadonlyMap<string, Pick<ProjectField, 'key' | 'type' | 'options'>>,
  filters: readonly CustomFieldFilter[],
  iterationContext?: IterationContext
): (issue: { customFields?: Record<string, unknown> }) => boolean {
  const predicates = filters
    .filter((f) => isFilterComplete(f))
    .map((f) => {
      const field = fieldsByKey.get(f.fieldKey)
      return field === undefined ? () => false : buildFieldPredicate(field, f, iterationContext)
    })
  if (predicates.length === 0) return () => true
  return (issue) => predicates.every((p) => p(issue.customFields))
}

/** Number of rules that actually restrict the result. */
export function activeFilterCount (filters: readonly CustomFieldFilter[]): number {
  return filters.filter((f) => isFilterComplete(f)).length
}

/** Comparator for two non-empty values of the field. */
function compareNonEmpty (
  field: Pick<ProjectField, 'key' | 'type' | 'options'>,
  iterationContext?: IterationContext
): (a: any, b: any) => number {
  switch (field.type) {
    case ProjectFieldType.Iteration: {
      // GitHub orders by the start of the iteration; an id no iteration answers to (deleted) goes last
      const start = new Map((iterationContext?.iterations(field.key) ?? []).map((it) => [it._id as string, it.startDate]))
      return (a: string, b: string) => (start.get(a) ?? Infinity) - (start.get(b) ?? Infinity) || 0
    }
    case ProjectFieldType.Number:
    case ProjectFieldType.Date:
      return (a: number, b: number) => a - b
    case ProjectFieldType.SingleSelect: {
      // GitHub orders single-select values by the option order, not alphabetically
      const order = new Map((field.options ?? []).map((o, i) => [o.value, i]))
      return (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
    }
    default:
      return (a: string, b: string) => a.localeCompare(b)
  }
}

/**
 * Comparator for issues by a custom field. `direction` is 1 (ascending) or -1 (descending).
 * Empty values are always placed last, in both directions.
 */
export function buildFieldComparator (
  field: Pick<ProjectField, 'key' | 'type' | 'options'>,
  direction: 1 | -1,
  iterationContext?: IterationContext
): (a: { customFields?: Record<string, unknown> }, b: { customFields?: Record<string, unknown> }) => number {
  const cmp = compareNonEmpty(field, iterationContext)
  return (a, b) => {
    const va = getFieldValue(a.customFields, field)
    const vb = getFieldValue(b.customFields, field)
    const ea = isEmptyValue(va)
    const eb = isEmptyValue(vb)
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
    return cmp(va, vb) * direction
  }
}

/**
 * Group values (option ids) in display order for a single-select field: options in their defined
 * order, followed by any stray value found in the data, and `undefined` (the "No <field>" group) last.
 * Options without issues are only listed when `includeEmpty` is set.
 */
export function buildGroupCategories (
  field: Pick<ProjectField, 'key' | 'options'>,
  docs: ReadonlyArray<{ customFields?: Record<string, unknown> }>,
  includeEmpty: boolean
): Array<string | undefined> {
  const used = new Set<string>()
  let hasEmpty = false
  for (const doc of docs) {
    const v = doc.customFields?.[field.key]
    if (typeof v === 'string' && v !== '') used.add(v)
    else hasEmpty = true
  }
  const result: Array<string | undefined> = []
  for (const o of field.options ?? []) {
    if (includeEmpty || used.has(o.value)) result.push(o.value)
    used.delete(o.value)
  }
  result.push(...used)
  if (hasEmpty || includeEmpty) result.push(undefined)
  return result
}
