// SPDX-License-Identifier: EPL-2.0

import { isPlannedTodoVisible } from '../components/planned-todos'

describe('Planned to-do visibility', () => {
  const today = new Date(2026, 9, 20, 12)
  const slot = (
    day: number,
    hour: number = 10,
    endDay: number = day,
    endHour: number = hour + 1
  ): { date: number, dueDate: number } => ({
    date: new Date(2026, 9, day, hour).getTime(),
    dueDate: new Date(2026, 9, endDay, endHour).getTime()
  })

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(today)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps a to-do scheduled several days ahead', () => {
    expect(isPlannedTodoVisible(slot(23), today)).toBe(true)
  })

  it('keeps a to-do scheduled at midnight tomorrow', () => {
    expect(isPlannedTodoVisible(slot(21, 0), today)).toBe(true)
  })

  it('keeps an ongoing workslot that ends tomorrow', () => {
    expect(isPlannedTodoVisible(slot(20, 11, 21, 1), today)).toBe(true)
  })

  it('keeps overdue and later-today workslots', () => {
    expect(isPlannedTodoVisible(slot(19), today)).toBe(true)
    expect(isPlannedTodoVisible(slot(20, 15), today)).toBe(true)
  })

  it('keeps to-dos without a workslot lookup', () => {
    expect(isPlannedTodoVisible(undefined, today)).toBe(true)
    expect(isPlannedTodoVisible(undefined, new Date(2026, 9, 23))).toBe(true)
  })

  it('matches the workslot start date when viewing another date', () => {
    const selected = new Date(2026, 9, 23, 23, 59, 59, 999)

    expect(isPlannedTodoVisible(slot(23), selected)).toBe(true)
    expect(isPlannedTodoVisible(slot(22), selected)).toBe(false)
    expect(isPlannedTodoVisible(slot(24), selected)).toBe(false)
  })

  it('does not mutate the selected date', () => {
    const selected = new Date(2026, 9, 23, 15)
    const timestamp = selected.getTime()

    isPlannedTodoVisible(slot(23), selected)

    expect(selected.getTime()).toBe(timestamp)
  })
})
