// SPDX-License-Identifier: EPL-2.0

import core, { type Doc, SortingOrder, type Ref } from '@hcengineering/core'
import activity, { type DisplayDocUpdateMessage, type DocUpdateMessage } from '@hcengineering/activity'
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

function asStringUpdates (messages: DocUpdateMessage[]): DocUpdateMessage[] {
  for (const message of messages) {
    if (message.attributeUpdates !== undefined) message.attributeUpdates.attrClass = core.class.TypeString
  }
  return messages
}

function collectionMessage (id: string, author: string, action: 'create' | 'remove', time: number): DocUpdateMessage {
  return {
    ...message(id, author, '', '', time),
    objectId: `child-${id}` as Ref<Doc>,
    action,
    updateCollection: 'children',
    attributeUpdates: undefined
  }
}

it.each([SortingOrder.Ascending, SortingOrder.Descending])('renders A/B/A with exact diffs (%s)', (order) => {
  const messages = [
    message('1', 'A', '', 'a', 100),
    message('2', 'B', 'a', 'ab', 101),
    message('3', 'A', 'ab', 'abc', 102)
  ]
  const expected = order === SortingOrder.Ascending ? messages : [...messages].reverse()
  const diffs = (messages: DocUpdateMessage[]): unknown[] =>
    messages.map(({ createdBy, attributeUpdates }) => [createdBy, attributeUpdates?.prevValue, attributeUpdates?.set])
  // Timelines pass messages chronologically; the grouping must not depend on it.
  for (const input of [messages, [...messages].reverse()]) {
    expect(diffs(combineActivityMessages(input, order) as DocUpdateMessage[])).toEqual(diffs(expected))
  }
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

it('keeps unrelated attributes outside collaborative author barriers', () => {
  const first = message('1', 'A', '', 'a', 100)
  const middle = message('2', 'B', '', 'other', 101)
  if (middle.attributeUpdates !== undefined) middle.attributeUpdates.attrKey = 'other'
  const last = message('3', 'A', 'a', 'ab', 102)
  expect(combineActivityMessages([first, middle, last])).toHaveLength(2)
})

it('retains existing grouping for non-markup attributes', () => {
  const messages = asStringUpdates([
    message('1', 'A', '', 'a', 100),
    message('2', 'B', 'a', 'ab', 101),
    message('3', 'A', 'a', 'abc', 102)
  ])
  const result = combineActivityMessages(messages) as DisplayDocUpdateMessage[]
  expect(result.map(({ createdBy, combinedMessagesIds }) => [createdBy, combinedMessagesIds])).toEqual([
    ['B', ['2']],
    ['A', ['1', '3']]
  ])
})

it('keeps the five-minute window for non-markup updates', () => {
  const minute = 60 * 1000
  const messages = asStringUpdates([
    message('1', 'A', '', 'a', minute),
    message('2', 'A', 'a', 'ab', 5 * minute),
    message('3', 'A', 'ab', 'abc', 9 * minute),
    message('4', 'A', 'abc', 'abcd', 13 * minute)
  ])
  const result = combineActivityMessages(messages) as DisplayDocUpdateMessage[]
  expect(result.map(({ combinedMessagesIds }) => combinedMessagesIds)).toEqual([
    ['1', '2'],
    ['3', '4']
  ])
})

it('pulls non-combinable messages out of non-markup groups instead of splitting them', () => {
  const [first, middle, last] = asStringUpdates([
    message('1', 'A', '', 'a', 100),
    message('2', 'A', 'a', 'ab', 101),
    message('3', 'A', 'ab', 'abc', 102)
  ])
  middle.reactions = 1
  const result = combineActivityMessages([first, middle, last]) as DisplayDocUpdateMessage[]
  expect(result.map(({ _id, combinedMessagesIds }) => [_id, combinedMessagesIds])).toEqual([
    ['2', undefined],
    ['3', ['1', '3']]
  ])
})

it('keeps create and remove groups per author', () => {
  const messages = [
    collectionMessage('1', 'A', 'remove', 100),
    collectionMessage('2', 'A', 'create', 101),
    collectionMessage('3', 'B', 'remove', 102)
  ]
  const result = combineActivityMessages(messages) as DisplayDocUpdateMessage[]
  expect(result.map(({ _id, combinedMessagesIds }) => [_id, combinedMessagesIds])).toEqual([
    ['2', ['1', '2']],
    ['3', undefined]
  ])
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
