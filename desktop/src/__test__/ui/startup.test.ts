// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import type { IPCMainExposed } from '../../ui/types'
import { IpcMessage } from '../../ui/ipcMessages'

const template = readFileSync(join(__dirname, '../../ui/index.ejs'), 'utf8')
const render = require('ejs').render as (template: string, parameters: { isWindows: boolean }) => string
const mockConfigure = jest.fn()
const mockCreateApp = jest.fn()
const originalFetch = global.fetch
const mockIpc = {
  on: jest.fn(),
  handleDeepLink: jest.fn(),
  handleNotificationNavigation: jest.fn(),
  handleUpdateDownloadProgress: jest.fn(),
  handleAuth: jest.fn(),
  handleDownloadItem: jest.fn()
}

async function flushPromises (): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

describe('desktop startup shell', () => {
  let listeners: jest.SpyInstance
  const parameters = { getBranding: () => ({ getTitle: () => 'Huly Test' }) }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] })
    mockConfigure.mockReset()
    document.body.innerHTML = render(template, { isWindows: false })
    localStorage.setItem('lang', 'en')
    jest.spyOn(console, 'error').mockImplementation(() => {})

    const packages = [
      'login', 'love', 'time', 'presentation', 'desktop-downloads', 'notification', 'inbox', 'workbench',
      'view', 'notification-resources', 'workbench-resources', 'card', 'communication', 'core'
    ]
    for (const name of packages) {
      jest.doMock(`@hcengineering/${name}`, () => ({}), { virtual: true })
    }
    jest.doMock('@hcengineering/platform', () => ({
      translate: async (value: string) => value
    }), { virtual: true })
    jest.doMock('@hcengineering/setting', () => ({
      __esModule: true,
      default: { string: { Disconnected: 'Disconnected', Reconnect: 'Reconnect' } }
    }), { virtual: true })
    jest.doMock('@hcengineering/ui', () => ({ createApp: mockCreateApp }), { virtual: true })
    jest.doMock('@hcengineering/theme', () => ({}), { virtual: true })
    jest.doMock('../../ui/platform', () => ({ configurePlatform: mockConfigure }))
    jest.doMock('../../ui/titleBarMenu', () => ({}))
    jest.doMock('../../ui/screenShare', () => ({ defineScreenShare: jest.fn(), defineGetDisplayMedia: jest.fn() }))
    jest.doMock('../../ui/typesUtils', () => ({ ipcMainExposed: () => mockIpc }))
    listeners = jest.spyOn(window, 'addEventListener')
  })

  afterEach(() => {
    for (const [event, listener] of listeners.mock.calls) {
      window.removeEventListener(event, listener)
    }
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
    global.fetch = originalFetch
    localStorage.clear()
  })

  function start (): void {
    require('../../ui/index')
    const listener = listeners.mock.calls.find(([event]) => event === 'DOMContentLoaded')?.[1] as EventListener
    listener(new Event('DOMContentLoaded'))
  }

  function retryButton (): HTMLButtonElement {
    return document.getElementById('desktop-startup-retry') as HTMLButtonElement
  }

  test.each([false, true])('renders a loading shell before configuration (Windows: %s)', (isWindows) => {
    document.body.innerHTML = render(template, { isWindows })

    expect(document.getElementById('desktop-startup')?.textContent).toContain('Huly')
    expect(document.getElementById('desktop-startup-progress')).not.toBeNull()
    expect(document.getElementById('desktop-app-titlebar-root') !== null).toBe(isWindows)
  })

  test.each(['click', 'online'])('offline startup recovers through %s and mounts only once', async (event) => {
    let exposed: IPCMainExposed
    jest.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: (_name: string, api: IPCMainExposed) => { exposed = api } },
      ipcRenderer: {
        invoke: async (message: string) => message === IpcMessage.GetHost
          ? 'huly.test'
          : { FRONT_URL: 'https://huly.test', CONFIG_URL: '/config.json' },
        send: jest.fn()
      }
    }), { virtual: true })
    const fetchConfig = jest.fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockImplementation(async (url: string) => {
        const data = url.endsWith('branding.json') ? { 'huly.test': { title: 'Huly Test' } } : { UPLOAD_URL: '/upload' }
        return { ok: true, json: async () => data }
      })
    global.fetch = fetchConfig
    jest.spyOn(console, 'log').mockImplementation(() => {})
    require('../../ui/preload')
    mockConfigure.mockImplementation(async () => {
      await exposed.config()
      await exposed.branding()
      return parameters
    })
    start()
    await flushPromises()

    expect(mockCreateApp).not.toHaveBeenCalled()
    expect(document.getElementById('desktop-startup-status')?.textContent).toBe('Disconnected')
    expect(retryButton().hidden).toBe(false)
    expect(retryButton().textContent).toBe('Reconnect')

    if (event === 'click') {
      retryButton().click()
    } else {
      window.dispatchEvent(new Event('online'))
    }
    await flushPromises()

    expect(mockConfigure).toHaveBeenCalledTimes(2)
    expect(mockCreateApp).toHaveBeenCalledTimes(1)
    expect(mockCreateApp).toHaveBeenCalledWith(document.body)
    expect(document.getElementById('desktop-startup')).toBeNull()
    expect(fetchConfig).toHaveBeenCalledTimes(3)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(mockConfigure).toHaveBeenCalledTimes(2)
  })

  test('retries automatically after a failed startup', async () => {
    mockConfigure.mockRejectedValueOnce(new Error('Server unreachable')).mockResolvedValue(parameters)
    start()
    await flushPromises()

    expect(mockCreateApp).not.toHaveBeenCalled()
    expect(retryButton().hidden).toBe(false)

    jest.advanceTimersByTime(5000)
    await flushPromises()

    expect(mockConfigure).toHaveBeenCalledTimes(2)
    expect(mockCreateApp).toHaveBeenCalledTimes(1)
    expect(document.getElementById('desktop-startup')).toBeNull()
  })

  test('keeps the shell visible while config loads and prevents overlapping attempts', async () => {
    let resolveConfig: (value: typeof parameters) => void = () => {}
    mockConfigure.mockReturnValue(new Promise((resolve) => { resolveConfig = resolve }))
    start()
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(document.getElementById('desktop-startup')).not.toBeNull()
    expect(retryButton().disabled).toBe(true)
    expect(mockConfigure).toHaveBeenCalledTimes(1)

    resolveConfig(parameters)
    await flushPromises()
    expect(mockCreateApp).toHaveBeenCalledTimes(1)
    expect(mockConfigure).toHaveBeenCalledTimes(1)
  })

  test('retries if connectivity returns before an in-flight offline request rejects', async () => {
    let rejectConfig: (error: Error) => void = () => {}
    mockConfigure.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectConfig = reject }))
      .mockResolvedValue(parameters)
    start()
    window.dispatchEvent(new Event('online'))
    rejectConfig(new Error('Previous offline request failed'))
    await flushPromises()

    expect(mockConfigure).toHaveBeenCalledTimes(2)
    expect(mockCreateApp).toHaveBeenCalledTimes(1)
    expect(document.getElementById('desktop-startup')).toBeNull()
  })
})
