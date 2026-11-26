// SPDX-License-Identifier: EPL-2.0

import {
  firstDayOfWeekStorageKey,
  parseFirstDayOfWeek,
  resolveFirstDayOfWeek,
  saveFirstDayOfWeek
} from '../firstDayOfWeek'

describe('first day of the week', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it.each([null, undefined, '', 'system'])('follows the system when the stored value is %p', (stored) => {
    expect(parseFirstDayOfWeek(stored)).toBe('system')
  })

  it.each([
    ['0', 0],
    ['1', 1],
    ['6', 6]
  ])('reads the stored day %p', (stored, expected) => {
    expect(parseFirstDayOfWeek(stored)).toBe(expected)
  })

  it.each(['7', '-1', 'NaN', 'monday', '1.5'])('falls back to the system for the invalid value %p', (stored) => {
    expect(parseFirstDayOfWeek(stored)).toBe('system')
  })

  it('uses the locale week start for the system preference', () => {
    expect(resolveFirstDayOfWeek('system', 7)).toBe(7)
    expect(resolveFirstDayOfWeek('system', 1)).toBe(1)
  })

  it('uses the chosen day over the locale week start', () => {
    expect(resolveFirstDayOfWeek(0, 1)).toBe(0)
  })

  it('stores the preference on this device under the existing key', () => {
    saveFirstDayOfWeek(0)
    expect(localStorage.getItem(firstDayOfWeekStorageKey)).toBe('0')
    expect(firstDayOfWeekStorageKey).toBe('firstDayOfWeek')

    saveFirstDayOfWeek('system')
    expect(localStorage.getItem(firstDayOfWeekStorageKey)).toBe('system')
  })
})
