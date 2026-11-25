// SPDX-License-Identifier: EPL-2.0

import type { Client, Ref } from '@hcengineering/core'
import time, { type ToDo, type WorkSlot } from '@hcengineering/time'
import tracker, { type Issue } from '@hcengineering/tracker'
import { getToDoSlotDuration } from '../utils'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

const NOW = new Date(2026, 9, 23, 9).getTime()
const HOUR = 60 * 60 * 1000

describe('getToDoSlotDuration', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('loads and subtracts the ToDo’s future workslots from its issue estimate', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
    const issue = { estimation: 8, reportedTime: 1 }
    const workslots = [
      { date: NOW + HOUR, dueDate: NOW + 2 * HOUR },
      { date: NOW + 3 * HOUR, dueDate: NOW + 4.5 * HOUR }
    ] as WorkSlot[]
    const client = {
      getHierarchy: () => ({ isDerived: () => true }),
      findOne: jest.fn().mockResolvedValue(issue),
      findAll: jest.fn().mockResolvedValue(workslots)
    } as unknown as Client
    const todo = {
      _id: 'todo' as Ref<ToDo>,
      attachedTo: 'issue' as Ref<Issue>,
      attachedToClass: tracker.class.Issue
    } as unknown as ToDo

    await expect(getToDoSlotDuration(client, todo, NOW)).resolves.toBe(4.5 * HOUR)
    expect(client.findOne).toHaveBeenCalledWith(tracker.class.Issue, { _id: todo.attachedTo })
    expect(client.findAll).toHaveBeenCalledWith(time.class.WorkSlot, {
      attachedTo: todo._id,
      date: { $gte: NOW }
    })
  })
})
