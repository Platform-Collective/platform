// SPDX-License-Identifier: EPL-2.0

import type { MeasureContext } from '@hcengineering/core'
import type { ConsumerHandle, PlatformQueue } from '@hcengineering/server-core'
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs'
import { createPlatformQueue } from '..'

jest.mock('@hcengineering/server-core', () => ({
  QueueTopic: { WorkspaceMemberUnread: 'workspace-member-unread' }
}))

jest.mock('kafkajs', () => ({ Kafka: jest.fn() }))

describe('consumer startup', () => {
  const consumer = {
    connect: jest.fn<ReturnType<Consumer['connect']>, Parameters<Consumer['connect']>>(),
    subscribe: jest.fn<ReturnType<Consumer['subscribe']>, Parameters<Consumer['subscribe']>>(),
    run: jest.fn<ReturnType<Consumer['run']>, Parameters<Consumer['run']>>(),
    disconnect: jest.fn<ReturnType<Consumer['disconnect']>, Parameters<Consumer['disconnect']>>(),
    on: jest.fn()
  }
  const ctx = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), with: jest.fn() }
  const onMessage = jest.fn()
  let queue: PlatformQueue

  beforeEach(() => {
    jest.useFakeTimers()
    jest.resetAllMocks()
    jest.spyOn(console, 'info').mockImplementation(() => {})
    consumer.connect.mockResolvedValue(undefined)
    consumer.subscribe.mockResolvedValue(undefined)
    consumer.run.mockResolvedValue(undefined)
    consumer.disconnect.mockResolvedValue(undefined)
    ctx.with.mockImplementation(async (_name: string, _params: object, op: (ctx: MeasureContext) => Promise<void>) => {
      await op(ctx as unknown as MeasureContext)
    })
    jest.mocked(Kafka).mockImplementation(() => ({ consumer: () => consumer }) as unknown as Kafka)
    queue = createPlatformQueue({ brokers: ['localhost:9092'], clientId: 'test', postfix: '-test', region: 'region' })
  })

  afterEach(async () => {
    await queue.shutdown()
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  function createConsumer (): ConsumerHandle {
    return queue.createConsumer(ctx as unknown as MeasureContext, 'test-topic', 'test-group', onMessage, {
      fromBegining: true
    })
  }

  it('starts once and processes messages after the broker becomes available', async () => {
    consumer.connect
      .mockRejectedValueOnce(new Error('KafkaJS retries exhausted'))
      .mockRejectedValueOnce(new Error('broker still unavailable'))
    const handle = createConsumer()
    await jest.advanceTimersByTimeAsync(0)
    expect(ctx.error).toHaveBeenCalledTimes(1)
    expect(consumer.run).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1000)
    expect(consumer.connect).toHaveBeenCalledTimes(2)
    expect(consumer.run).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(2000)
    expect(consumer.connect).toHaveBeenCalledTimes(3)
    expect(consumer.subscribe).toHaveBeenCalledWith({ topic: 'region.test-topic-test', fromBeginning: true })
    expect(consumer.run).toHaveBeenCalledTimes(1)
    expect(consumer.on.mock.calls.map(([event]) => event)).toEqual(['consumer.connect', 'consumer.disconnect'])

    const payload = {
      message: { key: Buffer.from('workspace'), value: Buffer.from('{"value":42}') },
      heartbeat: jest.fn(),
      pause: jest.fn()
    } as unknown as EachMessagePayload
    await consumer.run.mock.calls[0][0]?.eachMessage?.(payload)
    expect(onMessage).toHaveBeenCalledWith(
      ctx,
      { workspace: 'workspace', value: { value: 42 } },
      expect.objectContaining({ heartbeat: expect.any(Function), pause: expect.any(Function) })
    )

    await jest.advanceTimersByTimeAsync(30000)
    expect(consumer.run).toHaveBeenCalledTimes(1)
    await handle.close()
  })

  it('retries subscription failures before starting consumption', async () => {
    consumer.subscribe.mockRejectedValueOnce(new Error('metadata unavailable'))
    createConsumer()
    await jest.advanceTimersByTimeAsync(0)
    expect(consumer.run).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1000)
    expect(consumer.subscribe).toHaveBeenCalledTimes(2)
    expect(consumer.run).toHaveBeenCalledTimes(1)
    expect(consumer.on).toHaveBeenCalledTimes(2)
  })

  it('backs off startup retries to a maximum of ten seconds', async () => {
    consumer.connect.mockRejectedValue(new Error('broker unavailable'))
    createConsumer()
    await jest.advanceTimersByTimeAsync(0)
    let attempts = 1
    for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
      await jest.advanceTimersByTimeAsync(delay - 1)
      expect(consumer.connect).toHaveBeenCalledTimes(attempts)
      await jest.advanceTimersByTimeAsync(1)
      expect(consumer.connect).toHaveBeenCalledTimes(++attempts)
    }
    expect(consumer.run).not.toHaveBeenCalled()
  })

  it('cancels a pending retry when closed', async () => {
    consumer.connect.mockRejectedValue(new Error('broker unavailable'))
    const handle = createConsumer()
    await jest.advanceTimersByTimeAsync(0)
    expect(jest.getTimerCount()).toBe(1)
    await handle.close()
    expect(jest.getTimerCount()).toBe(0)
    expect(consumer.disconnect).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(30000)
    expect(consumer.connect).toHaveBeenCalledTimes(1)
    expect(consumer.run).not.toHaveBeenCalled()
  })

  it.each(['connect', 'subscribe'] as const)('does not resume after close during an in-flight %s', async (stage) => {
    let finish: () => void = () => {}
    consumer[stage].mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const handle = createConsumer()
    await jest.advanceTimersByTimeAsync(0)
    const closing = handle.close()
    const disconnectedBeforeStartupFinished = consumer.disconnect.mock.calls.length
    finish()
    await closing
    await jest.advanceTimersByTimeAsync(30000)

    expect(disconnectedBeforeStartupFinished).toBe(0)
    expect(consumer.disconnect).toHaveBeenCalledTimes(1)
    expect(consumer.run).not.toHaveBeenCalled()
    if (stage === 'connect') expect(consumer.subscribe).not.toHaveBeenCalled()
  })

  it('does not retry when an in-flight connection fails after close', async () => {
    let fail: (err: Error) => void = () => {}
    consumer.connect.mockImplementationOnce(async () => {
      await new Promise<void>((resolve, reject) => {
        fail = reject
      })
    })
    const handle = createConsumer()
    const closing = handle.close()
    fail(new Error('broker unavailable'))
    await closing
    await jest.advanceTimersByTimeAsync(30000)

    expect(consumer.connect).toHaveBeenCalledTimes(1)
    expect(consumer.run).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('starts immediately when the broker is available and tracks connection events', async () => {
    const handle = createConsumer()
    await jest.advanceTimersByTimeAsync(0)
    expect(consumer.connect).toHaveBeenCalledTimes(1)
    expect(consumer.subscribe).toHaveBeenCalledTimes(1)
    expect(consumer.run).toHaveBeenCalledTimes(1)
    consumer.on.mock.calls.find(([event]) => event === 'consumer.connect')?.[1]()
    expect(handle.isConnected()).toBe(true)
    consumer.on.mock.calls.find(([event]) => event === 'consumer.disconnect')?.[1]()
    expect(handle.isConnected()).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
  })
})
