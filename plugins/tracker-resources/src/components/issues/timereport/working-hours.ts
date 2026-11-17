//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { type Project } from '@hcengineering/tracker'

/** Hours in a working day when the project does not configure `hoursPerDay`. */
export const DEFAULT_HOURS_PER_DAY = 8

const MINUTES_PER_HOUR = 60

/**
 * Normalizes a user-entered hours-per-day value: anything that is not a
 * number in [0.01, 24] counts as "not configured" (`undefined`).
 */
export function normalizeHoursPerDay (value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.01 || value > 24) return undefined
  return value
}

/** Hours in a working day for the given project, falling back to {@link DEFAULT_HOURS_PER_DAY}. */
export function getHoursPerDay (project: Pick<Project, 'hoursPerDay'> | undefined): number {
  return normalizeHoursPerDay(project?.hoursPerDay) ?? DEFAULT_HOURS_PER_DAY
}

export interface TimeParts {
  days: number
  hours: number
  minutes: number
}

/**
 * Splits a time value stored in hours into working days, hours and minutes.
 * Preserve the configured day boundary, rounding only the displayed remainder
 * to whole minutes so rounding (e.g. 0.999h) never yields "60m".
 */
export function splitTime (value: number, hoursPerDay: number = DEFAULT_HOURS_PER_DAY, hoursOnly = false): TimeParts {
  const total = Math.round(value * MINUTES_PER_HOUR)
  if (!Number.isFinite(total) || total <= 0) return { days: 0, hours: 0, minutes: 0 }
  if (hoursOnly) return { days: 0, hours: Math.floor(total / MINUTES_PER_HOUR), minutes: total % MINUTES_PER_HOUR }
  const dayHours = normalizeHoursPerDay(hoursPerDay) ?? DEFAULT_HOURS_PER_DAY
  const quotient = value / dayHours
  const nearestDay = Math.round(quotient)
  // Decimal inputs can place an exact multiple one floating-point step below
  // its integer boundary. Resolve that boundary before rounding the minutes.
  const tolerance = Number.EPSILON * Math.max(1, quotient) * 2
  const wholeDays = Math.abs(quotient - nearestDay) <= tolerance ? nearestDay : quotient
  let days = Math.floor(wholeDays)
  let rest = Math.max(0, Math.round((value - days * dayHours) * MINUTES_PER_HOUR))
  if (rest >= dayHours * MINUTES_PER_HOUR) {
    days++
    rest = 0
  }
  return { days, hours: Math.floor(rest / MINUTES_PER_HOUR), minutes: rest % MINUTES_PER_HOUR }
}

/**
 * Project update for a changed hours-per-day setting: `undefined` when
 * nothing changed, `$unset` when the setting was cleared (never write
 * `undefined`), the new value otherwise.
 */
export function hoursPerDayUpdate (
  next: number | null | undefined,
  prev: number | null | undefined
): { hoursPerDay: number } | { $unset: { hoursPerDay: true } } | undefined {
  const value = normalizeHoursPerDay(next)
  if (value === normalizeHoursPerDay(prev)) return undefined
  return value === undefined ? { $unset: { hoursPerDay: true } } : { hoursPerDay: value }
}
