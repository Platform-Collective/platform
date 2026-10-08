//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Doc, Ref, Timestamp } from '@hcengineering/core'
import type { Project } from './index'
import type { ProjectField } from './projectField'

/**
 * A time box of an Iteration field (GitHub Projects v2 iteration). The value of an issue is the id
 * of the iteration, stored in `Issue.customFields[field.key]`. Dates are whole local days: `startDate`
 * is the start of the first day and the iteration covers `duration` days. Whether an iteration is
 * planned, current or completed is never stored, it follows from the dates (`getIterationState`).
 * @public
 */
export interface Iteration extends Doc {
  // The project of the owning field
  space: Ref<Project>
  // The Iteration field this iteration belongs to
  field: Ref<ProjectField>
  label: string
  // Ordinal used for default titles (`Iteration 4`); 0 for breaks
  number: number
  // Start of the first day (local midnight)
  startDate: Timestamp
  // Length in days, at least 1
  duration: number
  // A break occupies a date range but items cannot be assigned to it
  isBreak?: boolean
}

/**
 * @public
 */
export type IterationState = 'completed' | 'current' | 'planned'

/** The part of an iteration that describes where it is in time. */
export type IterationSpan = Pick<Iteration, 'startDate' | 'duration'>

/**
 * Values of a new iteration, before it gets an id.
 * @public
 */
export type IterationDraft = Pick<Iteration, 'label' | 'number' | 'startDate' | 'duration'> & { isBreak?: boolean }

/**
 * An iteration as the filter grammar sees it: `end` is the last millisecond of the last day.
 * @public
 */
export interface IterationRange {
  id: string
  title: string
  start: number
  end: number
}

/** @public */
export const DEFAULT_ITERATION_DURATION = 7
/** @public */
export const DEFAULT_INITIAL_ITERATIONS = 3

const DAY_MS = 86400000

// ---- date math (calendar days in the local time zone, so that daylight saving shifts do not matter) ----

/**
 * Start of the local day containing the timestamp.
 * @public
 */
export function startOfDay (ts: number): number {
  return new Date(ts).setHours(0, 0, 0, 0)
}

/**
 * The start of the day `days` calendar days after the day containing `ts` (negative goes back).
 * @public
 */
export function addDays (ts: number, days: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime()
}

/**
 * Number of calendar days from the day of `a` to the day of `b`.
 * @public
 */
export function daysBetween (a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS)
}

/**
 * Start of the day after the last day of the iteration (exclusive end).
 * @public
 */
export function iterationEndExclusive (it: IterationSpan): number {
  return addDays(it.startDate, it.duration)
}

/**
 * Last millisecond of the last day of the iteration.
 * @public
 */
export function iterationEnd (it: IterationSpan): number {
  return iterationEndExclusive(it) - 1
}

/**
 * Where the iteration is in time at `now`.
 * @public
 */
export function getIterationState (it: IterationSpan, now: number): IterationState {
  if (now < it.startDate) return 'planned'
  if (now > iterationEnd(it)) return 'completed'
  return 'current'
}

/**
 * Iterations in calendar order.
 * @public
 */
export function sortIterations<T extends Pick<Iteration, 'startDate' | 'number'>> (list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.startDate - b.startDate || a.number - b.number)
}

/**
 * Iterations an issue can be assigned to (everything but breaks), in calendar order.
 * @public
 */
export function getAssignableIterations<T extends Pick<Iteration, 'startDate' | 'number' | 'isBreak'>> (
  list: readonly T[]
): T[] {
  return sortIterations(list.filter((it) => it.isBreak !== true))
}

/**
 * The assignable iterations in the form the filter grammar resolves `@current` and friends against.
 * @public
 */
export function toIterationRanges (
  list: ReadonlyArray<Pick<Iteration, '_id' | 'label' | 'startDate' | 'duration' | 'number' | 'isBreak'>>
): IterationRange[] {
  return getAssignableIterations(list).map((it) => ({
    id: it._id,
    title: it.label,
    start: it.startDate,
    end: iterationEnd(it)
  }))
}

/**
 * @public
 */
export type IterationKeyword = 'current' | 'next' | 'previous'

/**
 * Resolves `@current`, `@next` and `@previous` with a `+N` / `-N` offset against the assignable
 * iterations. Breaks are skipped: during a break there is no current iteration, the next one is the
 * first that starts later and the previous one the last that has ended. Undefined when there is none.
 * @public
 */
export function resolveRelativeIteration<
  T extends Pick<Iteration, 'startDate' | 'duration' | 'number' | 'isBreak'>
> (list: readonly T[], keyword: IterationKeyword, offset: number, now: number): T | undefined {
  const sorted = getAssignableIterations(list)
  const current = sorted.findIndex((it) => getIterationState(it, now) === 'current')
  let base: number
  if (current >= 0) {
    base = keyword === 'current' ? current : keyword === 'next' ? current + 1 : current - 1
  } else if (keyword === 'current') {
    return undefined
  } else if (keyword === 'next') {
    base = sorted.findIndex((it) => it.startDate > now)
  } else {
    base = -1
    sorted.forEach((it, i) => {
      if (getIterationState(it, now) === 'completed') base = i
    })
  }
  if (base < 0) return undefined
  return sorted[base + offset]
}

/**
 * Iterations split by where they are in time. At most one iteration (or break) is current.
 * Every list is in calendar order and may contain breaks.
 * @public
 */
export interface IterationsByState<T> {
  completed: T[]
  current: T | undefined
  planned: T[]
}

/**
 * @public
 */
export function groupIterationsByState<T extends IterationSpan & Pick<Iteration, 'number'>> (
  list: readonly T[],
  now: number
): IterationsByState<T> {
  const res: IterationsByState<T> = { completed: [], current: undefined, planned: [] }
  for (const it of sortIterations(list)) {
    switch (getIterationState(it, now)) {
      case 'completed':
        res.completed.push(it)
        break
      case 'current':
        res.current = res.current ?? it
        break
      default:
        res.planned.push(it)
    }
  }
  return res
}

// ---- duration units ----

/**
 * @public
 */
export type IterationDurationUnit = 'days' | 'weeks'

/**
 * @public
 */
export function durationToDays (amount: number, unit: IterationDurationUnit): number {
  return Math.round(amount) * (unit === 'weeks' ? 7 : 1)
}

/**
 * The most natural unit of a duration: whole weeks when possible, days otherwise.
 * @public
 */
export function daysToDuration (days: number): { amount: number, unit: IterationDurationUnit } {
  return days >= 7 && days % 7 === 0 ? { amount: days / 7, unit: 'weeks' } : { amount: days, unit: 'days' }
}

// ---- planning changes ----

/**
 * @public
 */
export type IterationPlanError = 'overlap' | 'invalidDuration' | 'emptyLabel' | 'unknown'

/**
 * @public
 */
export interface IterationUpdate {
  id: Ref<Iteration>
  update: Partial<Pick<Iteration, 'label' | 'startDate' | 'duration'>>
}

/**
 * @public
 */
export type IterationPlan<T = unknown> =
  | ({ ok: true, updates: IterationUpdate[] } & T)
  | { ok: false, error: IterationPlanError }

/**
 * @public
 */
export type IterationChange = Partial<Pick<Iteration, 'label' | 'startDate' | 'duration'>>

type Planned = Pick<Iteration, '_id' | 'label' | 'number' | 'startDate' | 'duration' | 'isBreak'>

function isValidDuration (days: number): boolean {
  return Number.isInteger(days) && days >= 1
}

/**
 * Whether two iterations of one field share a day. Returns the ids of the first pair found.
 * @public
 */
export function findOverlap (
  list: ReadonlyArray<Pick<Iteration, '_id' | 'startDate' | 'duration' | 'number'>>
): [Ref<Iteration>, Ref<Iteration>] | undefined {
  const sorted = sortIterations(list)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startDate < iterationEndExclusive(sorted[i - 1])) return [sorted[i - 1]._id, sorted[i]._id]
  }
  return undefined
}

/**
 * Change the title, start date or duration of one iteration. When its end moves, every later
 * iteration moves by the same number of days, so the gaps between them stay and nothing overlaps.
 * A new start date that would run into the previous iteration is rejected.
 * @public
 */
export function planIterationChange (
  list: readonly Planned[],
  id: Ref<Iteration>,
  change: IterationChange
): IterationPlan {
  const sorted = sortIterations(list)
  const index = sorted.findIndex((it) => it._id === id)
  if (index < 0) return { ok: false, error: 'unknown' }
  const old = sorted[index]
  const label = change.label !== undefined ? change.label.trim() : old.label
  if (label === '') return { ok: false, error: 'emptyLabel' }
  const startDate = change.startDate !== undefined ? startOfDay(change.startDate) : old.startDate
  const duration = change.duration ?? old.duration
  if (!isValidDuration(duration)) return { ok: false, error: 'invalidDuration' }
  if (index > 0 && startDate < iterationEndExclusive(sorted[index - 1])) return { ok: false, error: 'overlap' }

  const own: IterationUpdate['update'] = {}
  if (label !== old.label) own.label = label
  if (startDate !== old.startDate) own.startDate = startDate
  if (duration !== old.duration) own.duration = duration
  const updates: IterationUpdate[] = Object.keys(own).length > 0 ? [{ id, update: own }] : []

  const shift = daysBetween(iterationEndExclusive(old), iterationEndExclusive({ startDate, duration }))
  if (shift !== 0) {
    for (const next of sorted.slice(index + 1)) {
      updates.push({ id: next._id, update: { startDate: addDays(next.startDate, shift) } })
    }
  }
  return { ok: true, updates }
}

/**
 * @public
 */
export interface AddIterationOptions {
  // Insert after this iteration; at the end when absent
  afterId?: Ref<Iteration>
  isBreak?: boolean
  // Days; defaults to the duration of the last iteration, or a week
  duration?: number
  label?: string
  // Start of the first iteration when there is none yet; defaults to today
  startDate?: number
  now: number
}

/**
 * A new iteration or break right after another one (or at the end). Everything that starts at or
 * after the new start moves by its duration. The result carries the values of the new document.
 * @public
 */
export function planAddIteration (
  list: readonly Planned[],
  options: AddIterationOptions
): IterationPlan<{ draft: IterationDraft }> {
  const sorted = sortIterations(list)
  const isBreak = options.isBreak === true
  const lastIteration = [...sorted].reverse().find((it) => it.isBreak !== true)
  const duration = options.duration ?? lastIteration?.duration ?? DEFAULT_ITERATION_DURATION
  if (!isValidDuration(duration)) return { ok: false, error: 'invalidDuration' }

  let startDate: number
  let following: Planned[] = []
  if (options.afterId === undefined) {
    const last = sorted[sorted.length - 1]
    startDate = last !== undefined ? iterationEndExclusive(last) : startOfDay(options.startDate ?? options.now)
  } else {
    const index = sorted.findIndex((it) => it._id === options.afterId)
    if (index < 0) return { ok: false, error: 'unknown' }
    startDate = iterationEndExclusive(sorted[index])
    following = sorted.slice(index + 1)
  }

  const number = isBreak ? 0 : Math.max(0, ...sorted.filter((it) => it.isBreak !== true).map((it) => it.number)) + 1
  const defaultLabel = isBreak ? 'Break' : `Iteration ${number}`
  const label = options.label?.trim() !== undefined && options.label.trim() !== '' ? options.label.trim() : defaultLabel
  const updates: IterationUpdate[] = following.map((it) => ({
    id: it._id,
    update: { startDate: addDays(it.startDate, duration) }
  }))
  const draft: IterationDraft = isBreak
    ? { label, number, startDate, duration, isBreak: true }
    : { label, number, startDate, duration }
  return { ok: true, updates, draft }
}

/**
 * @public
 */
export interface InitialIterationsOptions {
  now: number
  // Days, default a week
  duration?: number
  // Default 3, like GitHub
  count?: number
  // First day, default today
  startDate?: number
  // Title of the n-th iteration (1-based), default `Iteration n`
  labelOf?: (n: number) => string
}

/**
 * The iterations a new Iteration field starts with: consecutive, without gaps, the first one starting today.
 * @public
 */
export function generateInitialIterations (options: InitialIterationsOptions): IterationDraft[] {
  const duration = options.duration !== undefined && isValidDuration(options.duration) ? options.duration : DEFAULT_ITERATION_DURATION
  const count = options.count ?? DEFAULT_INITIAL_ITERATIONS
  let start = startOfDay(options.startDate ?? options.now)
  const res: IterationDraft[] = []
  for (let n = 1; n <= count; n++) {
    res.push({ label: options.labelOf?.(n) ?? `Iteration ${n}`, number: n, startDate: start, duration })
    start = addDays(start, duration)
  }
  return res
}

// ---- values stored on issues ----

type CustomFields = Record<string, unknown> | undefined

/**
 * New `customFields` for an issue after the iteration was deleted or the item moved: the value of
 * the field is replaced by `to` (a removal when `to` is null). Returns undefined when the issue does
 * not have `from` in that field, i.e. nothing has to change.
 * @public
 */
export function replaceIterationValue (
  customFields: CustomFields,
  fieldKey: string,
  from: string,
  to: string | null
): Record<string, unknown> | undefined {
  if (customFields === undefined || customFields[fieldKey] !== from) return undefined
  const { [fieldKey]: _removed, ...rest } = customFields
  return to === null ? rest : { ...rest, [fieldKey]: to }
}

/**
 * New `customFields` for an issue after iterations were deleted: every field in `dropped` (field key to
 * the ids of its deleted iterations) loses its value when it is one of them. Undefined when nothing changes.
 * @public
 */
export function stripIterationValues (
  customFields: CustomFields,
  dropped: ReadonlyMap<string, ReadonlySet<string>>
): Record<string, unknown> | undefined {
  if (customFields === undefined) return undefined
  let result: Record<string, unknown> | undefined
  for (const [key, ids] of dropped) {
    const value = (result ?? customFields)[key]
    if (typeof value !== 'string' || !ids.has(value)) continue
    result = result ?? { ...customFields }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete result[key]
  }
  return result
}

/**
 * The updates that move every item of an iteration to another one (or to none).
 * @public
 */
export function planMoveItems<T extends { _id: string, customFields?: Record<string, unknown> }> (
  issues: readonly T[],
  fieldKey: string,
  from: string,
  to: string | null
): Array<{ issue: T, customFields: Record<string, unknown> }> {
  if (from === to) return []
  const res: Array<{ issue: T, customFields: Record<string, unknown> }> = []
  for (const issue of issues) {
    const customFields = replaceIterationValue(issue.customFields, fieldKey, from, to)
    if (customFields !== undefined) res.push({ issue, customFields })
  }
  return res
}

// ---- group by / sort by ----

/**
 * Group values for an issue list grouped by an Iteration field: iterations in calendar order (only
 * those with issues unless `includeEmpty`), then ids that no iteration answers to (a deleted
 * iteration), and `undefined` (the "No iteration" group) last.
 * @public
 */
export function buildIterationGroupCategories (
  iterations: ReadonlyArray<Pick<Iteration, '_id' | 'startDate' | 'number' | 'isBreak'>>,
  docs: ReadonlyArray<{ customFields?: Record<string, unknown> }>,
  fieldKey: string,
  includeEmpty: boolean
): Array<string | undefined> {
  const used = new Set<string>()
  let hasEmpty = false
  for (const doc of docs) {
    const v = doc.customFields?.[fieldKey]
    if (typeof v === 'string' && v !== '') used.add(v)
    else hasEmpty = true
  }
  const result: Array<string | undefined> = []
  for (const it of getAssignableIterations(iterations)) {
    if (includeEmpty || used.has(it._id)) result.push(it._id)
    used.delete(it._id)
  }
  result.push(...used)
  if (hasEmpty || includeEmpty) result.push(undefined)
  return result
}

/**
 * Start dates by iteration id, to order issues by iteration.
 * @public
 */
export function iterationStartMap (
  iterations: ReadonlyArray<Pick<Iteration, '_id' | 'startDate'>>
): ReadonlyMap<string, number> {
  return new Map(iterations.map((it) => [it._id, it.startDate]))
}

// ---- display ----

/**
 * "Oct 3 – Oct 9", with the year when a date is not in the year of `now`.
 * @public
 */
export function formatIterationRange (it: IterationSpan, now: number, locale?: string): string {
  const start = new Date(it.startDate)
  const end = new Date(iterationEnd(it))
  const thisYear = new Date(now).getFullYear()
  const withYear = start.getFullYear() !== thisYear || end.getFullYear() !== thisYear
  const format = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {})
  })
  return `${format.format(start)} – ${format.format(end)}`
}
