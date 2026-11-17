//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//
import {
  DEFAULT_HOURS_PER_DAY,
  getHoursPerDay,
  hoursPerDayUpdate,
  normalizeHoursPerDay,
  splitTime
} from '../working-hours'

describe('normalizeHoursPerDay', () => {
  it('accepts values in [0.01, 24]', () => {
    expect(normalizeHoursPerDay(0.01)).toBe(0.01)
    expect(normalizeHoursPerDay(6)).toBe(6)
    expect(normalizeHoursPerDay(7.5)).toBe(7.5)
    expect(normalizeHoursPerDay(24)).toBe(24)
  })

  it('treats empty and out-of-range values as not configured', () => {
    expect(normalizeHoursPerDay(undefined)).toBeUndefined()
    expect(normalizeHoursPerDay(null)).toBeUndefined()
    expect(normalizeHoursPerDay(0)).toBeUndefined()
    expect(normalizeHoursPerDay(0.001)).toBeUndefined()
    expect(normalizeHoursPerDay(-1)).toBeUndefined()
    expect(normalizeHoursPerDay(25)).toBeUndefined()
    expect(normalizeHoursPerDay(NaN)).toBeUndefined()
  })
})

describe('getHoursPerDay', () => {
  it('falls back to 8 hours', () => {
    expect(DEFAULT_HOURS_PER_DAY).toBe(8)
    expect(getHoursPerDay(undefined)).toBe(8)
    expect(getHoursPerDay({})).toBe(8)
    expect(getHoursPerDay({ hoursPerDay: 0 })).toBe(8)
  })

  it('uses the project setting', () => {
    expect(getHoursPerDay({ hoursPerDay: 6 })).toBe(6)
  })
})

describe('splitTime', () => {
  it('keeps mixed-project totals in hours instead of assuming an eight-hour day', () => {
    expect(splitTime(15, 7.5, true)).toEqual({ days: 0, hours: 15, minutes: 0 })
    expect(splitTime(8.999, 8, true)).toEqual({ days: 0, hours: 9, minutes: 0 })
  })

  it('keeps the legacy 8-hour day by default', () => {
    expect(splitTime(12)).toEqual({ days: 1, hours: 4, minutes: 0 })
    expect(splitTime(1.5)).toEqual({ days: 0, hours: 1, minutes: 30 })
    expect(splitTime(16.25)).toEqual({ days: 2, hours: 0, minutes: 15 })
  })

  it('uses the configured day length', () => {
    expect(splitTime(12, 6)).toEqual({ days: 2, hours: 0, minutes: 0 })
    expect(splitTime(12, 24)).toEqual({ days: 0, hours: 12, minutes: 0 })
    expect(splitTime(24, 24)).toEqual({ days: 1, hours: 0, minutes: 0 })
  })

  it('supports fractional day lengths', () => {
    expect(splitTime(15, 7.5)).toEqual({ days: 2, hours: 0, minutes: 0 })
    expect(splitTime(10, 7.5)).toEqual({ days: 1, hours: 2, minutes: 30 })
  })

  it('preserves sub-minute and decimal working-day boundaries', () => {
    expect(splitTime(1, 0.01)).toEqual({ days: 100, hours: 0, minutes: 0 })
    expect(splitTime(15.02, 7.51)).toEqual({ days: 2, hours: 0, minutes: 0 })
    expect(splitTime(7.51, 7.51)).toEqual({ days: 1, hours: 0, minutes: 0 })
    expect(splitTime(8.51, 7.51)).toEqual({ days: 1, hours: 1, minutes: 0 })
  })

  it('preserves floating-point exact decimal multiples', () => {
    expect(splitTime(0.21, 0.07)).toEqual({ days: 3, hours: 0, minutes: 0 })
    expect(splitTime(0.28, 0.07)).toEqual({ days: 4, hours: 0, minutes: 0 })
    expect(splitTime(0.2, 0.07)).toEqual({ days: 2, hours: 0, minutes: 4 })
  })

  it('rounds to whole minutes without producing 60 minutes', () => {
    expect(splitTime(0.999)).toEqual({ days: 0, hours: 1, minutes: 0 })
    expect(splitTime(7.9999)).toEqual({ days: 1, hours: 0, minutes: 0 })
    expect(splitTime(1 / 15)).toEqual({ days: 0, hours: 0, minutes: 4 })
  })

  it('returns zero for empty or negative values', () => {
    expect(splitTime(0)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(splitTime(-3)).toEqual({ days: 0, hours: 0, minutes: 0 })
    expect(splitTime(NaN)).toEqual({ days: 0, hours: 0, minutes: 0 })
  })

  it('ignores an invalid day length', () => {
    expect(splitTime(12, 0)).toEqual({ days: 1, hours: 4, minutes: 0 })
  })
})

describe('hoursPerDayUpdate (project dialog persistence)', () => {
  it('is a no-op when nothing changed', () => {
    expect(hoursPerDayUpdate(6, 6)).toBeUndefined()
    expect(hoursPerDayUpdate(undefined, undefined)).toBeUndefined()
    expect(hoursPerDayUpdate(null, undefined)).toBeUndefined()
    expect(hoursPerDayUpdate(0, undefined)).toBeUndefined()
  })

  it('treats a stored null as not configured', () => {
    expect(hoursPerDayUpdate(undefined, null)).toBeUndefined()
    expect(hoursPerDayUpdate(null, null)).toBeUndefined()
    expect(hoursPerDayUpdate(6, null)).toEqual({ hoursPerDay: 6 })
  })

  it('writes a new value', () => {
    expect(hoursPerDayUpdate(6, undefined)).toEqual({ hoursPerDay: 6 })
    expect(hoursPerDayUpdate(7.5, 6)).toEqual({ hoursPerDay: 7.5 })
  })

  it('unsets a cleared value', () => {
    expect(hoursPerDayUpdate(null, 6)).toEqual({ $unset: { hoursPerDay: true } })
    expect(hoursPerDayUpdate(undefined, 6)).toEqual({ $unset: { hoursPerDay: true } })
  })
})
