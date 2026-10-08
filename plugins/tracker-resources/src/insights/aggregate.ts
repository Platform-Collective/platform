//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { InsightAggregate, InsightDateBucket } from '@hcengineering/tracker'
import { sumNumbers, toSummable } from '../fieldSum/sum'

// The aggregation of an Insights chart: the issues are put into buckets by the X field (and into series by the group
// field) and every cell gets the count of its issues or an aggregate of a number field. Pure, runs over the issues
// the host scanned; it knows nothing of fields, filters or the platform.

/** The id of the bucket and of the series of the items without a value ("No <field>"). */
export const CHART_NONE = '__none__'

/** The id of the only series of a chart that is not grouped. */
export const CHART_ALL = '__all__'

/** Date buckets are filled in over gaps up to this many; beyond it only the buckets that have items are drawn. */
export const MAX_FILLED_DATE_BUCKETS = 1000

export interface CategoryDimension {
  kind: 'category'
  // Options in the order of the axis
  options: ReadonlyArray<{ id: string, label: string }>
  // List the options that no item has (with 0)
  includeEmpty: boolean
  // Ids of the options of an item; none for an item without a value
  ids: (doc: any) => string[]
  // Already translated "No <field>"
  noneLabel: string
}

export interface DateDimension {
  kind: 'date'
  bucket: InsightDateBucket
  // The date of an item as a timestamp; undefined for an item without one
  read: (doc: any) => number | undefined
  noneLabel: string
}

export type Dimension = CategoryDimension | DateDimension

export interface Measure {
  type: InsightAggregate
  // The raw value of the number field; anything that is not a finite number is ignored. Not needed for the count
  read?: (doc: any) => unknown
}

export interface ChartRequest {
  docs: readonly unknown[]
  x: Dimension
  group?: CategoryDimension
  measure: Measure
}

export interface ChartCategory {
  id: string
  label: string
  // The bucket of the items without a value
  none: boolean
  // First and last millisecond of a date bucket
  start?: number
  end?: number
}

export interface ChartSeries {
  id: string
  // Empty for the only series of a chart that is not grouped
  label: string
  none: boolean
}

export interface ChartData {
  categories: ChartCategory[]
  series: ChartSeries[]
  // Y value by series, then by category; null where the cell has nothing to aggregate (average, minimum, maximum of no numbers)
  values: Array<Array<number | null>>
  // Number of items by series, then by category
  counts: number[][]
  // Items the chart is made of
  items: number
}

// ---- dates ----

/** First moment of the day, the Monday of the week or the first day of the month (local time) that contains the timestamp. */
export function bucketStart (ts: number, bucket: InsightDateBucket): number {
  const d = new Date(ts)
  switch (bucket) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    case 'week':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime()
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }
}

/** Start of the bucket after the one that starts at `start`. */
export function nextBucketStart (start: number, bucket: InsightDateBucket): number {
  const d = new Date(start)
  switch (bucket) {
    case 'day':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    case 'week':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime()
    case 'month':
      return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  }
}

function pad (n: number): string {
  return String(n).padStart(2, '0')
}

/** `YYYY-MM-DD` of the local day of a timestamp. */
export function formatDay (ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Label of a date bucket: the day, the first day of the week (Monday) or the month (`YYYY-MM`). */
export function formatBucketLabel (start: number, bucket: InsightDateBucket): string {
  if (bucket === 'month') return formatDay(start).slice(0, 7)
  return formatDay(start)
}

/** First and last day (`YYYY-MM-DD`) of a date bucket, as a filter range uses them. */
export function bucketDayRange (start: number, bucket: InsightDateBucket): { from: string, to: string } {
  return { from: formatDay(start), to: formatDay(nextBucketStart(start, bucket) - 1) }
}

function bucketStarts (used: ReadonlySet<number>, bucket: InsightDateBucket): number[] {
  if (used.size === 0) return []
  const sorted = [...used].sort((a, b) => a - b)
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const filled: number[] = []
  for (let at = first; at <= last; at = nextBucketStart(at, bucket)) {
    filled.push(at)
    if (filled.length > MAX_FILLED_DATE_BUCKETS) return sorted
  }
  return filled
}

// ---- aggregation ----

interface Cell {
  count: number
  numbers: number[]
}

/** Value of a cell for the aggregate; null when there is nothing to aggregate. */
export function aggregateCell (type: InsightAggregate, cell: { count: number, numbers: readonly number[] } | undefined): number | null {
  if (type === 'count') return cell?.count ?? 0
  const numbers = cell?.numbers ?? []
  if (type === 'sum') return sumNumbers(numbers).sum
  if (numbers.length === 0) return null
  if (type === 'avg') return sumNumbers(numbers).sum / numbers.length
  let res = numbers[0]
  for (const n of numbers) res = type === 'min' ? Math.min(res, n) : Math.max(res, n)
  return res
}

function categoryKeys (dim: CategoryDimension, doc: unknown): string[] {
  const ids = dim.ids(doc)
  return ids.length === 0 ? [CHART_NONE] : [...new Set(ids)]
}

function xKeys (dim: Dimension, doc: unknown): string[] {
  if (dim.kind === 'category') return categoryKeys(dim, doc)
  const ts = dim.read(doc)
  return typeof ts === 'number' && Number.isFinite(ts) ? [String(bucketStart(ts, dim.bucket))] : [CHART_NONE]
}

/**
 * Computes the chart: the buckets of the X-axis, the series, and the value and the item count of every cell.
 *
 * - An item with several values in a field (labels, multi select) counts in each of them.
 * - Items without a value are in the "No <field>" bucket, the last one; it is there only when it has items.
 * - Category buckets are the options of the field in their order (all of them for the fields the project owns, the
 *   used ones for the others), a date axis is every bucket from the first item to the last, with empty ones between.
 * - The count counts every item; the other aggregates use the items that have a number in the field, and a cell with
 *   none has no value (null) for the average, minimum and maximum, 0 for the sum.
 */
export function computeChart (request: ChartRequest): ChartData {
  const { docs, x, group, measure } = request
  const needsNumbers = measure.type !== 'count' && measure.read !== undefined
  const cells = new Map<string, Map<string, Cell>>()
  const usedX = new Set<string>()
  const usedSeries = new Set<string>()

  for (const doc of docs) {
    const xs = xKeys(x, doc)
    const gs = group !== undefined ? categoryKeys(group, doc) : [CHART_ALL]
    const n = needsNumbers ? toSummable(measure.read?.(doc)) : undefined
    for (const g of gs) {
      usedSeries.add(g)
      let row = cells.get(g)
      if (row === undefined) {
        row = new Map()
        cells.set(g, row)
      }
      for (const xk of xs) {
        usedX.add(xk)
        let cell = row.get(xk)
        if (cell === undefined) {
          cell = { count: 0, numbers: [] }
          row.set(xk, cell)
        }
        cell.count++
        if (n !== undefined) cell.numbers.push(n)
      }
    }
  }

  const categories: ChartCategory[] = []
  if (x.kind === 'category') {
    for (const o of x.options) {
      if (usedX.has(o.id) || x.includeEmpty) categories.push({ id: o.id, label: o.label, none: false })
    }
  } else {
    const used = new Set<number>()
    for (const k of usedX) if (k !== CHART_NONE) used.add(Number(k))
    for (const start of bucketStarts(used, x.bucket)) {
      categories.push({
        id: String(start),
        label: formatBucketLabel(start, x.bucket),
        none: false,
        start,
        end: nextBucketStart(start, x.bucket) - 1
      })
    }
  }
  if (usedX.has(CHART_NONE)) categories.push({ id: CHART_NONE, label: x.noneLabel, none: true })

  const series: ChartSeries[] = []
  if (group === undefined) {
    series.push({ id: CHART_ALL, label: '', none: false })
  } else {
    for (const o of group.options) if (usedSeries.has(o.id)) series.push({ id: o.id, label: o.label, none: false })
    if (usedSeries.has(CHART_NONE)) series.push({ id: CHART_NONE, label: group.noneLabel, none: true })
  }

  // Nothing to draw: no buckets also means no series, so that a consumer never sees series of empty rows
  if (categories.length === 0) return { categories, series: [], values: [], counts: [], items: docs.length }

  const values: Array<Array<number | null>> = []
  const counts: number[][] = []
  for (const s of series) {
    const row = cells.get(s.id)
    values.push(categories.map((c) => aggregateCell(measure.type, row?.get(c.id))))
    counts.push(categories.map((c) => row?.get(c.id)?.count ?? 0))
  }
  return { categories, series, values, counts, items: docs.length }
}
