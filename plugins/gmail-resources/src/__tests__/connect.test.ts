// SPDX-License-Identifier: EPL-2.0

import { getGmailAuthUrl } from '../connect'

describe('getGmailAuthUrl', () => {
  const signinUrl = 'https://gmail.example.com/signin?redirectURL=https%3A%2F%2Fhuly.example.com'
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test'
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>()
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')

  function response (body: string, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, text: jest.fn().mockResolvedValue(body) } as unknown as Response
  }

  beforeEach(() => {
    jest.useFakeTimers()
    fetchMock.mockReset().mockResolvedValue(response(authUrl))
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock })
  })

  afterEach(() => {
    jest.useRealTimers()
    if (originalFetch === undefined) {
      Reflect.deleteProperty(globalThis, 'fetch')
    } else {
      Object.defineProperty(globalThis, 'fetch', originalFetch)
    }
  })

  it('returns the authorization URL', async () => {
    await expect(getGmailAuthUrl(signinUrl, 'token')).resolves.toBe(authUrl)
    expect(fetchMock).toHaveBeenCalledWith(signinUrl, {
      method: 'GET',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal)
    })
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each([400, 401, 500])('rejects HTTP %s even when the body is a valid URL', async (status) => {
    fetchMock.mockResolvedValue(response(authUrl, status))
    await expect(getGmailAuthUrl(signinUrl, 'token')).rejects.toThrow(`Gmail signin failed: ${status}`)
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each(['', 'not a URL', '/relative', '{"err":"Unavailable"}', 'javascript:alert(1)', 'http://example.com'])(
    'rejects an invalid authorization URL: %s',
    async (body) => {
      fetchMock.mockResolvedValue(response(body))
      await expect(getGmailAuthUrl(signinUrl, 'token')).rejects.toThrow()
      expect(jest.getTimerCount()).toBe(0)
    }
  )

  it('propagates a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('Network unavailable'))
    await expect(getGmailAuthUrl(signinUrl, 'token')).rejects.toThrow('Network unavailable')
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each(['request', 'body'])('aborts a stalled %s after 30 seconds', async (stage) => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation(async (_, options) => {
      signal = options?.signal ?? undefined
      const stalled = new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new Error('Aborted'))
        })
      })
      return stage === 'request' ? await stalled : { ...response(authUrl), text: async () => await stalled }
    })
    const result = getGmailAuthUrl(signinUrl, 'token').then(
      () => 'connected',
      () => 'failed'
    )
    await jest.advanceTimersByTimeAsync(30000)
    expect(await Promise.race([result, Promise.resolve('pending')])).toBe('failed')
    expect(signal?.aborted).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })
})
