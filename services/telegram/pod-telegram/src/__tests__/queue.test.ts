// SPDX-License-Identifier: EPL-2.0

import { MsgQueue } from '../queue'
import type { Event } from '../types'

function event (id: number): Event {
  return { user: {} as unknown as Event['user'], msg: { id } as unknown as Event['msg'] }
}

function deferred (): { promise: Promise<void>, resolve: () => void } {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function nextTurn (): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('MsgQueue', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('queues a second event while the first callback awaits and drains in order', async () => {
    const first = deferred()
    const onEvent = jest.fn(async (event: Event) => {
      if (event.msg.id === 1) await first.promise
    })
    const queue = new MsgQueue(false, onEvent)
    const events = [event(1), event(2), event(3)]

    queue.add(events[0])
    queue.add(events[1])
    queue.unpause()
    await nextTurn()
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([events[0]])

    first.resolve()
    await nextTurn()
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events.slice(0, 2))

    queue.add(events[2])
    await nextTurn()
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events)
  })

  it.each(['throw', 'reject'])('continues draining after a callback failure (%s)', async (failure) => {
    const error = new Error('Failed to save message')
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const onEvent = jest.fn((event: Event): Promise<void> => {
      if (event.msg.id === 1) {
        if (failure === 'throw') throw error
        return Promise.reject(error)
      }
      return Promise.resolve()
    })
    const queue = new MsgQueue(true, onEvent)
    const events = [event(1), event(2), event(3)]

    queue.add(events[0])
    queue.add(events[1])
    queue.unpause()
    await nextTurn()
    expect(logError).toHaveBeenCalledWith(error)
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events.slice(0, 2))

    queue.add(events[2])
    await nextTurn()
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events)
  })

  it('waits for unpause and drops messages through the supplied id', async () => {
    const onEvent = jest.fn(async (_event: Event) => {})
    const queue = new MsgQueue(true, onEvent)
    const events = [event(1), event(2), event(3)]

    events.forEach((event) => {
      queue.add(event)
    })
    queue.dropBefore(2)
    await nextTurn()
    expect(onEvent).not.toHaveBeenCalled()

    queue.unpause()
    await nextTurn()
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([events[2]])
  })

  it('pauses during a callback and resumes the remaining events', async () => {
    const first = deferred()
    const onEvent = jest.fn(async (event: Event) => {
      if (event.msg.id === 1) await first.promise
    })
    const queue = new MsgQueue(false, onEvent)
    const events = [event(1), event(2)]

    queue.add(events[0])
    queue.pause()
    queue.add(events[1])
    first.resolve()
    await nextTurn()
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([events[0]])

    queue.unpause()
    await nextTurn()
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events)
  })
})
