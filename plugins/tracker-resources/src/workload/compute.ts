//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ItemSchedule } from '../roadmap/dates'
import { bucketIndexOfDay, type WorkloadAxis } from './axis'
import type { WorkdayIndex } from './workdays'

// The load of people over time. The load of an item is spread evenly over the working days between its first and its
// last day and added up per person and bucket. All days are indexes of local calendar days (roadmap/timeScale.ts).

/** An item to plan: whose it is, how much load it has and where it is scheduled. */
export interface LoadEntry {
  id: string
  // Key of the row of the assignee (see rows.ts)
  row: string
  // Load in the unit of the measure, a finite number that is not negative
  load: number
  schedule: ItemSchedule
}

/** First and last day (both included) of a schedule, undefined for an item without a day. */
export function scheduleSpan (schedule: ItemSchedule): { start: number, end: number } | undefined {
  switch (schedule.kind) {
    case 'range':
      return { start: schedule.start, end: schedule.target }
    case 'marker':
      return { start: schedule.day, end: schedule.day }
    case 'unscheduled':
      return undefined
  }
}

/**
 * Spreads the load of a scheduled item over the buckets of the axis: `visit(bucketIndex, share)` is called for every
 * bucket that holds working days of the item, with the share of the load that falls into it. The shares of the
 * buckets add up to the load, except for the part of the item that lies outside the axis.
 *
 * A span without any working day (an item that is only on a weekend or on holidays) is planned on the calendar
 * days of the span instead, so that its load is not lost. Days outside the window of the working day index
 * are not planned.
 *
 * Returns whether any bucket was touched.
 */
export function distribute (
  schedule: ItemSchedule,
  load: number,
  axis: WorkloadAxis,
  index: WorkdayIndex,
  visit: (bucket: number, share: number) => void
): boolean {
  const span = scheduleSpan(schedule)
  if (span === undefined) return false
  const safeLoad = Number.isFinite(load) && load > 0 ? load : 0
  const s = Math.max(span.start, index.fromDay)
  const t = Math.min(span.end, index.toDay - 1)
  if (t < s || t < axis.startDay || s >= axis.endDay) return false
  const working = index.count(s, t)
  const onCalendar = working === 0
  const total = onCalendar ? t - s + 1 : working
  let touched = false
  for (let i = bucketIndexOfDay(axis, Math.max(s, axis.startDay)); i >= 0 && i < axis.buckets.length; i++) {
    const bucket = axis.buckets[i]
    if (bucket.start > t) break
    const a = Math.max(s, bucket.start)
    const z = Math.min(t, bucket.end - 1)
    const days = onCalendar ? z - a + 1 : index.count(a, z)
    if (days <= 0) continue
    visit(i, (safeLoad * days) / total)
    touched = true
  }
  return touched
}

/** The load of one row: a person or the unassigned items. */
export interface RowLoad {
  key: string
  // Load per bucket of the axis
  loads: Float64Array
  // Items that hold working days of the bucket (an item without a load value is counted here with no load)
  counts: Int32Array
  // Items without a day
  unscheduledLoad: number
  unscheduledCount: number
  // Items of the row that have no load value (a zero estimate, an empty number field)
  noLoadCount: number
  // All items of the row
  itemCount: number
}

export interface WorkloadResult {
  rows: Map<string, RowLoad>
  // Scheduled items that are not on the axis at all: they are not part of any bucket
  outOfRange: number
}

/** A row without any item, e.g. a member of the project who has no work yet. */
export function emptyRowLoad (key: string, buckets: number): RowLoad {
  return {
    key,
    loads: new Float64Array(buckets),
    counts: new Int32Array(buckets),
    unscheduledLoad: 0,
    unscheduledCount: 0,
    noLoadCount: 0,
    itemCount: 0
  }
}

/** Adds the load of the items up per row and bucket. Rows exist for the rows that have items. */
export function computeWorkload (
  entries: readonly LoadEntry[],
  axis: WorkloadAxis,
  index: WorkdayIndex
): WorkloadResult {
  const rows = new Map<string, RowLoad>()
  let outOfRange = 0
  for (const entry of entries) {
    let row = rows.get(entry.row)
    if (row === undefined) {
      row = emptyRowLoad(entry.row, axis.buckets.length)
      rows.set(entry.row, row)
    }
    const load = Number.isFinite(entry.load) && entry.load > 0 ? entry.load : 0
    row.itemCount++
    if (load === 0) row.noLoadCount++
    if (entry.schedule.kind === 'unscheduled') {
      row.unscheduledLoad += load
      row.unscheduledCount++
      continue
    }
    const target = row
    const touched = distribute(entry.schedule, load, axis, index, (bucket, share) => {
      target.loads[bucket] += share
      target.counts[bucket]++
    })
    if (!touched) outOfRange++
  }
  return { rows, outOfRange }
}

/** The capacity of every bucket: what one person can take per working day times the working days of the bucket. */
export function bucketCapacities (axis: WorkloadAxis, index: WorkdayIndex, perDay: number): Float64Array {
  const res = new Float64Array(axis.buckets.length)
  const safe = Number.isFinite(perDay) && perDay > 0 ? perDay : 0
  for (const bucket of axis.buckets) res[bucket.index] = safe * index.count(bucket.start, bucket.end - 1)
  return res
}

// ---- states ----

/** How loaded a person is compared with the capacity. */
export type LoadState = 'empty' | 'under' | 'near' | 'over'

/** A load of this share of the capacity or more is near the capacity. */
export const NEAR_RATIO = 0.8

// Sums of fractions are never exact, so a load that is over by less than this is not over
const OVER_TOLERANCE = 1e-9
const EMPTY_LOAD = 1e-9

/**
 * `empty` without load, `under`, `near` (from `NEAR_RATIO` of the capacity up to the capacity) or `over`. A bucket
 * without any capacity (a week of holidays, a weekend) is over as soon as it has load.
 */
export function loadState (load: number, capacity: number): LoadState {
  if (!(load > EMPTY_LOAD)) return 'empty'
  if (!(capacity > 0)) return 'over'
  const ratio = load / capacity
  if (ratio > 1 + OVER_TOLERANCE) return 'over'
  return ratio >= NEAR_RATIO ? 'near' : 'under'
}

/** Load as a share of the capacity (1 is full), undefined when there is no capacity to compare with. */
export function utilization (load: number, capacity: number): number | undefined {
  if (!Number.isFinite(load) || !(capacity > 0) || !Number.isFinite(capacity)) return undefined
  return load / capacity
}

export interface RowSummary {
  // Load inside the axis, the unscheduled load is not part of it
  total: number
  // First and last bucket that hold load, -1 when there is none
  activeFrom: number
  activeTo: number
  // Capacity of the buckets from the first to the last that hold load
  capacity: number
  // Total as a share of that capacity, undefined without load or without capacity
  utilization: number | undefined
  // Buckets that are over their capacity
  overCount: number
  // `over` as soon as one bucket is over, otherwise the state of the whole
  state: LoadState
}

/**
 * The header of a row: the total load and the utilization over the span in which the person has load (the first to
 * the last loaded bucket), so that a person booked full for two weeks reads 100 % and not a share of the whole axis.
 */
export function summarizeRow (row: RowLoad, capacities: ArrayLike<number>): RowSummary {
  let total = 0
  let activeFrom = -1
  let activeTo = -1
  let overCount = 0
  for (let i = 0; i < row.loads.length; i++) {
    const load = row.loads[i]
    if (!(load > EMPTY_LOAD)) continue
    total += load
    if (activeFrom < 0) activeFrom = i
    activeTo = i
    if (loadState(load, capacities[i]) === 'over') overCount++
  }
  let capacity = 0
  if (activeFrom >= 0) for (let i = activeFrom; i <= activeTo; i++) capacity += capacities[i]
  const state = overCount > 0 ? 'over' : loadState(total, capacity)
  return { total, activeFrom, activeTo, capacity, utilization: utilization(total, capacity), overCount, state }
}

// ---- the items behind a cell ----

/** An item that adds to a cell and the part of its load that does. */
export interface CellItem {
  id: string
  share: number
}

/**
 * The items behind a cell of a row: the items that hold working days of the bucket with their share of the load, the
 * biggest share first, or the items without a day with their whole load. Items without a load value are listed with a
 * share of 0.
 */
export function cellItems (
  entries: readonly LoadEntry[],
  axis: WorkloadAxis,
  index: WorkdayIndex,
  row: string,
  bucket: number | 'unscheduled'
): CellItem[] {
  const res: CellItem[] = []
  for (const entry of entries) {
    if (entry.row !== row) continue
    const load = Number.isFinite(entry.load) && entry.load > 0 ? entry.load : 0
    if (bucket === 'unscheduled') {
      if (entry.schedule.kind === 'unscheduled') res.push({ id: entry.id, share: load })
      continue
    }
    distribute(entry.schedule, load, axis, index, (i, share) => {
      if (i === bucket) res.push({ id: entry.id, share })
    })
  }
  return res.sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
