/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { errorResponse, isJsonRpcNotification, isJsonRpcRequest, isJsonRpcId, successResponse } from '../protocol'

describe('isJsonRpcId', () => {
  it('accepts strings and finite numbers only', () => {
    expect(isJsonRpcId(1)).toBe(true)
    expect(isJsonRpcId('abc')).toBe(true)
    expect(isJsonRpcId(Number.NaN)).toBe(false)
    expect(isJsonRpcId(null)).toBe(false)
    expect(isJsonRpcId({})).toBe(false)
  })
})

describe('isJsonRpcRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(true)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 'a', method: 'ping', params: {} })).toBe(true)
  })

  it('rejects anything that is not a JSON-RPC 2.0 envelope', () => {
    // Regression: an `&&`/`:?` precedence mistake once made every one of these
    // validate, which let arbitrary objects through as requests.
    expect(isJsonRpcRequest({ hello: 'world' })).toBe(false)
    expect(isJsonRpcRequest({})).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '1.0', id: 1, method: 'ping' })).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1 })).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: '' })).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 42 })).toBe(false)
  })

  it('requires an id, since a message without one is a notification', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'ping' })).toBe(false)
  })

  it('rejects non-objects and arrays', () => {
    expect(isJsonRpcRequest(null)).toBe(false)
    expect(isJsonRpcRequest('ping')).toBe(false)
    expect(isJsonRpcRequest(42)).toBe(false)
    expect(isJsonRpcRequest([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).toBe(false)
  })

  it('rejects a non-structured params', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ping', params: 'x' })).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ping', params: null })).toBe(false)
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ping', params: [] })).toBe(false)
  })
})

describe('isJsonRpcNotification', () => {
  it('accepts a method with no id', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true)
  })

  it('rejects anything carrying an id', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe(false)
    expect(isJsonRpcNotification({ jsonrpc: '2.0', id: null, method: 'ping' })).toBe(false)
  })

  it('rejects garbage', () => {
    expect(isJsonRpcNotification({ hello: 'world' })).toBe(false)
    expect(isJsonRpcNotification(null)).toBe(false)
    expect(isJsonRpcNotification('notifications/initialized')).toBe(false)
  })
})

describe('response builders', () => {
  it('builds a success envelope', () => {
    expect(successResponse(7, { ok: true })).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: true } })
  })

  it('builds an error envelope and omits absent data', () => {
    expect(errorResponse(7, -32601, 'nope')).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: 'nope' }
    })
    expect(errorResponse(null, -32700, 'bad', { at: 1 }).error.data).toEqual({ at: 1 })
  })
})
