// SPDX-License-Identifier: EPL-2.0

import core, { SortingOrder, type Ref } from '@hcengineering/core'
import activity, { type DocUpdateMessage } from '@hcengineering/activity'
import { combineActivityMessages } from '../activityMessagesUtils'

jest.mock('@hcengineering/presentation', () => ({
  getClient: () => ({ getHierarchy: () => ({ isDerived: () => false }) })
}))
jest.mock('@hcengineering/view-resources', () => ({}))

function message (id: string, author: string, prev: string, curr: string, time: number): DocUpdateMessage {
  return {
    _id: id as Ref<DocUpdateMessage>,
    _class: activity.class.DocUpdateMessage,
    space: 'space',
    collection: 'docUpdateMessages',
    attachedTo: 'doc',
    attachedToClass: 'document',
    objectId: 'doc',
    objectClass: 'document',
    createdBy: author,
    modifiedBy: author,
    createdOn: time,
    modifiedOn: time,
    action: 'update',
    attributeUpdates: {
      attrKey: 'content',
      attrClass: core.class.TypeMarkup,
      prevValue: prev,
      set: [curr],
      added: [],
      removed: [],
      isMixin: false
    }
  } as unknown as DocUpdateMessage
}

it.each([SortingOrder.Ascending, SortingOrder.Descending])('renders A/B/A with exact diffs (%s)', (order) => {
  const messages = [
    message('1', 'A', '', 'a', 100),
    message('2', 'B', 'a', 'ab', 101),
    message('3', 'A', 'ab', 'abc', 102)
  ]
  const result = combineActivityMessages([...messages].reverse(), order) as DocUpdateMessage[]
  const expected = order === SortingOrder.Ascending ? messages : [...messages].reverse()
  const diffs = (messages: DocUpdateMessage[]): unknown[] =>
    messages.map(({ createdBy, attributeUpdates }) => [createdBy, attributeUpdates?.prevValue, attributeUpdates?.set])
  expect(diffs(result)).toEqual(diffs(expected))
})

it('only combines consecutive compatible diffs without mutating raw records', () => {
  const messages = [message('1', 'A', '', 'a', 100), message('2', 'A', 'a', 'ab', 101)]
  const before = JSON.stringify(messages)
  const result = combineActivityMessages(messages) as DocUpdateMessage[]
  expect(result).toHaveLength(1)
  expect(result[0].attributeUpdates).toMatchObject({ prevValue: '', set: ['ab'] })
  expect(JSON.stringify(messages)).toBe(before)
  messages.push(message('3', 'A', 'unknown', 'abc', 102))
  expect(combineActivityMessages(messages)).toHaveLength(2)
})

it('keeps author barriers for reacted messages and immediately after creation', () => {
  const first = message('1', 'A', '', 'a', 100)
  const middle = { ...message('2', 'B', 'a', 'ab', 101), reactions: 1 }
  const last = message('3', 'A', 'ab', 'abc', 102)
  const create = {
    ...first,
    _id: 'create' as Ref<DocUpdateMessage>,
    createdBy: 'creator' as DocUpdateMessage['createdBy'],
    action: 'create' as const,
    createdOn: 99,
    attributeUpdates: undefined
  }
  expect(combineActivityMessages([create, first, middle, last])).toHaveLength(4)
})

it('does not merge across a different author editing another attribute', () => {
  const first = message('1', 'A', '', 'a', 100)
  const middle = message('2', 'B', '', 'other', 101)
  if (middle.attributeUpdates !== undefined) middle.attributeUpdates.attrKey = 'other'
  const last = message('3', 'A', 'a', 'ab', 102)
  expect(combineActivityMessages([first, middle, last])).toHaveLength(3)
})

it('folds initial markup into creation for the creator and preserves other authors', () => {
  const first = message('1', 'A', '', 'a', 100)
  const create = {
    ...first,
    _id: 'create' as Ref<DocUpdateMessage>,
    action: 'create' as const,
    createdOn: 99,
    attributeUpdates: undefined
  }
  const other = message('2', 'B', 'a', 'ab', 101)
  expect(combineActivityMessages([create, first, other]).map(({ _id }) => _id)).toEqual(['create', '2'])
})
