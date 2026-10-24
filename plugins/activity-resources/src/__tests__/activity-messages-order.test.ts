// SPDX-License-Identifier: EPL-2.0

import { type ActivityMessage } from '@hcengineering/activity'
import { SortingOrder } from '@hcengineering/core'
import type * as ActivityMessagesUtils from '../activityMessagesUtils'

jest.mock(
  '@hcengineering/core',
  () => ({
    __esModule: true,
    default: { class: {} },
    SortingOrder: { Ascending: 1, Descending: -1 }
  }),
  { virtual: true }
)
jest.mock('@hcengineering/view', () => ({}), { virtual: true })
jest.mock('@hcengineering/presentation', () => ({}), { virtual: true })
jest.mock('@hcengineering/view-resources', () => ({}), { virtual: true })
jest.mock('@hcengineering/contact', () => ({}), { virtual: true })
jest.mock('@hcengineering/activity', () => ({}), { virtual: true })

Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null },
  configurable: true
})

const { activityMessagesComparator, sortActivityMessages } =
  jest.requireActual<typeof ActivityMessagesUtils>('../activityMessagesUtils')

function message (_id: string, createdOn?: number, modifiedOn = 100): ActivityMessage {
  return { _id, createdOn, modifiedOn } as unknown as ActivityMessage
}

describe('activity message ordering', () => {
  const messages = [message('c', 100), message('a', 100), message('b', 100), message('z', 99)]

  it('uses IDs to give clients and reloads the same order for equal timestamps', () => {
    for (const input of [messages, [...messages].reverse(), [messages[2], messages[0], messages[3], messages[1]]]) {
      expect(sortActivityMessages([...input]).map(({ _id }) => _id)).toEqual(['z', 'a', 'b', 'c'])
    }
  })

  it('reverses both timestamp and ID for descending order', () => {
    expect(sortActivityMessages([...messages], SortingOrder.Descending).map(({ _id }) => _id)).toEqual([
      'c',
      'b',
      'a',
      'z'
    ])
  })

  it('preserves the modifiedOn fallback and compares identical messages equally', () => {
    expect(activityMessagesComparator(message('a'), message('b', 100))).toBeLessThan(0)
    expect(activityMessagesComparator(message('a', 0), message('b', 1))).toBeLessThan(0)
    expect(activityMessagesComparator(message('a', 100), message('a', 100))).toBe(0)
  })
})
