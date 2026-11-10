// SPDX-License-Identifier: EPL-2.0

import type { MeasureContext, WorkspaceUuid } from '@hcengineering/core'
import type { PlatformQueue } from '@hcengineering/server-core'
import { Kafka, type Producer } from 'kafkajs'
import { createPlatformQueue } from '..'

jest.mock('@hcengineering/server-core', () => ({
  QueueTopic: { WorkspaceMemberUnread: 'workspace-member-unread' }
}))

jest.mock('kafkajs', () => ({
  Kafka: jest.fn(),
  Partitioners: { DefaultPartitioner: jest.fn() },
  CompressionTypes: { GZIP: 1 }
}))

const workspace = 'workspace' as WorkspaceUuid

/**
 * Behaves like a kafkajs producer: `send` is rejected until `connect` has succeeded once.
 */
function createBrokerStub (): {
  producer: Producer
  connect: jest.Mock<Promise<void>, []>
  send: jest.Mock<Promise<unknown>, [unknown]>
  disconnect: jest.Mock<Promise<void>, []>
} {
  let connected = false
  const connect = jest.fn<Promise<void>, []>(async () => {
    connected = true
  })
  const send = jest.fn<Promise<unknown>, [unknown]>(async () => {
    if (!connected) throw new Error('The producer is disconnected')
    return []
  })
  const disconnect = jest.fn<Promise<void>, []>(async () => {
    connected = false
  })
  return { producer: { connect, send, disconnect } as unknown as Producer, connect, send, disconnect }
}

describe('producer connection', () => {
  const ctx = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    with: jest.fn(),
    extractMeta: jest.fn(() => ({}))
  }
  let broker: ReturnType<typeof createBrokerStub>
  let queue: PlatformQueue

  beforeEach(() => {
    jest.useFakeTimers()
    jest.resetAllMocks()
    jest.spyOn(console, 'info').mockImplementation(() => {})
    ctx.with.mockImplementation(
      async (_name: string, _params: object, op: (ctx: MeasureContext) => Promise<unknown>) => {
        return await op(ctx as unknown as MeasureContext)
      }
    )
    ctx.extractMeta.mockReturnValue({})
    broker = createBrokerStub()
    jest.mocked(Kafka).mockImplementation(() => ({ producer: () => broker.producer }) as unknown as Kafka)
    queue = createPlatformQueue({ brokers: ['localhost:9092'], clientId: 'test', postfix: '-test', region: 'region' })
  })

  afterEach(async () => {
    await queue.shutdown()
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  function getProducer (): ReturnType<PlatformQueue['getProducer']> {
    return queue.getProducer(ctx as unknown as MeasureContext, 'test-topic')
  }

  it('recovers when the broker was unavailable while the service started', async () => {
    broker.connect.mockRejectedValueOnce(new Error('KafkaJS retries exhausted'))
    const producer = getProducer()
    await jest.advanceTimersByTimeAsync(0)
    expect(broker.connect).toHaveBeenCalledTimes(1)

    // The broker is back; the next send after the backoff reconnects and is delivered.
    await jest.advanceTimersByTimeAsync(1000)
    await producer.send(ctx as unknown as MeasureContext, workspace, [{ value: 1 }])
    expect(broker.connect).toHaveBeenCalledTimes(2)
    expect(broker.send).toHaveBeenCalledTimes(1)
    expect(broker.send.mock.calls[0][0]).toMatchObject({ topic: 'region.test-topic-test' })

    // Once connected, later sends do not reconnect again.
    await producer.send(ctx as unknown as MeasureContext, workspace, [{ value: 2 }])
    expect(broker.connect).toHaveBeenCalledTimes(2)
    expect(broker.send).toHaveBeenCalledTimes(2)
  })

  // Jest fails the test on an unhandled rejection of the start-up connection attempt.
  it('reports a failed start-up connection without an unhandled rejection', async () => {
    broker.connect.mockRejectedValueOnce(new Error('KafkaJS retries exhausted'))
    getProducer()
    await jest.advanceTimersByTimeAsync(0)
    expect(ctx.error).toHaveBeenCalledWith(
      'failed to connect producer',
      expect.objectContaining({ topic: 'region.test-topic-test' })
    )
  })

  it('fails fast during the backoff and backs off up to ten seconds', async () => {
    broker.connect.mockRejectedValue(new Error('broker unavailable'))
    const producer = getProducer()
    await jest.advanceTimersByTimeAsync(0)
    expect(broker.connect).toHaveBeenCalledTimes(1)

    let attempts = 1
    for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
      // Inside the backoff window a send is rejected without another connection attempt.
      await jest.advanceTimersByTimeAsync(delay - 1)
      await expect(producer.send(ctx as unknown as MeasureContext, workspace, [{}])).rejects.toThrow(
        'broker unavailable'
      )
      expect(broker.connect).toHaveBeenCalledTimes(attempts)

      // After the backoff the next send tries to connect again.
      await jest.advanceTimersByTimeAsync(1)
      await expect(producer.send(ctx as unknown as MeasureContext, workspace, [{}])).rejects.toThrow(
        'broker unavailable'
      )
      expect(broker.connect).toHaveBeenCalledTimes(++attempts)
    }
    expect(broker.send).not.toHaveBeenCalled()
  })

  it('shares one connection attempt between concurrent sends', async () => {
    let finish: () => void = () => {}
    broker.connect.mockRejectedValueOnce(new Error('broker unavailable')).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const producer = getProducer()
    await jest.advanceTimersByTimeAsync(1000)

    const first = producer.send(ctx as unknown as MeasureContext, workspace, [{ value: 1 }])
    const second = producer.send(ctx as unknown as MeasureContext, workspace, [{ value: 2 }])
    await jest.advanceTimersByTimeAsync(0)
    expect(broker.connect).toHaveBeenCalledTimes(2)
    broker.send.mockResolvedValue([])
    finish()
    await Promise.all([first, second])
    expect(broker.connect).toHaveBeenCalledTimes(2)
    expect(broker.send).toHaveBeenCalledTimes(2)
  })

  it('connects once at start-up when the broker is available', async () => {
    const producer = getProducer()
    await producer.send(ctx as unknown as MeasureContext, workspace, [{ value: 1 }])
    await producer.send(ctx as unknown as MeasureContext, workspace, [{ value: 2 }])
    expect(broker.connect).toHaveBeenCalledTimes(1)
    expect(broker.send).toHaveBeenCalledTimes(2)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('does not reconnect after close', async () => {
    broker.connect.mockRejectedValueOnce(new Error('broker unavailable'))
    const producer = getProducer()
    await jest.advanceTimersByTimeAsync(0)
    await producer.close()
    await jest.advanceTimersByTimeAsync(30000)
    await expect(producer.send(ctx as unknown as MeasureContext, workspace, [{}])).rejects.toThrow()
    expect(broker.connect).toHaveBeenCalledTimes(1)
    expect(broker.disconnect).toHaveBeenCalledTimes(1)
  })
})
