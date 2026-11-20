// SPDX-License-Identifier: EPL-2.0

import type { ChatMessage } from '@hcengineering/chunter'
import type { DocumentQuery, FindOptions, PersonId } from '@hcengineering/core'
import { MessageSearch, type MessageSearchState } from '../message-search'

jest.mock('@hcengineering/core', () => ({ SortingOrder: { Ascending: 1, Descending: -1 } }), { virtual: true })

const all = Array.from({ length: 220 }, (_, i) => ({
  _id: i.toString(16).padStart(8, '0'),
  createdOn: 1000,
  createdBy: 'sender'
})) as ChatMessage[]
const query: DocumentQuery<ChatMessage> = {
  $search: 'agreement',
  createdOn: { $gte: 100, $lt: 2000 },
  createdBy: { $in: ['sender' as PersonId] }
}
const deferred = <T> (): { promise: Promise<T>, resolve: (value: T) => void, reject: (error: Error) => void } => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

describe('message search', () => {
  let state: MessageSearchState
  let find: jest.Mock<Promise<ChatMessage[]>, [DocumentQuery<ChatMessage>, FindOptions<ChatMessage>]>
  let errors: jest.Mock
  let search: MessageSearch

  beforeEach(() => {
    state = { messages: [], loading: false, hasMore: false }
    find = jest.fn(async (_query: DocumentQuery<ChatMessage>, options: FindOptions<ChatMessage>) =>
      [...all].reverse().slice(0, options.limit)
    )
    errors = jest.fn()
    search = new MessageSearch(
      find,
      (next) => {
        state = next
      },
      errors
    )
  })

  it('loads all 220 equal-time matches in pages, with stable order and no duplicates', async () => {
    await search.setQuery(query)
    expect(state.messages).toHaveLength(100)
    expect(state.hasMore).toBe(true)
    await search.loadMore()
    expect(state.messages).toHaveLength(200)
    expect(state.hasMore).toBe(true)
    await search.loadMore()
    expect(state.messages).toEqual([...all].reverse())
    expect(new Set(state.messages.map((it) => it._id)).size).toBe(220)
    expect(state.hasMore).toBe(false)
    await search.loadMore()
    expect(find).toHaveBeenCalledTimes(3)
    expect(find.mock.calls.map((call) => call[1].limit)).toEqual([101, 201, 301])
    for (const [filter, options] of find.mock.calls) {
      expect(filter).toEqual(query)
      expect(options.sort).toEqual({ createdOn: -1, _id: -1 })
    }
  })

  it('does not offer another page for exactly 100 results or an empty result', async () => {
    find.mockResolvedValueOnce(all.slice(0, 100)).mockResolvedValueOnce([])
    await search.setQuery(query)
    expect(state.hasMore).toBe(false)
    await search.setQuery({ createdBy: 'nobody' as PersonId })
    expect(state).toEqual({ messages: [], loading: false, hasMore: false })
  })

  it('resets the page window and clears old results when text or filters change', async () => {
    await search.setQuery(query)
    await search.loadMore()
    const pending = deferred<ChatMessage[]>()
    find.mockReturnValueOnce(pending.promise)
    const changed = { ...query, createdOn: { $gte: 1500 } }
    const waiting = search.setQuery(changed)
    expect(state.messages).toEqual([])
    expect(state.loading).toBe(true)
    pending.resolve([all[0]])
    await waiting
    expect(find.mock.lastCall).toEqual([changed, { sort: { createdOn: -1, _id: -1 }, limit: 101 }])
    expect(state.messages).toEqual([all[0]])
  })

  it('ignores a delayed old search response', async () => {
    const pending = deferred<ChatMessage[]>()
    find.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([all[1]])
    const old = search.setQuery(query)
    await search.setQuery({ $search: 'new' })
    pending.resolve([all[0]])
    await old
    expect(state.messages).toEqual([all[1]])
  })

  it('ignores an old page and its error after a filter change', async () => {
    await search.setQuery(query)
    const pending = deferred<ChatMessage[]>()
    find.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([all[1]])
    const more = search.loadMore()
    await search.setQuery({ createdBy: 'other' as PersonId })
    pending.reject(new Error('old request'))
    await more
    expect(state.messages).toEqual([all[1]])
    expect(errors).not.toHaveBeenCalled()
  })

  it('reports failure, retains the window and allows retry without skipping a page', async () => {
    await search.setQuery(query)
    find.mockRejectedValueOnce(new Error('offline'))
    await search.loadMore()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(state.messages).toHaveLength(100)
    expect(state.loading).toBe(false)
    expect(state.hasMore).toBe(true)
    await search.loadMore()
    expect(state.messages).toHaveLength(200)
    expect(find.mock.calls.map((call) => call[1].limit)).toEqual([101, 201, 201])
  })

  it('coalesces repeated load-more clicks while a request is pending', async () => {
    await search.setQuery(query)
    const pending = deferred<ChatMessage[]>()
    find.mockReturnValueOnce(pending.promise)
    const more = search.loadMore()
    await search.loadMore()
    expect(find).toHaveBeenCalledTimes(2)
    pending.resolve(all.slice(0, 201))
    await more
  })

  it('does not publish after the component is destroyed', async () => {
    const pending = deferred<ChatMessage[]>()
    find.mockReturnValueOnce(pending.promise)
    const waiting = search.setQuery(query)
    search.destroy()
    const before = state
    pending.resolve(all)
    await waiting
    expect(state).toBe(before)
  })
})
