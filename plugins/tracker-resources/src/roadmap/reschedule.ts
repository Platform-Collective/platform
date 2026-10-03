//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  dayToStoredDate,
  iterationDays,
  parseSourceId,
  readSourceDay,
  type DateIssue,
  type DateLookups,
  type DateRole,
  type DateSelection,
  type DateSource,
  type DateSourceKind,
  type IterationDates,
  type ItemSchedule
} from './dates'
import { shiftTimestamp } from './timeScale'

/** Dragging the bar moves both dates, dragging an edge moves only that date. */
export type RescheduleMode = 'move' | 'resize-start' | 'resize-end'

/** A range keeps at least this many days (a single day). */
export const MIN_DURATION_DAYS = 1

export interface DayRange {
  start: number
  target: number
}

/**
 * The range after the pointer moved by `delta` days. Moving keeps the duration, resizing never lets the
 * start pass the target or the other way round (a range stays at least one day).
 */
export function applyDelta (range: DayRange, mode: RescheduleMode, delta: number): DayRange {
  switch (mode) {
    case 'move':
      return { start: range.start + delta, target: range.target + delta }
    case 'resize-start':
      return { start: Math.min(range.start + delta, range.target), target: range.target }
    case 'resize-end':
      return { start: range.start, target: Math.max(range.target + delta, range.start) }
  }
}

/** The schedule of an item while it is dragged. Edges of markers and inverted ranges cannot be resized. */
export function previewSchedule (schedule: ItemSchedule, mode: RescheduleMode, delta: number): ItemSchedule {
  switch (schedule.kind) {
    case 'unscheduled':
      return schedule
    case 'marker':
      return mode === 'move' ? { ...schedule, day: schedule.day + delta } : schedule
    case 'range': {
      if (schedule.inverted && mode !== 'move') return schedule
      const next = applyDelta(schedule, mode, delta)
      return { ...schedule, start: next.start, target: next.target }
    }
  }
}

// ---- iterations ----

/**
 * The iteration (breaks excluded) that contains the day, or the closest one when none does.
 */
export function iterationAt (iterations: readonly IterationDates[], day: number): IterationDates | undefined {
  let best: IterationDates | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const it of iterations) {
    if (it.isBreak === true) continue
    const { start, end } = iterationDays(it)
    const distance = day < start ? start - day : day > end ? day - end : 0
    if (distance < bestDistance) {
      best = it
      bestDistance = distance
    }
  }
  return best
}

/**
 * The iteration (breaks excluded) an item snaps to when its start (or target) is dragged to `day`: the one whose
 * first day (or last day) is closest, so dragging by about an iteration moves the item to the neighbour.
 */
export function snapIteration (
  iterations: readonly IterationDates[],
  day: number,
  role: DateRole
): IterationDates | undefined {
  let best: IterationDates | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const it of iterations) {
    if (it.isBreak === true) continue
    const days = iterationDays(it)
    const distance = Math.abs((role === 'start' ? days.start : days.end) - day)
    if (distance < bestDistance) {
      best = it
      bestDistance = distance
    }
  }
  return best
}

// ---- plans ----

/** A value to store in one date source of an item: a timestamp, or an iteration id for an Iteration field. */
export interface DateWrite {
  sourceId: string
  kind: DateSourceKind
  key: string
  value: number | string
}

export type PlanFailure = 'readonly' | 'unsupported' | 'unchanged' | 'noSchedule'

export type DatePlan = { ok: true, writes: DateWrite[] } | { ok: false, reason: PlanFailure }

export interface PlanContext {
  issue: DateIssue
  schedule: ItemSchedule
  selection: DateSelection
  sources: ReadonlyMap<string, DateSource>
  lookups: DateLookups
}

interface Endpoint {
  role: DateRole
  sourceId: string
  oldDay: number
  newDay: number
}

function currentTimestamp (issue: DateIssue, kind: DateSourceKind, key: string): number | undefined {
  const raw = kind === 'issue' ? (issue as Record<string, unknown>)[key] : issue.customFields?.[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function currentIterationId (issue: DateIssue, key: string): string | undefined {
  const raw = issue.customFields?.[key]
  return typeof raw === 'string' ? raw : undefined
}

function endpointsOf (ctx: PlanContext, mode: RescheduleMode, delta: number): Endpoint[] | PlanFailure {
  const { schedule, selection } = ctx
  switch (schedule.kind) {
    case 'unscheduled':
      return 'noSchedule'
    case 'marker': {
      if (mode !== 'move') return 'unsupported'
      return [
        {
          role: schedule.role,
          sourceId: schedule.role === 'start' ? selection.start : selection.target,
          oldDay: schedule.day,
          newDay: schedule.day + delta
        }
      ]
    }
    case 'range': {
      if (schedule.inverted && mode !== 'move') return 'unsupported'
      const next = applyDelta(schedule, mode, delta)
      // An inverted range is drawn from the target source's day to the start source's day
      const startOld = schedule.inverted ? schedule.target : schedule.start
      const targetOld = schedule.inverted ? schedule.start : schedule.target
      const startNew = schedule.inverted ? next.target : next.start
      const targetNew = schedule.inverted ? next.start : next.target
      const res: Endpoint[] = []
      if (mode !== 'resize-end') {
        res.push({ role: 'start', sourceId: selection.start, oldDay: startOld, newDay: startNew })
      }
      if (mode !== 'resize-start') {
        res.push({ role: 'target', sourceId: selection.target, oldDay: targetOld, newDay: targetNew })
      }
      return res
    }
  }
}

/**
 * Work out what to store when an item is dragged by `delta` days. A move keeps the duration; a resize writes
 * only the edge that moved. Date sources receive the moved timestamp (keeping its time of day), Iteration sources
 * the iteration that the new day snaps to (dragging an item over an iteration field moves it to another iteration).
 * The milestone dates are read only: an item that takes one of its dates from there cannot be moved, only
 * the edge that comes from a writable source can be resized.
 */
export function planReschedule (ctx: PlanContext, mode: RescheduleMode, delta: number): DatePlan {
  const endpoints = endpointsOf(ctx, mode, delta)
  if (typeof endpoints === 'string') return { ok: false, reason: endpoints }
  if (delta === 0) return { ok: false, reason: 'unchanged' }

  const writes = new Map<string, DateWrite>()
  for (const e of endpoints) {
    const source = ctx.sources.get(e.sourceId)
    if (source === undefined || !source.writable) return { ok: false, reason: 'readonly' }
    if (e.newDay === e.oldDay) continue
    if (source.kind === 'iteration') {
      const target = snapIteration(ctx.lookups.iterations(source.key), e.newDay, e.role)
      if (target === undefined || target._id === currentIterationId(ctx.issue, source.key)) continue
      writes.set(source.id, { sourceId: source.id, kind: source.kind, key: source.key, value: target._id })
    } else {
      const ts = currentTimestamp(ctx.issue, source.kind, source.key)
      if (ts === undefined) continue
      writes.set(source.id, {
        sourceId: source.id,
        kind: source.kind,
        key: source.key,
        value: shiftTimestamp(ts, e.newDay - e.oldDay)
      })
    }
  }
  return writes.size === 0 ? { ok: false, reason: 'unchanged' } : { ok: true, writes: [...writes.values()] }
}

export interface ScheduleContext {
  issue: DateIssue
  selection: DateSelection
  sources: ReadonlyMap<string, DateSource>
  lookups: DateLookups
}

/**
 * Work out what to store to put an item on a day of the timeline: both dates are set to the day (an Iteration source
 * to the iteration that contains it). Dates the item already has are kept, so only the missing one is added to an
 * item that is shown as a marker. Read only sources are left alone.
 */
export function planSchedule (ctx: ScheduleContext, day: number): DatePlan {
  const writes = new Map<string, DateWrite>()
  const roles: Array<[DateRole, string]> = [
    ['start', ctx.selection.start],
    ['target', ctx.selection.target]
  ]
  let writable = false
  for (const [role, id] of roles) {
    const source = ctx.sources.get(id)
    if (source === undefined || !source.writable) continue
    writable = true
    const ref = parseSourceId(id)
    if (ref !== undefined && readSourceDay(ctx.issue, ref, role, ctx.lookups) !== undefined) continue
    if (writes.has(source.id)) continue
    if (source.kind === 'iteration') {
      const target = iterationAt(ctx.lookups.iterations(source.key), day)
      if (target === undefined) continue
      writes.set(source.id, { sourceId: source.id, kind: source.kind, key: source.key, value: target._id })
    } else {
      writes.set(source.id, { sourceId: source.id, kind: source.kind, key: source.key, value: dayToStoredDate(day) })
    }
  }
  if (!writable) return { ok: false, reason: 'readonly' }
  return writes.size === 0 ? { ok: false, reason: 'unchanged' } : { ok: true, writes: [...writes.values()] }
}

/**
 * The attributes of the issue to update for the writes. Custom fields go into one merged `customFields` record.
 */
export function buildIssuePatch (
  issue: { customFields?: Record<string, unknown> },
  writes: readonly DateWrite[]
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  let custom: Record<string, unknown> | undefined
  for (const w of writes) {
    if (w.kind === 'issue') {
      patch[w.key] = w.value
    } else if (w.kind === 'field' || w.kind === 'iteration') {
      custom ??= { ...(issue.customFields ?? {}) }
      custom[w.key] = w.value
    }
  }
  if (custom !== undefined) patch.customFields = custom
  return patch
}
