// SPDX-License-Identifier: EPL-2.0

import {
  ActivityUpdateType,
  MessageType,
  type ActivityMessage,
  type MessageID
} from '@hcengineering/communication-types'
import { mergeActivityMessages } from '../activity'

jest.mock('@hcengineering/view-resources', () => ({}))

function message (id: string, creator: string, prev: string, value: string): ActivityMessage {
  return {
    id: id as MessageID,
    creator,
    cardId: 'card',
    type: MessageType.Activity,
    content: '',
    created: new Date(Number(id)),
    reactions: {},
    attachments: [],
    threads: [],
    extra: {
      action: 'update',
      update: { type: ActivityUpdateType.CollaborativeChange, attrKey: 'content', prevValue: prev, value }
    }
  } as unknown as ActivityMessage
}

it('keeps A/B/A collaborative activity separate with exact authors and diffs', () => {
  const messages = [message('1', 'A', '', 'a'), message('2', 'B', 'a', 'ab'), message('3', 'A', 'ab', 'abc')]
  expect(mergeActivityMessages(messages)).toEqual(messages)
})

it('merges contiguous compatible runs without mutating cached source messages', () => {
  const messages = [message('1', 'A', '', 'a'), message('2', 'A', 'a', 'ab')]
  const before = JSON.stringify(messages)
  const result = mergeActivityMessages(messages) as ActivityMessage[]
  expect(result).toHaveLength(1)
  expect(result[0].extra.update).toMatchObject({ prevValue: '', value: 'ab' })
  expect(JSON.stringify(messages)).toBe(before)
  expect(mergeActivityMessages([messages[0], message('3', 'A', 'unknown', 'abc')])).toHaveLength(2)
})

it('keeps distinct attributes and cards separate', () => {
  const first = message('1', 'A', '', 'a')
  const second = message('2', 'A', 'a', 'ab')
  if (second.extra.update?.type === ActivityUpdateType.CollaborativeChange) second.extra.update.attrKey = 'other'
  expect(mergeActivityMessages([first, second])).toHaveLength(2)
  second.cardId = 'other' as ActivityMessage['cardId']
  expect(mergeActivityMessages([first, second])).toHaveLength(2)
})
