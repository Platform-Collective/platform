import type { MeasureContext, WorkspaceUuid } from '@hcengineering/core'
import type { PlatformQueue } from '@hcengineering/server-core'
import type * as KafkaJs from 'kafkajs'
import { Kafka, type Consumer, type EachMessageHandler, type EachMessagePayload, type Producer } from 'kafkajs'
import { createPlatformQueue, parseQueueConfig } from '..'

jest.mock('@hcengineering/server-core', () => ({
  QueueTopic: { WorkspaceMemberUnread: 'workspace-member-unread' }
}))

jest.mock('kafkajs', () => ({
  ...jest.requireActual<typeof KafkaJs>('kafkajs'),
  Kafka: jest.fn()
}))

describe('queue', () => {
  const consumer = {
    connect: jest.fn<ReturnType<Consumer['connect']>, Parameters<Consumer['connect']>>(),
    subscribe: jest.fn<ReturnType<Consumer['subscribe']>, Parameters<Consumer['subscribe']>>(),
    run: jest.fn<ReturnType<Consumer['run']>, Parameters<Consumer['run']>>(),
    disconnect: jest.fn<ReturnType<Consumer['disconnect']>, Parameters<Consumer['disconnect']>>(),
    on: jest.fn()
  }
  const producer = {
    connect: jest.fn<ReturnType<Producer['connect']>, Parameters<Producer['connect']>>(),
    send: jest.fn<ReturnType<Producer['send']>, Parameters<Producer['send']>>(),
    disconnect: jest.fn<ReturnType<Producer['disconnect']>, Parameters<Producer['disconnect']>>()
  }
  const ctx = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), with: jest.fn(), extractMeta: jest.fn() }
  const testCtx = ctx as unknown as MeasureContext
  const workspace = 'test-workspace' as WorkspaceUuid
  let queue: PlatformQueue

  beforeEach(() => {
    jest.useFakeTimers()
    jest.resetAllMocks()
    jest.spyOn(console, 'info').mockImplementation(() => {})
    consumer.connect.mockResolvedValue(undefined)
    consumer.subscribe.mockResolvedValue(undefined)
    consumer.run.mockResolvedValue(undefined)
    consumer.disconnect.mockResolvedValue(undefined)
    producer.connect.mockResolvedValue(undefined)
    producer.send.mockResolvedValue([])
    producer.disconnect.mockResolvedValue(undefined)
    ctx.extractMeta.mockReturnValue({})
    ctx.with.mockImplementation(
      async (_name: string, _params: object, op: (ctx: MeasureContext) => Promise<unknown>) => {
        return await op(testCtx)
      }
    )
    jest
      .mocked(Kafka)
      .mockImplementation(() => ({ consumer: () => consumer, producer: () => producer }) as unknown as Kafka)
    queue = createPlatformQueue(parseQueueConfig('localhost:19093;-queue_testing', 'test', ''))
  })

  afterEach(async () => {
    await queue.shutdown()
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  function getMessageHandler (): EachMessageHandler {
    const eachMessage = consumer.run.mock.calls[0]?.[0]?.eachMessage
    if (eachMessage === undefined) throw new Error('Consumer has not started')
    return eachMessage
  }

  it('check-queue', async () => {
    const docsCount = 50
    const received: string[] = []
    queue.createConsumer<string>(
      testCtx,
      'qtest',
      'test-group',
      async (_ctx, msg) => {
        expect(msg.workspace).toBe(workspace)
        received.push(msg.value)
      },
      { retryDelay: 100, maxRetryDelay: 3, fromBegining: true }
    )
    await jest.advanceTimersByTimeAsync(0)
    expect(consumer.subscribe).toHaveBeenCalledWith({ topic: 'qtest-queue_testing', fromBeginning: true })
    const eachMessage = getMessageHandler()

    const p = queue.getProducer<string>(testCtx, 'qtest')
    const batchSize = 10
    for (let i = 0; i < docsCount; i += batchSize) {
      const batch: string[] = []
      for (let j = i; j < Math.min(i + batchSize, docsCount); j++) {
        batch.push('msg' + j)
      }
      await p.send(testCtx, workspace, batch)
    }

    expect(producer.send).toHaveBeenCalledTimes(docsCount / batchSize)
    for (const [record] of producer.send.mock.calls) {
      expect(record.topic).toBe('qtest-queue_testing')
      for (const message of record.messages) {
        await eachMessage({
          topic: record.topic,
          partition: 0,
          message,
          heartbeat: jest.fn(),
          pause: jest.fn()
        } as unknown as EachMessagePayload)
      }
    }
    expect(received).toEqual(Array.from({ length: docsCount }, (_, i) => 'msg' + i))
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it('check-processing-errors', async () => {
    const onMessage = jest.fn().mockRejectedValueOnce(new Error('Processing Error')).mockResolvedValue(undefined)
    queue.createConsumer<string>(testCtx, 'test', 'test-group', onMessage, {
      retryDelay: 50,
      maxRetryDelay: 3,
      fromBegining: true
    })
    await jest.advanceTimersByTimeAsync(0)
    const eachMessage = getMessageHandler()
    const p = queue.getProducer<string>(testCtx, 'test')
    await p.send(testCtx, workspace, ['msg'])
    const record = producer.send.mock.calls[0][0]
    const heartbeat = jest.fn().mockResolvedValue(undefined)
    const processing = eachMessage({
      topic: record.topic,
      partition: 0,
      message: record.messages[0],
      heartbeat,
      pause: jest.fn()
    } as unknown as EachMessagePayload)

    await jest.advanceTimersByTimeAsync(49)
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(heartbeat).toHaveBeenCalledTimes(1)
    expect(ctx.error).toHaveBeenCalledWith('failed to process message', expect.any(Object))
    await jest.advanceTimersByTimeAsync(1)
    await processing
    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage).toHaveBeenLastCalledWith(
      testCtx,
      { workspace, value: 'msg' },
      expect.objectContaining({ heartbeat: expect.any(Function), pause: expect.any(Function) })
    )
    expect(jest.getTimerCount()).toBe(0)
  })
})
