// SPDX-License-Identifier: EPL-2.0

import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { getClient } from '../client'

describe('account client responses', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe.each(['providers', 'RPC'] as const)('%s', (endpoint) => {
    function request (): Promise<unknown> {
      const client = getClient('https://accounts.example.com')
      return endpoint === 'providers' ? client.getProviders() : client.login('user1', '1234')
    }

    it.each([
      ['HTML', '<html><body>504 Gateway Timeout</body></html>'],
      ['plain text', 'Gateway Timeout'],
      ['empty', ''],
      ['JSON without an RPC error', '{}']
    ])('reports the HTTP status for an unsuccessful %s response', async (_name, body) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(body, { status: 504, statusText: 'Gateway Timeout' }))

      await expect(request()).rejects.toThrow('Failed to fetch: 504 Gateway Timeout')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reports the status code when the status text is empty', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))

      await expect(request()).rejects.toThrow('Failed to fetch: 503')
    })

    it('returns a successful JSON response', async () => {
      const result = endpoint === 'providers' ? [{ name: 'google' }] : { account: 'account-id', token: 'token' }
      const body = endpoint === 'providers' ? result : { result }
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)))

      await expect(request()).resolves.toEqual(result)
    })

    it('preserves parsing errors for malformed successful responses', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid JSON'))

      await expect(request()).rejects.toMatchObject({ name: 'SyntaxError' })
    })
  })

  it.each([200, 401, 500])('preserves structured RPC errors with HTTP status %s', async (status) => {
    const error = new Status(Severity.ERROR, platform.status.Unauthorized, {})
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error }), { status }))

    const result = getClient('https://accounts.example.com').login('user1', '1234')

    await expect(result).rejects.toBeInstanceOf(PlatformError)
    await expect(result).rejects.toMatchObject({ status: error })
  })
})
