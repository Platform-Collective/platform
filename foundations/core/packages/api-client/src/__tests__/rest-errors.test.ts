//
// SPDX-License-Identifier: EPL-2.0
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

import core, {
  type Space,
  type Ref,
  type Doc,
  type PersonId,
  SocialIdType,
  OperationDomain,
  TxFactory
} from '@hcengineering/core'
import { PlatformError } from '@hcengineering/platform'
import * as publicApi from '../index'

describe('REST HTTP errors', () => {
  const token = 'sentinel-token'
  const endpoint = 'https://api.example.com'
  const body = 'response-body-detail; stack: response-stack-detail'
  const transaction = new TxFactory('caller' as PersonId).createTxUpdateDoc(
    core.class.Doc,
    'space' as Ref<Space>,
    'doc' as Ref<Doc>,
    {}
  )

  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it.each(['[]', 'null', '1', '{}'])('treatsAValidJsonSuccessBodyAsACommittedTransaction (%s)', async (body) => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status: 200 }))
    const client = publicApi.createRestClient(endpoint, 'workspace', token)
    await expect(client.tx(transaction)).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returnsAnObjectTransactionResult', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ object: { sequence: 7 } }))
    const client = publicApi.createRestClient(endpoint, 'workspace', token)
    await expect(client.tx(transaction)).resolves.toEqual({ object: { sequence: 7 } })
  })

  it.each(['network', 'body', '', 500, 503, 401, 403])('never replays a transaction after %s', async (failure) => {
    const fetch = jest.spyOn(globalThis, 'fetch')
    fetch.mockImplementation(async () => {
      if (fetch.mock.calls.length > 1) return Response.json({})
      if (failure === 'network') throw new Error('sensitive transport detail')
      if (failure === 'body') return new Response('invalid JSON', { status: 200 })
      if (failure === '') return new Response('', { status: 200 })
      if (typeof failure !== 'number') throw new Error('Unexpected test case')
      return new Response('sensitive response detail', { status: failure, headers: { 'Retry-After-ms': '100' } })
    })
    const client = publicApi.createRestClient(endpoint, 'workspace', token)
    const error: unknown = await client.tx(transaction).catch((error: unknown) => error)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(error).toBeInstanceOf(publicApi.RestHttpError)
    if (typeof failure === 'string' || failure >= 500) {
      expect(error).toHaveProperty('outcomeUnknown', true)
    } else {
      expect(error).not.toHaveProperty('outcomeUnknown', true)
    }
    expect((error as Error).message).not.toContain('sensitive')
  })

  it.each(['network', 'body'])('retains the original %s failure as the error cause', async (failure) => {
    const cause = new Error(`sensitive ${failure} detail`)
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (failure === 'network') throw cause
      const response = new Response('invalid JSON', { status: 200 })
      jest.spyOn(response, 'text').mockRejectedValue(cause)
      return response
    })
    const client = publicApi.createRestClient(endpoint, 'workspace', token)

    const error: unknown = await client.tx(transaction).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(publicApi.RestHttpError)
    expect(error).toHaveProperty('cause', cause)
    expect((error as Error).message).not.toContain('sensitive')
  })

  it('retries a rate-limited transaction with the same body', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch')
    fetch.mockImplementation(async () => {
      if (fetch.mock.calls.length === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After-ms': '100' } })
      }
      return Response.json({})
    })
    const client = publicApi.createRestClient(endpoint, 'workspace', token)

    await expect(client.tx(transaction)).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1]?.body).toBe(fetch.mock.calls[1][1]?.body)
  })

  it.each<{ name: string, headers: Record<string, string> }>([
    { name: 'malformed Retry-After-ms', headers: { 'Retry-After-ms': 'invalid' } },
    { name: 'HTTP-date Retry-After', headers: { 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' } },
    { name: 'past X-RateLimit-Reset', headers: { 'X-RateLimit-Reset': '1' } }
  ])('uses a safe retry delay for $name', async ({ headers }) => {
    jest.useFakeTimers()
    const timeout = jest.spyOn(globalThis, 'setTimeout')
    const fetch = jest.spyOn(globalThis, 'fetch')
    fetch.mockImplementation(async () => {
      if (fetch.mock.calls.length === 1) return new Response('rate limited', { status: 429, headers })
      return Response.json({})
    })
    const client = publicApi.createRestClient(endpoint, 'workspace', token)

    const result = client.tx(transaction)
    await jest.runAllTimersAsync()
    await expect(result).resolves.toEqual({})
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 1000)
  })

  it('stops retrying a write after five rate-limited attempts', async () => {
    jest.useFakeTimers()
    const timeout = jest.spyOn(globalThis, 'setTimeout')
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('rate limited', { status: 429, headers: { 'Retry-After-ms': '1' } })
    })
    const client = publicApi.createRestClient(endpoint, 'workspace', token)

    const result = client.tx(transaction).catch((error: unknown) => error)
    await jest.runAllTimersAsync()
    const error: unknown = await result
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 100)
    expect(error).toBeInstanceOf(publicApi.RestHttpError)
    expect(error).toHaveProperty('httpStatus', 429)
    expect(error).toHaveProperty('retryAfterMs', 100)
    expect(error).toHaveProperty('rejectedBeforeWrite', true)
  })

  it.each(['network', 'body', 500, 503])('never replays a v1 write after %s', async (failure) => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (failure === 'network') throw new Error('transport failure')
      if (failure === 'body') return new Response('invalid JSON', { status: 200 })
      return new Response('failure', { status: failure as number })
    })
    const client = publicApi.createRestClient(endpoint, 'workspace', token)

    const error: unknown = await client
      .createDoc(core.class.Doc, 'space' as Ref<Space>, {})
      .catch((error: unknown) => error)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(error).toBeInstanceOf(publicApi.RestHttpError)
    expect(error).toHaveProperty('outcomeUnknown', true)
  })

  it.each(['[]', 'null', '1'])('treats a valid JSON v1 write result as committed (%s)', async (body) => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status: 200 }))
    const client = publicApi.createRestClient(endpoint, 'workspace', token)

    await expect(client.createDoc(core.class.Doc, 'space' as Ref<Space>, {})).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries a rate-limited v1 write with the same body', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch')
    fetch.mockImplementation(async () => {
      if (fetch.mock.calls.length === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After-ms': '100' } })
      }
      return Response.json({})
    })
    const client = publicApi.createRestClient(endpoint, 'workspace', token)

    await expect(client.createDoc(core.class.Doc, 'space' as Ref<Space>, {})).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[0][1]?.body).toBe(fetch.mock.calls[1][1]?.body)
  })

  it.each([401, 403])(
    'preservesTypedHttpStatusWithoutLoggingToken (%i)',
    async (status) => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {})
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
      jest.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(body, {
            status,
            statusText: `${token} ${endpoint} ${body}`
          })
      )
      const client = publicApi.createRestClient(endpoint, 'workspace', token)
      const operations: Array<() => Promise<unknown>> = [
        async () => await client.findAll(core.class.Doc, {}),
        async () => await client.findAllPage(core.class.Doc, {}, { limit: 1 }),
        async () => await client.getAccount(),
        async () => await client.getModel(),
        async () => await client.tx(transaction),
        async () => await client.searchFulltext({ query: 'query' }, {}),
        async () => await client.domainRequest('domain' as OperationDomain, {}),
        async () => await client.ensurePerson(SocialIdType.EMAIL, 'person@example.com', 'First', 'Last'),
        async () => await client.createDoc(core.class.Doc, 'space' as Ref<Space>, {})
      ]

      for (const operation of operations) {
        const failure: unknown = await operation().catch((error: unknown) => error)
        expect(failure).toHaveProperty('httpStatus', status)
        expect(failure).toBeInstanceOf(Reflect.get(publicApi, 'RestHttpError'))
        expect(failure).toBeInstanceOf(Error)
        expect(failure).toBeInstanceOf(PlatformError)
        expect((failure as Error).message).toBe(`HTTP error ${status}`)
        expect(failure).toHaveProperty('name', 'RestHttpError')
        expect((failure as { retryAfterMs?: number }).retryAfterMs).toBeUndefined()
        expect((failure as { outcomeUnknown?: boolean }).outcomeUnknown).toBeUndefined()
        expect((failure as { rejectedBeforeWrite?: boolean }).rejectedBeforeWrite).toBeUndefined()
      }
      expect(log).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
      expect(errorLog).not.toHaveBeenCalled()
    },
    15000
  )

  it('preservesTypedHttpStatusWithoutLoggingToken (429)', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(body, {
          status: 429,
          statusText: `${token} ${endpoint} ${body}`,
          headers: { 'Retry-After-ms': '100' }
        })
    )
    const client = publicApi.createRestClient(endpoint, 'workspace', token)
    const failure: unknown = await client.getAccount().catch((error: unknown) => error)

    expect(failure).toHaveProperty('httpStatus', 429)
    expect(failure).toBeInstanceOf(Reflect.get(publicApi, 'RestHttpError'))
    expect((failure as Error).message).toBe('rate-limit')
    expect(failure).toHaveProperty('retryAfterMs', 100)
    expect(failure).toHaveProperty('rejectedBeforeWrite', true)
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
  })
})
