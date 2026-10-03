//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType } from '@hcengineering/tracker'
import { dayToTime, toDay } from './timeScale'

// Where the start and the target of a roadmap item come from. A source is addressed by an id that is stored
// in the saved view:
//   issue:startDate | issue:dueDate | issue:deadline   built-in dates of the issue
//   milestone:startDate | milestone:targetDate         dates of the milestone of the issue (read only)
//   field:<key>                                         a custom Date field
//   iteration:<key>                                     an Iteration field: its start gives the start of the
//                                                       item, its last day the target

export type DateSourceKind = 'issue' | 'milestone' | 'field' | 'iteration'

export type IssueDateKey = 'startDate' | 'dueDate' | 'deadline'

export interface DateSourceRef {
  kind: DateSourceKind
  key: string
}

export interface DateSource extends DateSourceRef {
  id: string
  label: string
  // Whether dragging an item can write the source
  writable: boolean
}

export const ISSUE_START_SOURCE = 'issue:startDate'
export const ISSUE_DUE_SOURCE = 'issue:dueDate'
export const ISSUE_DEADLINE_SOURCE = 'issue:deadline'
export const MILESTONE_START_SOURCE = 'milestone:startDate'
export const MILESTONE_TARGET_SOURCE = 'milestone:targetDate'

const ISSUE_KEYS: readonly string[] = ['startDate', 'dueDate', 'deadline']
const MILESTONE_KEYS: readonly string[] = ['startDate', 'targetDate']

export function makeSourceId (ref: DateSourceRef): string {
  return `${ref.kind}:${ref.key}`
}

export function parseSourceId (id: string): DateSourceRef | undefined {
  const at = id.indexOf(':')
  if (at <= 0) return undefined
  const kind = id.slice(0, at)
  const key = id.slice(at + 1)
  if (key === '') return undefined
  switch (kind) {
    case 'issue':
      return ISSUE_KEYS.includes(key) ? { kind, key } : undefined
    case 'milestone':
      return MILESTONE_KEYS.includes(key) ? { kind, key } : undefined
    case 'field':
    case 'iteration':
      return { kind, key }
    default:
      return undefined
  }
}

export interface DateSourceLabels {
  startDate: string
  dueDate: string
  deadline: string
  milestoneStart: string
  milestoneTarget: string
}

export interface FieldLike {
  key: string
  label: string
  type: ProjectFieldType
}

/**
 * Everything a roadmap can take its dates from, in the order they are offered:
 * the dates of the issue, the dates of its milestone, then the Date and Iteration fields of the project.
 */
export function buildDateSources (fields: readonly FieldLike[], labels: DateSourceLabels): DateSource[] {
  const res: DateSource[] = [
    { id: ISSUE_START_SOURCE, kind: 'issue', key: 'startDate', label: labels.startDate, writable: true },
    { id: ISSUE_DUE_SOURCE, kind: 'issue', key: 'dueDate', label: labels.dueDate, writable: true },
    { id: ISSUE_DEADLINE_SOURCE, kind: 'issue', key: 'deadline', label: labels.deadline, writable: true },
    { id: MILESTONE_START_SOURCE, kind: 'milestone', key: 'startDate', label: labels.milestoneStart, writable: false },
    {
      id: MILESTONE_TARGET_SOURCE,
      kind: 'milestone',
      key: 'targetDate',
      label: labels.milestoneTarget,
      writable: false
    }
  ]
  for (const f of fields) {
    if (f.type === ProjectFieldType.Date) {
      res.push({ id: `field:${f.key}`, kind: 'field', key: f.key, label: f.label, writable: true })
    } else if (f.type === ProjectFieldType.Iteration) {
      res.push({ id: `iteration:${f.key}`, kind: 'iteration', key: f.key, label: f.label, writable: true })
    }
  }
  return res
}

// ---- reading ----

export interface IterationDates {
  _id: string
  startDate: number
  duration: number
  isBreak?: boolean
}

export interface MilestoneDates {
  startDate: number | null
  targetDate: number
}

export interface DateIssue {
  startDate?: number | null
  dueDate?: number | null
  deadline?: number | null
  milestone?: string | null
  customFields?: Record<string, unknown>
}

export interface DateLookups {
  milestone: (id: string) => MilestoneDates | undefined
  // Iterations of an Iteration field, by the key of the field
  iterations: (fieldKey: string) => readonly IterationDates[]
}

export type DateRole = 'start' | 'target'

/** First and last day (inclusive) of an iteration. */
export function iterationDays (it: Pick<IterationDates, 'startDate' | 'duration'>): { start: number, end: number } {
  const start = toDay(it.startDate)
  return { start, end: start + Math.max(1, it.duration) - 1 }
}

function timestampDay (value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? toDay(value) : undefined
}

/**
 * The day the source gives for an item, or undefined when the item has no value in it.
 * `role` matters for iterations only: the start of the item is the first day of its iteration, the target the last.
 */
export function readSourceDay (
  issue: DateIssue,
  source: DateSourceRef,
  role: DateRole,
  lookups: DateLookups
): number | undefined {
  switch (source.kind) {
    case 'issue':
      return timestampDay(issue[source.key as IssueDateKey])
    case 'milestone': {
      if (issue.milestone === undefined || issue.milestone === null) return undefined
      const m = lookups.milestone(issue.milestone)
      return m === undefined ? undefined : timestampDay(m[source.key as keyof MilestoneDates])
    }
    case 'field':
      return timestampDay(issue.customFields?.[source.key])
    case 'iteration': {
      const id = issue.customFields?.[source.key]
      if (typeof id !== 'string') return undefined
      const it = lookups.iterations(source.key).find((i) => i._id === id)
      if (it === undefined) return undefined
      const days = iterationDays(it)
      return role === 'start' ? days.start : days.end
    }
  }
}

// ---- schedule of an item ----

/** The start and target sources of a view. */
export interface DateSelection {
  start: string
  target: string
}

export type ItemSchedule =
  // Both dates are known: the item spans the days from `start` to `target`, both inclusive
  | { kind: 'range', start: number, target: number, inverted: boolean }
  // Only one date is known: it is drawn as a marker
  | { kind: 'marker', day: number, role: DateRole }
  | { kind: 'unscheduled' }

/**
 * Where an item is on the timeline. An item whose start lies after its target is drawn from the earlier to the
 * later day and flagged as inverted.
 */
export function resolveSchedule (issue: DateIssue, selection: DateSelection, lookups: DateLookups): ItemSchedule {
  const startRef = parseSourceId(selection.start)
  const targetRef = parseSourceId(selection.target)
  const start = startRef !== undefined ? readSourceDay(issue, startRef, 'start', lookups) : undefined
  const target = targetRef !== undefined ? readSourceDay(issue, targetRef, 'target', lookups) : undefined
  if (start !== undefined && target !== undefined) {
    return start <= target
      ? { kind: 'range', start, target, inverted: false }
      : { kind: 'range', start: target, target: start, inverted: true }
  }
  if (start !== undefined) return { kind: 'marker', day: start, role: 'start' }
  if (target !== undefined) return { kind: 'marker', day: target, role: 'target' }
  return { kind: 'unscheduled' }
}

/** Days an item occupies on the axis, used to size it. */
export function scheduleDays (schedule: ItemSchedule): number[] {
  switch (schedule.kind) {
    case 'range':
      return [schedule.start, schedule.target]
    case 'marker':
      return [schedule.day]
    case 'unscheduled':
      return []
  }
}

/** Splits items into those with dates (bars and markers) and those without, keeping their order. */
export function partitionBySchedule<T> (
  items: readonly T[],
  scheduleOf: (item: T) => ItemSchedule
): { scheduled: T[], unscheduled: T[] } {
  const scheduled: T[] = []
  const unscheduled: T[] = []
  for (const item of items) {
    if (scheduleOf(item).kind === 'unscheduled') unscheduled.push(item)
    else scheduled.push(item)
  }
  return { scheduled, unscheduled }
}

/** Timestamp to store for a day picked on the timeline: the start of the day. */
export function dayToStoredDate (day: number): number {
  return dayToTime(day)
}
