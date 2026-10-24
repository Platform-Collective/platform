// SPDX-License-Identifier: EPL-2.0

import type { IPCMainExposed } from '../../ui/types'
import { IpcMessage } from '../../ui/ipcMessages'

const mockExpose = jest.fn()
const mockInvoke = jest.fn()
const mockSend = jest.fn()
const mockFetch = jest.fn()

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExpose },
  ipcRenderer: { invoke: mockInvoke, send: mockSend }
}), { virtual: true })

async function flushPromises (): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

describe('desktop startup configuration', () => {
  let exposed: IPCMainExposed
  const originalFetch = global.fetch
  const mainConfig = { FRONT_URL: 'https://huly.test', CONFIG_URL: '/config.json', VERSION: 'desktop' }
  const serverConfig = { UPLOAD_URL: '/upload', MODEL_VERSION: 'model' }

  beforeEach(() => {
    jest.useFakeTimers()
    jest.resetModules()
    jest.clearAllMocks()
    mockFetch.mockReset()
    mockInvoke.mockImplementation(async (message: string) => {
      return message === IpcMessage.GetHost ? 'huly.test' : mainConfig
    })
    global.fetch = mockFetch
    jest.spyOn(console, 'log').mockImplementation(() => {})
    require('../../ui/preload')
    exposed = mockExpose.mock.calls[0][1] as IPCMainExposed
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  test('shares a successful config request and preserves the combined config', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => serverConfig })
    const [first, second] = await Promise.all([exposed.config(), exposed.config()])

    expect(first).toBe(second)
    expect(first).toMatchObject({
      ...mainConfig,
      MODEL_VERSION: 'model',
      UPLOAD_URL: 'https://huly.test/upload'
    })
    expect(await exposed.config()).toBe(first)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(IpcMessage.SetCombinedConfig, first)
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(['network', 'http', 'json', 'ipc'])('%s failure permits a fresh config request', async (failure) => {
    if (failure === 'network') {
      mockFetch.mockRejectedValueOnce(new Error('Offline'))
    } else if (failure === 'http') {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => serverConfig })
    } else if (failure === 'json') {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('Invalid JSON') } })
    } else {
      mockInvoke.mockRejectedValueOnce(new Error('IPC unavailable'))
    }
    let rejected = false
    void exposed.config().catch(() => { rejected = true })
    await flushPromises()

    expect(rejected).toBe(true)
    expect(mockSend).not.toHaveBeenCalled()

    mockFetch.mockResolvedValue({ ok: true, json: async () => serverConfig })
    await expect(exposed.config()).resolves.toMatchObject({ VERSION: 'desktop' })
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([false, true])('times out a stalled request (headers: %s) and reconnects', async (headersReceived) => {
    let signal: AbortSignal | undefined
    mockFetch.mockImplementationOnce(async (_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal
      const stalled = new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('Aborted')) })
      })
      return headersReceived ? { ok: true, json: async () => await stalled } : await stalled
    })
    let rejected = false
    void exposed.config().catch(() => { rejected = true })
    await flushPromises()
    await jest.advanceTimersByTimeAsync(10000)

    expect(rejected).toBe(true)
    expect(signal?.aborted).toBe(true)

    mockFetch.mockResolvedValue({ ok: true, json: async () => serverConfig })
    await expect(exposed.config()).resolves.toMatchObject({ VERSION: 'desktop' })
    expect(jest.getTimerCount()).toBe(0)
  })

  test('bounds branding requests and retries branding after a failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => serverConfig })
    await exposed.config()
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    await expect(exposed.branding()).rejects.toThrow('503')

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ 'huly.test': { title: 'Huly Test' } }) })
    await expect(exposed.branding()).resolves.toEqual({ title: 'Huly Test' })
    expect(jest.getTimerCount()).toBe(0)
  })
})
