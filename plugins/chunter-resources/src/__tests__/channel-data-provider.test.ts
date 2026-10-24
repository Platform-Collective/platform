// SPDX-License-Identifier: EPL-2.0

import activity, { type ActivityMessage } from '@hcengineering/activity'
import type * as activityResources from '@hcengineering/activity-resources'
import { type Doc, type PersonId, type Ref, SortingOrder, type Space } from '@hcengineering/core'
import { createQuery, getClient } from '@hcengineering/presentation'
import { get } from 'svelte/store'
import type { ChannelDataProvider } from '../channelDataProvider'

jest.mock('@hcengineering/presentation', () => ({
  createQuery: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('@hcengineering/view-resources', () => ({}))
jest.mock('@hcengineering/activity-resources', () =>
  jest.requireActual('../../../activity-resources/src/activityMessagesUtils')
)

interface QueryMock {
  query: jest.Mock
  unsubscribe: jest.Mock
}

function message (id: string, createdOn: number | undefined = 100, modifiedOn = 100): ActivityMessage {
  return {
    _id: id as Ref<ActivityMessage>,
    _class: activity.class.ActivityMessage,
    space: 'space' as Ref<Space>,
    attachedTo: 'channel' as Ref<Doc>,
    attachedToClass: activity.class.ActivityMessage,
    collection: 'messages',
    modifiedBy: 'sender' as PersonId,
    modifiedOn,
    createdOn
  }
}

function ids (messages: ActivityMessage[]): string[] {
  return messages.map(({ _id }) => _id)
}

describe('channel message ordering', () => {
  let Provider: typeof ChannelDataProvider
  let utils: typeof activityResources
  let provider: ChannelDataProvider
  let queries: QueryMock[]
  const findAll = jest.fn()
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  beforeAll(async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => null }
    })
    utils = await import('@hcengineering/activity-resources')
    Provider = (await import('../channelDataProvider')).ChannelDataProvider
  })

  afterAll(() => {
    if (localStorageDescriptor !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  beforeEach(() => {
    queries = []
    jest.mocked(createQuery).mockImplementation(() => {
      const query = { query: jest.fn(), unsubscribe: jest.fn() }
      queries.push(query)
      return query as unknown as ReturnType<typeof createQuery>
    })
    jest.mocked(getClient).mockReturnValue({
      findAll,
      getHierarchy: () => ({ isDerived: () => false })
    } as unknown as ReturnType<typeof getClient>)
    findAll.mockReset()
    provider = new Provider(
      undefined,
      'space' as Ref<Space>,
      'channel' as Ref<Doc>,
      activity.class.ActivityMessage,
      undefined,
      true,
      true
    )
  })

  afterEach(() => {
    provider.destroy()
  })

  it('orders simultaneous messages identically for three arrival orders and a reload', () => {
    const a = message('a')
    const b = message('b')
    const c = message('c')
    const arrivals = [
      [a, b, c],
      [b, c, a],
      [c, a, b],
      [c, b, a]
    ]

    for (const messages of arrivals) {
      expect(ids(utils.combineActivityMessages([...messages]))).toEqual(['a', 'b', 'c'])
    }
  })

  it('keeps timestamp order primary and uses modifiedOn when createdOn is missing', () => {
    const messages = [message('a', 300), message('z', 100), message('b', 200)]
    const legacy = message('c')
    delete legacy.createdOn
    legacy.modifiedOn = 200

    expect(ids(utils.sortActivityMessages([...messages, legacy]))).toEqual(['z', 'b', 'c', 'a'])
    expect(ids(utils.sortActivityMessages([legacy, ...messages], SortingOrder.Descending))).toEqual([
      'a',
      'c',
      'b',
      'z'
    ])
    expect(utils.activityMessagesComparator(messages[0], messages[0])).toBe(0)
  })

  it('keeps live tail order and IDs stable when the query refreshes after reconnect', async () => {
    const metadataCallback = queries[0].query.mock.calls[0][2]
    await metadataCallback([])
    // Initial loading awaits the unread-message lookup before subscribing to the tail.
    await Promise.resolve()
    const tailCallback = queries[1].query.mock.calls[0][2]
    const a = message('a')
    const b = message('b')
    const c = message('c')

    await tailCallback([a])
    expect(ids(get(provider.messagesStore))).toEqual(['a'])
    await tailCallback([b, a])
    expect(ids(get(provider.messagesStore))).toEqual(['a', 'b'])
    await tailCallback([b, a, c])
    expect(ids(get(provider.messagesStore))).toEqual(['a', 'b', 'c'])
    await tailCallback([c, b, a])
    expect(ids(get(provider.messagesStore))).toEqual(['a', 'b', 'c'])
  })

  it('requests the same tie-breaker for metadata, references and the live tail', async () => {
    await queries[0].query.mock.calls[0][2]([])
    await Promise.resolve()

    expect(queries[0].query.mock.calls[0][3].sort).toEqual({
      createdOn: SortingOrder.Ascending,
      _id: SortingOrder.Ascending
    })
    expect(queries[2].query.mock.calls[0][3].sort).toEqual({
      createdOn: SortingOrder.Ascending,
      _id: SortingOrder.Ascending
    })
    expect(queries[1].query.mock.calls[0][3].sort).toEqual({
      createdOn: SortingOrder.Descending,
      _id: SortingOrder.Descending
    })
  })

  it('uses the same tie-breaker when merging references with messages', async () => {
    await queries[0].query.mock.calls[0][2]([])
    await Promise.resolve()
    await queries[1].query.mock.calls[0][2]([message('c'), message('a')])
    await queries[2].query.mock.calls[0][2]([{ ...message('b'), _class: activity.class.ActivityReference }])

    expect(ids(get(provider.messagesStore))).toEqual(['a', 'b', 'c'])
  })

  it.each([false, true])('uses the same order for historical chunks (backward: %s)', async (isBackward) => {
    const messages = [message('a'), message('b'), message('c')]
    findAll.mockResolvedValue(isBackward ? [...messages].reverse() : messages)

    const chunk = await provider.loadChunk(isBackward, 100)
    const order = isBackward ? SortingOrder.Descending : SortingOrder.Ascending

    expect(findAll.mock.calls[0][2].sort).toEqual({ createdOn: order, _id: order })
    expect(ids(chunk?.data ?? [])).toEqual(['a', 'b', 'c'])
  })
})
