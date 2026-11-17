// SPDX-License-Identifier: EPL-2.0

import { type ActivityMessage } from '@hcengineering/activity'
import { type DocumentQuery, type FindOptions, type Ref, type Space, SortingOrder } from '@hcengineering/core'
import { createQuery, getClient } from '@hcengineering/presentation'
import { get } from 'svelte/store'
import { ChannelDataProvider } from '../channelDataProvider'

jest.mock('@hcengineering/core', () => ({ SortingOrder: { Ascending: 1, Descending: -1 }, isOtherDay: () => false }), {
  virtual: true
})
jest.mock('@hcengineering/presentation', () => ({ createQuery: jest.fn(), getClient: jest.fn() }), { virtual: true })
jest.mock(
  '@hcengineering/activity',
  () => ({ __esModule: true, default: { class: { ActivityMessage: 'ActivityMessage' } } }),
  { virtual: true }
)
jest.mock('@hcengineering/attachment', () => ({ __esModule: true, default: { class: { Attachment: 'Attachment' } } }), {
  virtual: true
})
jest.mock('@hcengineering/notification', () => ({}), { virtual: true })
jest.mock(
  '@hcengineering/activity-resources',
  () => ({ combineActivityMessages: (messages: ActivityMessage[]) => messages }),
  { virtual: true }
)

function message (index: number, createdOn = 100): ActivityMessage {
  return {
    _id: `message-${index.toString().padStart(3, '0')}`,
    createdOn,
    modifiedOn: createdOn
  } as unknown as ActivityMessage
}

describe('channel message ordering', () => {
  const messages = Array.from({ length: 120 }, (_, index) => message(index))
  const query = jest.fn()
  const findAll = jest.fn()
  let provider: ChannelDataProvider

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    jest
      .mocked(createQuery)
      .mockReturnValue({ query, unsubscribe: jest.fn() } as unknown as ReturnType<typeof createQuery>)
    jest.mocked(getClient).mockReturnValue({ findAll } as unknown as ReturnType<typeof getClient>)
    findAll.mockImplementation(
      async (_class: unknown, filter: DocumentQuery<ActivityMessage>, options: FindOptions<ActivityMessage>) => {
        const time = filter.createdOn as { $gte?: number, $lte?: number, $gt?: number, $lt?: number }
        const excluded = (filter._id as { $nin?: Array<Ref<ActivityMessage>> } | undefined)?.$nin ?? []
        const result = messages.filter(
          (message) =>
            !excluded.includes(message._id) &&
            (time.$gte === undefined || message.createdOn! >= time.$gte) &&
            (time.$lte === undefined || message.createdOn! <= time.$lte) &&
            (time.$gt === undefined || message.createdOn! > time.$gt) &&
            (time.$lt === undefined || message.createdOn! < time.$lt)
        )
        // Simulate a database applying sort and limit before returning the page.
        result.sort((a, b) => {
          for (const [key, direction] of Object.entries(options.sort ?? {})) {
            const difference = key === 'createdOn' ? a.createdOn! - b.createdOn! : a._id.localeCompare(b._id)
            if (difference !== 0) return difference * (direction as number)
          }
          return 0
        })
        return result.slice(0, options.limit)
      }
    )
    provider = new ChannelDataProvider(
      undefined,
      'space' as Ref<Space>,
      'chat' as Ref<ActivityMessage>,
      'ActivityMessage' as ActivityMessage['_class'],
      undefined
    )
  })

  afterEach(() => {
    provider.destroy()
  })

  it('uses the same two keys for metadata and reverses both for the live tail', async () => {
    const [, , onMetadata, metadataOptions] = query.mock.calls[0]
    expect(metadataOptions.sort).toEqual({ createdOn: SortingOrder.Ascending, _id: SortingOrder.Ascending })
    onMetadata(messages)
    await Promise.resolve()
    const tailOptions = query.mock.calls[1][3]
    expect(tailOptions.sort).toEqual({ createdOn: SortingOrder.Descending, _id: SortingOrder.Descending })
  })

  it.each([false, true])('advances through equal-time pages without duplicates (backward: %s)', async (backward) => {
    provider.metadataStore.set(messages)
    const loaded: ActivityMessage[] = []
    jest.spyOn(provider, 'getChunkSkipIds').mockImplementation(() => loaded.map(({ _id }) => _id))

    for (let page = 0; page < 3; page++) {
      const chunk = await provider.loadChunk(backward, 100)
      expect(chunk).toBeDefined()
      loaded.push(...chunk!.data)
    }

    const expected = backward ? [...messages].reverse() : messages
    // Backward pages are returned in display order, while pages themselves arrive newest first.
    const ids = backward
      ? [loaded.slice(0, 50).reverse(), loaded.slice(50, 100).reverse(), loaded.slice(100).reverse()].flat()
      : loaded
    expect(ids.map(({ _id }) => _id)).toEqual(expected.map(({ _id }) => _id))
    expect(await provider.loadChunk(backward, 100)).toBeUndefined()
  })

  it('does not load any of the equal-time live tail again while it is pending', async () => {
    query.mock.calls[0][2](messages)
    await Promise.resolve()
    expect(provider.getChunkSkipIds(100)).toEqual(messages.map(({ _id }) => _id))
  })

  it('can initialize around an older selected message when the entire chat has the same timestamp', async () => {
    provider.metadataStore.set(messages)
    expect(provider.jumpToMessage(messages[0])).toBe(true)
    await Promise.resolve()
    expect(query).toHaveBeenCalledTimes(2)
    const onTail = query.mock.calls[1][2]
    await onTail([...messages].reverse())
    expect(get(provider.messagesStore).map(({ _id }) => _id)).toEqual(messages.map(({ _id }) => _id))
  })

  it('finds the correct metadata index when switching from chunks to the tail', () => {
    const metadata = Array.from({ length: 100 }, (_, index) => message(index, index))
    expect(provider.getTailStartIndex(metadata, 60)).toBe(60)
    expect(provider.getTailStartIndex(metadata, 20)).toBe(-1)
  })

  it('continues loading when unloaded metadata shares the boundary timestamp', async () => {
    // Initialize around an older message, away from the live tail.
    const metadata = [...messages, ...Array.from({ length: 100 }, (_, index) => message(index + 120, 200 + index))]
    provider.metadataStore.set(metadata)
    expect(provider.canLoadMore('backward', 100)).toBe(true)
    await provider.addNextChunk('backward', 100)
    expect(get(provider.messagesStore)).toHaveLength(50)
    expect(provider.canLoadMore('backward', 100)).toBe(true)
    await provider.addNextChunk('backward', 100)
    await provider.addNextChunk('backward', 100)
    expect(get(provider.messagesStore).map(({ _id }) => _id)).toEqual(messages.map(({ _id }) => _id))
    expect(provider.canLoadMore('backward', 100)).toBe(false)
  })
})
