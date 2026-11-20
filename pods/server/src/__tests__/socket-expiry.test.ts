// SPDX-License-Identifier: EPL-2.0

import { MeasureMetricsContext } from '@hcengineering/core'
import { UNAUTHORIZED } from '@hcengineering/platform'
import { RPCHandler } from '@hcengineering/rpc'
import { compress } from 'snappy'
import { type WebSocket } from 'ws'
import { createWebsocketClientSocket } from '../server_http'

jest.mock('snappy', () => ({ compress: jest.fn() }))

const ctx = new MeasureMetricsContext('test', {})
const data = { remoteAddress: '', userAgent: '', language: '', account: '', mode: undefined, model: undefined }

function socketFixture (): {
  ws: { bufferedAmount: number, send: jest.Mock, close: jest.Mock, terminate: jest.Mock }
  socket: ReturnType<typeof createWebsocketClientSocket>
} {
  const ws = {
    OPEN: 1,
    CLOSED: 3,
    CLOSING: 2,
    readyState: 1,
    bufferedAmount: 0,
    send: jest.fn((_msg, _options, done) => {
      done()
    }),
    close: jest.fn(),
    terminate: jest.fn()
  }
  return { ws, socket: createWebsocketClientSocket(ws as unknown as WebSocket, data) }
}

test('a terminating frame waits for compression and WebSocket delivery', async () => {
  let finishCompression: (value: Buffer) => void = () => {}
  ;(compress as jest.Mock).mockImplementation(async () => {
    return await new Promise<Buffer>((resolve) => {
      finishCompression = resolve
    })
  })
  const { ws, socket } = socketFixture()
  const message = { error: UNAUTHORIZED, terminate: true }
  const serialized = new RPCHandler().serialize(message, true)
  const send = socket.send(ctx, message, true, true)
  expect(compress).toHaveBeenLastCalledWith(serialized)
  expect(ws.send).not.toHaveBeenCalled()
  finishCompression(Buffer.from('compressed frame'))
  await send
  expect(ws.send).toHaveBeenCalledWith(Buffer.from('compressed frame'), { binary: true }, expect.any(Function))
})

test('shutdown during backpressure stops the wait and prevents a late frame', async () => {
  const { ws, socket } = socketFixture()
  ws.bufferedAmount = 200 * 1024
  const send = socket.send(ctx, { error: UNAUTHORIZED, terminate: true }, true, false)
  expect(ws.send).not.toHaveBeenCalled()
  socket.close()
  await send
  expect(ws.terminate).toHaveBeenCalledTimes(1)
  expect(ws.send).not.toHaveBeenCalled()
})

test('shutdown during compression prevents a late frame', async () => {
  let finishCompression: (value: Buffer) => void = () => {}
  ;(compress as jest.Mock).mockImplementation(async () => {
    return await new Promise<Buffer>((resolve) => {
      finishCompression = resolve
    })
  })
  const { ws, socket } = socketFixture()
  const send = socket.send(ctx, { error: UNAUTHORIZED, terminate: true }, true, true)
  socket.close()
  finishCompression(Buffer.from('compressed frame'))
  await send
  expect(ws.send).not.toHaveBeenCalled()
})
