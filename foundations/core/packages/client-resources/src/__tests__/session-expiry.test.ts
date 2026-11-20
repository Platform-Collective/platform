// SPDX-License-Identifier: EPL-2.0

import { type ClientSocket } from '@hcengineering/client'
import { type PersonUuid, type WorkspaceUuid } from '@hcengineering/core'
import platform, { UNAUTHORIZED } from '@hcengineering/platform'
import { RPCHandler } from '@hcengineering/rpc'
import { compress } from 'snappyjs'
import { connect } from '../connection'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))

beforeEach(() => {
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

test.each(['live', 'handshake'])('%s termination closes the socket and invokes the logout callback', async (phase) => {
  const socket = { readyState: 1, close: jest.fn(), send: jest.fn() } as unknown as ClientSocket
  const onError = jest.fn((status): unknown => {
    expect(status).toBe(platform.status.Unauthorized)
    // The network operation started by the callback may never settle.
    return new Promise<void>(() => {})
  })
  const connection = connect('ws://localhost/token', () => {}, 'workspace' as WorkspaceUuid, 'person' as PersonUuid, {
    socketFactory: () => socket,
    onError
  })
  const rpc = new RPCHandler()
  const deliver = (data: string | Uint8Array): void => {
    socket.onmessage?.({ data } as unknown as MessageEvent)
  }
  if (phase === 'live') {
    const hello = { id: -1, result: 'hello', binary: true, useCompression: true }
    deliver(rpc.serialize(hello, false))
    deliver(compress(rpc.serialize({ error: UNAUTHORIZED, terminate: true }, true)))
  } else {
    deliver(rpc.serialize({ id: -1, result: 'hello', error: UNAUTHORIZED, terminate: true }, false))
  }
  expect(socket.close).toHaveBeenCalled()
  expect(onError).toHaveBeenCalledTimes(1)
  await connection.close()
})
