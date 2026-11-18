// SPDX-License-Identifier: EPL-2.0
import type { Filter } from '@hcengineering/view'
import { dateWeek, dateNextWeek } from '../filter'
import { deviceOptionsStore as deviceInfo } from '@hcengineering/ui'

jest.mock('@hcengineering/core', () => ({ __esModule: true, default: {} }))
jest.mock('@hcengineering/platform', () => ({}))
jest.mock('@hcengineering/presentation', () => ({}))
jest.mock('@hcengineering/ui', () => ({
  deviceOptionsStore: jest.requireActual('svelte/store').writable({ firstDayOfWeek: 1 })
}))
jest.mock('../plugin', () => ({ __esModule: true, default: {} }))

const filter = { value: [] } as unknown as Filter
const local = (value: string): number => new Date(value).getTime()

describe('calendar week filter boundaries', () => {
  afterEach(() => jest.useRealTimers())

  it.each([
    ['2026-03-22T12:00:00', '2026-03-16', '2026-03-22', '2026-03-23', '2026-03-29'],
    ['2026-03-23T00:00:00', '2026-03-23', '2026-03-29', '2026-03-30', '2026-04-05'],
    ['2026-03-29T23:59:59', '2026-03-23', '2026-03-29', '2026-03-30', '2026-04-05'],
    ['2026-10-18T12:00:00', '2026-10-12', '2026-10-18', '2026-10-19', '2026-10-25'],
    ['2026-10-25T12:00:00', '2026-10-19', '2026-10-25', '2026-10-26', '2026-11-01'],
    ['2026-12-31T12:00:00', '2026-12-28', '2027-01-03', '2027-01-04', '2027-01-10']
  ])('ends on Sunday, excluding the following Monday, at %s', async (now, start, end, nextStart, nextEnd) => {
    jest.useFakeTimers().setSystemTime(new Date(now))
    deviceInfo.update((info) => ({ ...info, firstDayOfWeek: 1 }))
    expect(await dateWeek(filter)).toEqual({ $gte: local(`${start}T00:00:00.000`), $lte: local(`${end}T23:59:59.999`) })
    expect(await dateNextWeek(filter)).toEqual({
      $gte: local(`${nextStart}T00:00:00.000`),
      $lte: local(`${nextEnd}T23:59:59.999`)
    })
  })

  it.each([0, 7])('uses a Sunday locale/calendar week start (%i)', async (firstDayOfWeek) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-29T12:00:00'))
    deviceInfo.update((info) => ({ ...info, firstDayOfWeek }))
    expect(await dateWeek(filter)).toEqual({
      $gte: local('2026-03-29T00:00:00'),
      $lte: local('2026-04-04T23:59:59.999')
    })
    expect(await dateNextWeek(filter)).toEqual({
      $gte: local('2026-04-05T00:00:00'),
      $lte: local('2026-04-11T23:59:59.999')
    })
  })

  it.each([
    ['2026-03-29T12:00:00', '2026-03-23T00:00:00', '2026-03-30T00:00:00'],
    ['2026-10-25T12:00:00', '2026-10-19T00:00:00', '2026-10-26T00:00:00']
  ])('uses local calendar days across DST at %s', async (now, firstMonday, followingMonday) => {
    jest.useFakeTimers().setSystemTime(new Date(now))
    deviceInfo.update((info) => ({ ...info, firstDayOfWeek: 1 }))
    const range = await dateWeek(filter)
    const start = new Date(firstMonday)
    const next = new Date(followingMonday)
    // The offset change gives 167/169 hours in Central Europe and 168 in UTC.
    const hours = 168 + (next.getTimezoneOffset() - start.getTimezoneOffset()) / 60
    expect((Number(range.$lte) - Number(range.$gte) + 1) / 3600000).toBe(hours)
  })
})
