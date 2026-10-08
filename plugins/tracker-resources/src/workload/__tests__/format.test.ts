//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { formatAmount, formatLoadValue, formatPercent } from '../format'

describe('format', () => {
  it('prints amounts with at most one decimal and no trailing zeros', () => {
    expect(formatAmount(8, 'en')).toBe('8')
    expect(formatAmount(2.5, 'en')).toBe('2.5')
    expect(formatAmount(2.549, 'en')).toBe('2.5')
    expect(formatAmount(2.55, 'en', 2)).toBe('2.55')
    expect(formatAmount(1234.5, 'en')).toBe('1,234.5')
  })

  it('is safe for numbers that are not finite and for negative zero', () => {
    expect(formatAmount(Number.NaN, 'en')).toBe('0')
    expect(formatAmount(Infinity, 'en')).toBe('0')
    expect(formatAmount(-0.01, 'en')).toBe('0')
    expect(formatLoadValue(Number.NaN, 'estimate', 'en')).toBe('0h')
  })

  it('adds hours for the time measures only', () => {
    expect(formatLoadValue(12, 'estimate', 'en')).toBe('12h')
    expect(formatLoadValue(12.5, 'remaining', 'en')).toBe('12.5h')
    expect(formatLoadValue(12, 'count', 'en')).toBe('12')
    expect(formatLoadValue(12, 'field', 'en')).toBe('12')
  })

  it('prints percents', () => {
    expect(formatPercent(1, 'en')).toBe('100%')
    expect(formatPercent(0.834, 'en')).toBe('83%')
    expect(formatPercent(Number.NaN, 'en')).toBe('0%')
  })
})
