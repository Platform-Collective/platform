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

  it.each(['network', 'body', '', 500, 503, 401, 403, 429])(
    'never replays a transaction after %s',
    async (failure) => {
      const fetch = jest.spyOn(globalThis, 'fetch')
      fetch.mockImplementation(async () => {
        if (fetch.mock.calls.length > 1) return Response.json({})
        if (failure === 'network') throw new Error('sensitive transport detail')
        if (failure === 'body') return new Response('invalid JSON', { status: 200 })
        if (failure === '') return new Response('', { status: 200 })
        return new Response('sensitive response detail', { status: failure, headers: { 'Retry-After-ms': '0' } })
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
    }
  )

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
        expect(failure).toHaveProperty('status', status)
        expect(failure).toBeInstanceOf(Reflect.get(publicApi, 'RestHttpError'))
        expect(failure).toBeInstanceOf(Error)
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
          headers: { 'Retry-After-ms': '0' }
        })
    )
    const client = publicApi.createRestClient(endpoint, 'workspace', token)
    const failure: unknown = await client.getAccount().catch((error: unknown) => error)

    expect(failure).toHaveProperty('status', 429)
    expect(failure).toBeInstanceOf(Reflect.get(publicApi, 'RestHttpError'))
    expect((failure as Error).message).toBe('rate-limit')
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
  })
})
