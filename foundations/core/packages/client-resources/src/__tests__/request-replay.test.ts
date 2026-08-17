//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { ClientSocketReadyState, type ClientSocket } from '@hcengineering/client'
import { type PersonUuid, type WorkspaceUuid } from '@hcengineering/core'
import { Severity } from '@hcengineering/platform'
import { connect } from '../connection'

class ControlledSocket implements ClientSocket {
  readyState = ClientSocketReadyState.OPEN
  onmessage: ((this: ClientSocket, ev: MessageEvent) => unknown) | null = null
  onclose: ((this: ClientSocket, ev: CloseEvent) => unknown) | null = null
  onopen: ((this: ClientSocket, ev: Event) => unknown) | null = null
  onerror: ((this: ClientSocket, ev: Event) => unknown) | null = null
  bufferedAmount = 0

  constructor (readonly url: string) {}

  send (): void {}

  close (): void {
    this.readyState = ClientSocketReadyState.CLOSED
  }
}

interface AuditRequest {
  startTime: number
  reject: jest.Mock
  reconnect: jest.Mock
  sendData: jest.Mock
}

interface AuditableConnection {
  requests: Map<number, AuditRequest>
  handleMsg: (socketId: number, response: unknown) => void
  close: () => Promise<void>
}

describe('Connection request replay', () => {
  it('does not retain or replay a terminally rejected request', async () => {
    const client = connect(
      'ws://request-replay',
      () => {},
      'test-workspace' as WorkspaceUuid,
      'test-user' as PersonUuid,
      { socketFactory: (url) => new ControlledSocket(url) }
    ) as unknown as AuditableConnection
    const reconnect = jest.fn()
    const reject = jest.fn()
    client.requests.set(7, { startTime: Date.now(), reconnect, reject, sendData: jest.fn() })

    client.handleMsg(1, {
      id: 7,
      error: { code: 'test:error', severity: Severity.ERROR, message: 'terminal', params: {} }
    })

    expect(reject).toHaveBeenCalledTimes(1)
    expect(client.requests.has(7)).toBe(false)

    client.handleMsg(1, { id: -1, result: 'hello', binary: false, useCompression: false })
    expect(reconnect).not.toHaveBeenCalled()
    await client.close()
  })

  it('retains and retries a rate-limited request', async () => {
    const client = connect(
      'ws://request-retry',
      () => {},
      'test-workspace' as WorkspaceUuid,
      'test-user' as PersonUuid,
      { socketFactory: (url) => new ControlledSocket(url) }
    ) as unknown as AuditableConnection
    const request = {
      startTime: Date.now(),
      reconnect: jest.fn(),
      reject: jest.fn(),
      sendData: jest.fn()
    }
    client.requests.set(8, request)

    client.handleMsg(1, {
      id: 8,
      error: { code: 'test:rate-limit', severity: Severity.ERROR, message: 'retry', params: {} },
      rateLimit: { remaining: 0, retryAfter: 0 }
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(client.requests.get(8)).toBe(request)
    expect(request.reject).not.toHaveBeenCalled()
    expect(request.sendData).toHaveBeenCalledTimes(1)
    await client.close()
  })
})
