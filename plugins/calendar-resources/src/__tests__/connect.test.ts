// SPDX-License-Identifier: EPL-2.0

import { connectCalendar } from '../connect'

describe('connectCalendar', () => {
  const url = new URL('https://calendar.example/signin?redirectURL=https%3A%2F%2Ffront.example%2Fcalendar')
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
  const openMock = jest.fn()
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    openMock.mockReturnValue(null)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { open: openMock } })
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', originalWindow)
    }
  })

  it('opens the authentication URL returned by the calendar service', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'https://accounts.google.com/oauth'
    } as unknown as Response)

    await connectCalendar(url, 'token')

    expect(fetchMock).toHaveBeenCalledWith(url.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      signal: expect.any(AbortSignal)
    })
    expect(openMock).toHaveBeenCalledWith(
      'https://accounts.google.com/oauth',
      '_blank',
      'location=yes,height=870,width=720,scrollbars=yes,status=yes'
    )
    expect(jest.getTimerCount()).toBe(0)
  })

  it('rejects when the calendar service is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(connectCalendar(url, 'token')).rejects.toThrow('Failed to fetch')

    expect(openMock).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it.each([401, 500, 502])('rejects HTTP %s', async (status) => {
    const text = jest.fn()
    fetchMock.mockResolvedValue({ ok: false, status, text } as unknown as Response)

    await expect(connectCalendar(url, 'token')).rejects.toThrow(String(status))

    expect(text).not.toHaveBeenCalled()
    expect(openMock).not.toHaveBeenCalled()
  })

  it('rejects an empty authentication URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => ' ' } as unknown as Response)

    await expect(connectCalendar(url, 'token')).rejects.toThrow()

    expect(openMock).not.toHaveBeenCalled()
  })

  it('aborts a request that does not complete within 30 seconds', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      return await new Promise<Response>((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new Error('Request aborted'))
        })
      })
    })
    const connection = connectCalendar(url, 'token')
    const rejection = expect(connection).rejects.toThrow('Request aborted')

    await jest.advanceTimersByTimeAsync(30000)
    await rejection

    expect(openMock).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
