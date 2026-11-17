// SPDX-License-Identifier: EPL-2.0

import { convertTimeZone, getTimeZoneName } from '../components/calendar/internal/DateUtils'

// Avoid loading the UI barrel's Svelte components when testing date utilities.
jest.mock('..', () => ({}))

describe('time zone labels', () => {
  it.each(['Europe/Kiev', 'Europe/Kyiv'])('displays Kyiv for %s', (id) => {
    expect(getTimeZoneName(id)).toBe('Kyiv')
  })

  it.each(['Europe/Kiev', 'Europe/Kyiv'])('displays Kyiv in popup labels and preserves the ID for %s', (id) => {
    expect(convertTimeZone(id)).toEqual({ id, continent: 'Europe', city: 'Kyiv', short: 'Kyiv' })
  })

  it.each(['Europe/Kiev', 'Europe/Kyiv'])('displays Kyiv for the browser time zone %s', (timeZone) => {
    const resolvedOptions = new Intl.DateTimeFormat().resolvedOptions()
    const spy = jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...resolvedOptions,
      timeZone
    })

    try {
      expect(getTimeZoneName()).toBe('Kyiv')
    } finally {
      spy.mockRestore()
    }
  })

  it.each([
    ['Europe/London', 'Europe', 'London', 'London', 'London'],
    ['America/New_York', 'America', 'New York', 'New York', 'New York'],
    ['America/Argentina/Buenos_Aires', 'America', 'Argentina - Buenos Aires', 'Buenos Aires', 'Argentina'],
    ['UTC', 'UTC', 'UTC', 'UTC', ''],
    ['', '', '', '', '']
  ])('preserves labels for %s', (id, continent, city, short, name) => {
    expect(getTimeZoneName(id)).toBe(name)
    expect(convertTimeZone(id)).toEqual({ id, continent, city, short })
  })
})
