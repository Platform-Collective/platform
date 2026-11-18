//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { formatTimeReportValue, parseTimeReportValue } from '../timeReportValue'

describe('parseTimeReportValue', () => {
  it('parses decimal hours', () => {
    expect(parseTimeReportValue('2')).toBe(2)
    expect(parseTimeReportValue('1.5')).toBe(1.5)
    expect(parseTimeReportValue('1,5')).toBe(1.5)
    expect(parseTimeReportValue('.25')).toBe(0.25)
    expect(parseTimeReportValue(' 3 ')).toBe(3)
  })

  it('parses minutes', () => {
    expect(parseTimeReportValue('4m')).toBeCloseTo(4 / 60)
    expect(parseTimeReportValue('45m')).toBe(0.75)
    expect(parseTimeReportValue('90 min')).toBe(1.5)
    expect(parseTimeReportValue('30 minutes')).toBe(0.5)
  })

  it('parses hours and minutes', () => {
    expect(parseTimeReportValue('1h 30m')).toBe(1.5)
    expect(parseTimeReportValue('1h30m')).toBe(1.5)
    expect(parseTimeReportValue('1H 15M')).toBe(1.25)
    expect(parseTimeReportValue('2h')).toBe(2)
    expect(parseTimeReportValue('1.5h')).toBe(1.5)
    expect(parseTimeReportValue('2 hours 15 mins')).toBe(2.25)
    expect(parseTimeReportValue('1h30')).toBe(1.5)
  })

  it('parses clock notation', () => {
    expect(parseTimeReportValue('1:30')).toBe(1.5)
    expect(parseTimeReportValue('0:45')).toBe(0.75)
    expect(parseTimeReportValue('10:05')).toBeCloseTo(10 + 5 / 60)
  })

  it('keeps the sign for corrections', () => {
    expect(parseTimeReportValue('-1.5')).toBe(-1.5)
    expect(parseTimeReportValue('-30m')).toBe(-0.5)
    expect(parseTimeReportValue('-1:30')).toBe(-1.5)
  })

  it('accepts localized unit labels', () => {
    expect(parseTimeReportValue('1 Std 30 Min', ['Std'], ['Min'])).toBe(1.5)
    expect(parseTimeReportValue('2ч 15м', ['ч'], ['м'])).toBe(2.25)
    expect(parseTimeReportValue('1小时30分', ['小时'], ['分'])).toBe(1.5)
  })

  it('rejects empty and invalid input', () => {
    expect(parseTimeReportValue(undefined)).toBeUndefined()
    expect(parseTimeReportValue('')).toBeUndefined()
    expect(parseTimeReportValue('   ')).toBeUndefined()
    expect(parseTimeReportValue('-')).toBeUndefined()
    expect(parseTimeReportValue('abc')).toBeUndefined()
    expect(parseTimeReportValue('1x')).toBeUndefined()
    expect(parseTimeReportValue('1:75')).toBeUndefined()
    expect(parseTimeReportValue('30m 1h')).toBeUndefined()
    expect(parseTimeReportValue('1h 2h')).toBeUndefined()
    expect(parseTimeReportValue('10m 5m')).toBeUndefined()
    expect(parseTimeReportValue('1 2')).toBeUndefined()
    expect(parseTimeReportValue('1.2.3')).toBeUndefined()
  })
})

describe('formatTimeReportValue', () => {
  it('formats hours and minutes', () => {
    expect(formatTimeReportValue(undefined)).toBe('')
    expect(formatTimeReportValue(0)).toBe('0m')
    expect(formatTimeReportValue(0.25)).toBe('15m')
    expect(formatTimeReportValue(1)).toBe('1h')
    expect(formatTimeReportValue(1.5)).toBe('1h 30m')
    expect(formatTimeReportValue(4 / 60)).toBe('4m')
    expect(formatTimeReportValue(12)).toBe('12h')
    expect(formatTimeReportValue(-0.5)).toBe('-30m')
  })

  it('round-trips through the parser', () => {
    for (const value of [0.25, 0.5, 1, 1.75, 8, 12.5, 4 / 60, -2]) {
      expect(parseTimeReportValue(formatTimeReportValue(value))).toBeCloseTo(value)
    }
  })
})
