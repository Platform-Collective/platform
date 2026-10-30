//
// Copyright © 2026 Hardcore Engineering Inc.
//

import { type MeasureContext } from '@hcengineering/core'
import { runInNewContext } from 'node:vm'

interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

interface MockCDPSession {
  id?: string
  on: jest.Mock
  send: jest.Mock
  detach: jest.Mock
  connection: () => { session: (id: string) => MockCDPSession | undefined }
}

function deferred<T = void> (): Deferred<T> {
  let _resolve!: (value: T | PromiseLike<T>) => void
  let _reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    _resolve = resolve
    _reject = reject
  })
  return { promise, resolve: _resolve, reject: _reject }
}

async function flush (): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function createCtx (): MeasureContext {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    with: jest.fn(
      async (_name: string, _metrics: object, fn: (ctx: MeasureContext) => Promise<any>) => await fn(createCtx())
    )
  } as any
}

function createPage (overrides: Partial<Record<string, jest.Mock>> = {}): any {
  const page = {
    on: jest.fn().mockReturnThis(),
    evaluateOnNewDocument: jest.fn().mockResolvedValue(undefined),
    createCDPSession: jest.fn(),
    setRequestInterception: jest.fn().mockResolvedValue(undefined),
    setBypassServiceWorker: jest.fn().mockResolvedValue(undefined),
    setViewport: jest.fn().mockResolvedValue(undefined),
    goto: jest.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
    emulateMediaType: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(''),
    pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('png')),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides
  }

  return page
}

function createBrowser (pageFactory: () => any = () => createPage(), overrides: Record<string, jest.Mock> = {}): any {
  const sessions: MockCDPSession[] = []
  const browser: any = {
    connected: true,
    listeners: new Map<string, () => void>(),
    contexts: [] as any[],
    sessions,
    target: () => ({
      createCDPSession: jest.fn(async () => {
        const session = {
          on: jest.fn().mockReturnThis(),
          send: jest.fn().mockResolvedValue({ success: true }),
          detach: jest.fn().mockResolvedValue(undefined),
          connection: () => ({ session: (id: string) => sessions.find((entry) => entry.id === id) })
        }
        sessions.push(session)
        return session
      })
    }),
    on: jest.fn((event: string, listener: () => void) => {
      browser.listeners.set(event, listener)
      return browser
    }),
    close: jest.fn(async () => {
      browser.connected = false
    }),
    createBrowserContext: jest.fn(async () => {
      const page = pageFactory()
      const context = {
        id: `context-${browser.contexts.length}`,
        closed: false,
        page,
        newPage: jest.fn(async () => page),
        close: jest.fn(async () => {
          context.closed = true
        })
      }
      page.browser = () => browser
      page.browserContext = () => context
      page.createCDPSession.mockResolvedValue({
        send: jest.fn().mockResolvedValue({
          targetInfo: { targetId: `page-${browser.contexts.length}`, browserContextId: context.id }
        }),
        detach: jest.fn().mockResolvedValue(undefined)
      })
      browser.contexts.push(context)
      return context
    }),
    disconnect: () => {
      browser.connected = false
      browser.listeners.get('disconnected')?.()
    },
    ...overrides
  }

  return browser
}

async function loadPrintModule (
  launch: jest.Mock,
  printConcurrency = '1',
  env: Record<string, string> = {}
): Promise<{
  print: (ctx: MeasureContext, url: string, options?: import('./print').PrintOptions) => Promise<Buffer | undefined>
  closePrintBrowser: () => Promise<void>
}> {
  jest.resetModules()
  process.env.SECRET = 'secret'
  process.env.ACCOUNTS_URL = 'http://accounts'
  process.env.FRONT_URL = 'http://front'
  process.env.PRINT_CONCURRENCY = printConcurrency
  process.env.ALLOWED_HOSTNAMES = 'example.com'
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }

  jest.doMock('puppeteer', () => ({
    __esModule: true,
    default: {
      launch
    }
  }))

  const printModule = await import('./print')
  const config = (await import('./config')).default
  const { PrintBrowserManager } = await import('./browser')
  const browserManager = new PrintBrowserManager()

  return {
    print: async (ctx, url, options) =>
      await printModule.print(ctx, url, options, browserManager, config.AllowedHostnames),
    closePrintBrowser: async () => {
      await browserManager.close()
    }
  }
}

describe('print', () => {
  afterEach(() => {
    jest.dontMock('puppeteer')
    delete process.env.PRINT_CONCURRENCY
    delete process.env.PRINT_TIMEOUT_MS
    delete process.env.PRINT_PAGE_INIT_TIMEOUT_MS
    delete process.env.PRINT_BROWSER_MAX_PAGES
    delete process.env.ALLOWED_HOSTNAMES
  })

  it.each([
    ['', 'http://example.com/'],
    ['example.com', 'http://169.254.169.254/latest/meta-data/'],
    ['example.com', 'http://127.0.0.1/'],
    ['example.com', 'http://localhost/']
  ])('rejects %s / %s before launching a browser', async (allowedHostnames, url) => {
    const launch = jest.fn().mockResolvedValue(createBrowser())
    const { print } = await loadPrintModule(launch, '1', { ALLOWED_HOSTNAMES: allowedHostnames })

    await expect(print(createCtx(), url)).rejects.toMatchObject({ code: 403 })
    expect(launch).not.toHaveBeenCalled()
  })

  it('allows navigations to the front page and any subresources while blocking other navigations', async () => {
    const page = createPage()
    const browser = createBrowser(() => page)
    const launch = jest.fn().mockResolvedValue(browser)
    const { closePrintBrowser, print } = await loadPrintModule(launch, '1', { ALLOWED_HOSTNAMES: ' HULY.LOCAL. ' })

    page.goto.mockImplementation(async () => {
      expect(page.setRequestInterception).toHaveBeenCalledWith(true)
      expect(page.setBypassServiceWorker).toHaveBeenCalledWith(true)
      const listener = page.on.mock.calls.find(([event]: [string]) => event === 'request')?.[1]
      expect(listener).toBeDefined()
      for (const [url, navigation, allowed] of [
        ['http://huly.local:8087/', true, true],
        ['http://huly.local:8087/app.js', false, true],
        ['https://images.example.com/avatar.png', false, true],
        ['http://169.254.169.254/latest/meta-data/', true, false],
        ['http://127.0.0.1/', true, false],
        ['http://localhost/', true, false],
        ['https://huly.local.evil.example/', true, false],
        ['file:///etc/passwd', true, false]
      ] as const) {
        const request = {
          url: () => url,
          isNavigationRequest: () => navigation,
          continue: jest.fn().mockResolvedValue(undefined),
          abort: jest.fn().mockResolvedValue(undefined)
        }
        await listener(request)
        if (allowed) {
          expect(request.continue).toHaveBeenCalledTimes(1)
          expect(request.abort).not.toHaveBeenCalled()
        } else {
          expect(request.abort).toHaveBeenCalledTimes(1)
          expect(request.continue).not.toHaveBeenCalled()
        }
      }
    })

    await expect(print(createCtx(), 'http://huly.local:8087/')).resolves.toEqual(Buffer.from('pdf'))
    await closePrintBrowser()
  })

  it('blocks window.open before a blank popup can be navigated', async () => {
    const page = createPage()
    const browser = createBrowser(() => page)
    const { closePrintBrowser, print } = await loadPrintModule(jest.fn().mockResolvedValue(browser))
    const request = jest.fn()
    const popup = {
      get location (): string { return 'about:blank' },
      set location (url: string) { request(url) }
    }
    const window = { open: jest.fn((_url: string) => popup) }

    page.goto.mockImplementation(async () => {
      // Run the installed document scripts before the page's own script, as Chromium does.
      for (const [script] of page.evaluateOnNewDocument.mock.calls) {
        runInNewContext(`(${script.toString()})()`, { window })
      }
      runInNewContext(`
        const popup = window.open('about:blank')
        if (popup) popup.location = 'http://169.254.169.254/latest/meta-data/'
      `, { window })
      expect(window.open('about:blank')).toBeNull()
      expect(request).not.toHaveBeenCalled()
    })

    await expect(print(createCtx(), 'http://example.com/')).resolves.toEqual(Buffer.from('pdf'))
    await closePrintBrowser()
  })

  it.each([
    ['target=_blank link', 'http://169.254.169.254/latest/meta-data/'],
    ['named form', 'http://127.0.0.1/'],
    ['native window.open followed by navigation', 'about:blank']
  ])(
    'closes a %s target while its first request is paused',
    async (_source, targetUrl) => {
      const page = createPage()
      const browser = createBrowser(() => page)
      const { closePrintBrowser, print } = await loadPrintModule(jest.fn().mockResolvedValue(browser))
      const request = jest.fn()
      let closed = false

      page.goto.mockImplementation(async () => {
        const session = browser.sessions[0]
        const paused = session?.send.mock.calls.some(([method, params]: [string, Record<string, unknown>]) =>
          method === 'Target.setAutoAttach' && params.autoAttach === true && params.waitForDebuggerOnStart === true &&
          params.flatten === true && JSON.stringify(params.filter) === JSON.stringify([{ type: 'page' }])
        )
        if (!paused) request('http://169.254.169.254/latest/meta-data/')
        expect(request).not.toHaveBeenCalled()

        const listener = session.on.mock.calls.find(([event]: [string]) => event === 'Target.attachedToTarget')?.[1]
        const targetSession = {
          id: 'popup-session',
          send: jest.fn(async (method: string) => {
            if (method === 'Runtime.runIfWaitingForDebugger' && !closed) request(targetUrl)
          })
        }
        browser.sessions.push(targetSession)
        session.send.mockImplementation(async (method: string, params: { targetId?: string }) => {
          if (method === 'Target.closeTarget' && params.targetId === 'popup') closed = true
          return { success: true }
        })
        // An implicit noopener link has no usable opener; scope by browser context instead.
        listener({
          sessionId: 'popup-session',
          targetInfo: { type: 'page', targetId: 'popup', browserContextId: browser.contexts[0].id, url: targetUrl },
          waitingForDebugger: true
        })
        await flush()
        expect(closed).toBe(true)
        expect(request).not.toHaveBeenCalled()
        expect(targetSession.send).not.toHaveBeenCalled()
        expect(session.detach).not.toHaveBeenCalled()
      })

      await expect(print(createCtx(), 'http://example.com/')).resolves.toEqual(Buffer.from('pdf'))
      expect(browser.sessions[0].detach).toHaveBeenCalledTimes(1)
      await closePrintBrowser()
    }
  )

  it('resumes the main page and other contexts without closing their targets', async () => {
    const page = createPage()
    const browser = createBrowser(() => page)
    const { closePrintBrowser, print } = await loadPrintModule(jest.fn().mockResolvedValue(browser))

    page.goto.mockImplementation(async () => {
      const session = browser.sessions[0]
      const listener = session.on.mock.calls.find(([event]: [string]) => event === 'Target.attachedToTarget')?.[1]
      for (const [targetId, browserContextId] of [['page-0', 'context-0'], ['other-page', 'other-context']]) {
        const targetSession = { id: targetId, send: jest.fn().mockResolvedValue(undefined) }
        browser.sessions.push(targetSession)
        listener({ sessionId: targetId, targetInfo: { type: 'page', targetId, browserContextId }, waitingForDebugger: true })
        await flush()
        expect(targetSession.send).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger')
      }
      expect(session.send).not.toHaveBeenCalledWith('Target.closeTarget', expect.anything())
    })

    await expect(print(createCtx(), 'http://example.com/')).resolves.toEqual(Buffer.from('pdf'))
    await closePrintBrowser()
  })

  it('does not load the print page if installing the popup guard fails', async () => {
    const page = createPage()
    const browser = createBrowser(() => page)
    const createSession = browser.target().createCDPSession
    browser.target = () => ({
      createCDPSession: async () => {
        const session = await createSession()
        session.send.mockRejectedValue(new Error('auto-attach failed'))
        return session
      }
    })
    const { closePrintBrowser, print } = await loadPrintModule(jest.fn().mockResolvedValue(browser))

    await expect(print(createCtx(), 'http://example.com/')).rejects.toThrow('auto-attach failed')
    expect(page.goto).not.toHaveBeenCalled()
    expect(browser.contexts[0].closed).toBe(true)
    expect(browser.sessions[0].detach).toHaveBeenCalledTimes(1)
    await closePrintBrowser()
  })

  it('detaches a guard session created after the print job timed out', async () => {
    const page = createPage()
    const browser = createBrowser(() => page)
    const pendingSession = deferred<MockCDPSession>()
    const createSession = browser.target().createCDPSession
    browser.target = () => ({ createCDPSession: () => pendingSession.promise })
    const { closePrintBrowser, print } = await loadPrintModule(jest.fn().mockResolvedValue(browser), '1', {
      PRINT_TIMEOUT_MS: '20'
    })

    await expect(print(createCtx(), 'http://example.com/')).rejects.toThrow('Print timed out after 20 ms')
    expect(browser.contexts[0].closed).toBe(true)
    const session = await createSession()
    pendingSession.resolve(session)
    await flush()
    expect(session.detach).toHaveBeenCalledTimes(1)
    expect(session.send).not.toHaveBeenCalled()
    expect(page.goto).not.toHaveBeenCalled()
    await closePrintBrowser()
  })

  it('keeps a popup paused if closing its target fails', async () => {
    const page = createPage()
    const browser = createBrowser(() => page)
    const ctx = createCtx()
    const { closePrintBrowser, print } = await loadPrintModule(jest.fn().mockResolvedValue(browser))

    page.goto.mockImplementation(async () => {
      const session = browser.sessions[0]
      const targetSession = { id: 'popup-session', send: jest.fn() }
      browser.sessions.push(targetSession)
      session.send.mockRejectedValue(new Error('close failed'))
      const listener = session.on.mock.calls.find(([event]: [string]) => event === 'Target.attachedToTarget')?.[1]
      listener({
        sessionId: targetSession.id,
        targetInfo: { type: 'page', targetId: 'popup', browserContextId: browser.contexts[0].id },
        waitingForDebugger: true
      })
      await flush()
      expect(targetSession.send).not.toHaveBeenCalled()
      expect(session.detach).not.toHaveBeenCalled()
      expect(ctx.warn).toHaveBeenCalledWith('Failed to handle print popup target', expect.anything())
    })

    await expect(print(ctx, 'http://example.com/')).resolves.toEqual(Buffer.from('pdf'))
    await closePrintBrowser()
  })

  it.each(['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/'])(
    'blocks a front-page redirect to %s before rendering',
    async (target) => {
      const page = createPage()
      const browser = createBrowser(() => page)
      const { closePrintBrowser, print } = await loadPrintModule(jest.fn().mockResolvedValue(browser))
      page.goto.mockImplementation(async () => {
        const listener = page.on.mock.calls.find(([event]: [string]) => event === 'request')?.[1]
        expect(listener).toBeDefined()
        const request = {
          url: () => target,
          isNavigationRequest: () => true,
          continue: jest.fn().mockResolvedValue(undefined),
          abort: jest.fn().mockResolvedValue(undefined)
        }
        await listener(request)
        expect(request.abort).toHaveBeenCalledWith('blockedbyclient')
        expect(request.continue).not.toHaveBeenCalled()
        throw new Error('net::ERR_BLOCKED_BY_CLIENT')
      })

      await expect(print(createCtx(), 'http://example.com/redirect')).rejects.toThrow('net::ERR_BLOCKED_BY_CLIENT')
      expect(page.pdf).not.toHaveBeenCalled()
      expect(browser.contexts[0].close).toHaveBeenCalledTimes(1)
      await closePrintBrowser()
    }
  )

  it('reuses the same browser for sequential print jobs', async () => {
    const browser = createBrowser()
    const launch = jest.fn().mockResolvedValue(browser)
    const { closePrintBrowser, print } = await loadPrintModule(launch)

    await print(createCtx(), 'http://example.com/one')
    await print(createCtx(), 'http://example.com/two')

    expect(launch).toHaveBeenCalledTimes(1)
    expect(browser.createBrowserContext).toHaveBeenCalledTimes(2)
    expect(browser.contexts[0].close).toHaveBeenCalledTimes(1)
    expect(browser.contexts[1].close).toHaveBeenCalledTimes(1)

    await closePrintBrowser()
  })

  it('serializes print jobs with PRINT_CONCURRENCY=1', async () => {
    const firstPdf = deferred<Buffer>()
    let pageCount = 0
    const browser = createBrowser(() => {
      pageCount++
      return createPage(pageCount === 1 ? { pdf: jest.fn(() => firstPdf.promise) } : {})
    })
    const launch = jest.fn().mockResolvedValue(browser)
    const { closePrintBrowser, print } = await loadPrintModule(launch)

    const first = print(createCtx(), 'http://example.com/one')
    await flush()

    const second = print(createCtx(), 'http://example.com/two')
    await flush()

    expect(browser.createBrowserContext).toHaveBeenCalledTimes(1)

    firstPdf.resolve(Buffer.from('first'))
    await first
    await second

    expect(browser.createBrowserContext).toHaveBeenCalledTimes(2)

    await closePrintBrowser()
  })

  it('closes context and releases the semaphore when rendering fails', async () => {
    let pageCount = 0
    const browser = createBrowser(() => {
      pageCount++
      return createPage(pageCount === 1 ? { pdf: jest.fn().mockRejectedValue(new Error('pdf failed')) } : {})
    })
    const launch = jest.fn().mockResolvedValue(browser)
    const { closePrintBrowser, print } = await loadPrintModule(launch)

    await expect(print(createCtx(), 'http://example.com/fail')).rejects.toThrow('pdf failed')
    await print(createCtx(), 'http://example.com/next')

    expect(browser.contexts[0].close).toHaveBeenCalledTimes(1)
    expect(browser.createBrowserContext).toHaveBeenCalledTimes(2)

    await closePrintBrowser()
  })

  it('launches a new browser after disconnect', async () => {
    const firstBrowser = createBrowser()
    const secondBrowser = createBrowser()
    const launch = jest.fn().mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser)
    const { closePrintBrowser, print } = await loadPrintModule(launch)

    await print(createCtx(), 'http://example.com/one')
    firstBrowser.disconnect()
    await print(createCtx(), 'http://example.com/two')

    expect(launch).toHaveBeenCalledTimes(2)
    expect(firstBrowser.createBrowserContext).toHaveBeenCalledTimes(1)
    expect(secondBrowser.createBrowserContext).toHaveBeenCalledTimes(1)

    await closePrintBrowser()
  })

  it('launches a new browser when the cached browser cannot create a page', async () => {
    const firstBrowser = createBrowser()
    const secondBrowser = createBrowser()
    const launch = jest.fn().mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser)
    const { closePrintBrowser, print } = await loadPrintModule(launch)

    await print(createCtx(), 'http://example.com/one')
    firstBrowser.createBrowserContext.mockRejectedValueOnce(new Error('browser is not responding'))
    await print(createCtx(), 'http://example.com/two')

    expect(launch).toHaveBeenCalledTimes(2)
    expect(firstBrowser.close).toHaveBeenCalledTimes(1)
    expect(secondBrowser.createBrowserContext).toHaveBeenCalledTimes(1)

    await closePrintBrowser()
  })

  it('closes the hot browser on shutdown', async () => {
    const browser = createBrowser()
    const launch = jest.fn().mockResolvedValue(browser)
    const { closePrintBrowser, print } = await loadPrintModule(launch)

    await print(createCtx(), 'http://example.com/one')
    await closePrintBrowser()
    await closePrintBrowser()

    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('times out a hung print job and keeps serving later jobs', async () => {
    let pageCount = 0
    const browser = createBrowser(() => {
      pageCount++
      // The first page never finishes rendering
      return createPage(pageCount === 1 ? { pdf: jest.fn(() => new Promise(() => {})) } : {})
    })
    const launch = jest.fn().mockResolvedValue(browser)
    const { closePrintBrowser, print } = await loadPrintModule(launch, '1', { PRINT_TIMEOUT_MS: '50' })

    await expect(print(createCtx(), 'http://example.com/hung')).rejects.toThrow('Print timed out after 50 ms')
    expect(browser.contexts[0].close).toHaveBeenCalledTimes(1)

    await expect(print(createCtx(), 'http://example.com/next')).resolves.toEqual(Buffer.from('pdf'))
    expect(launch).toHaveBeenCalledTimes(1)
    expect(browser.close).not.toHaveBeenCalled()

    await closePrintBrowser()
  })

  it('does not kill running jobs when another job cannot create a page', async () => {
    const firstPdf = deferred<Buffer>()
    const firstBrowser = createBrowser(() => createPage({ pdf: jest.fn(() => firstPdf.promise) }))
    const secondBrowser = createBrowser()
    const launch = jest.fn().mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser)
    const { closePrintBrowser, print } = await loadPrintModule(launch, '2')

    const first = print(createCtx(), 'http://example.com/one')
    await flush()
    expect(firstBrowser.createBrowserContext).toHaveBeenCalledTimes(1)

    firstBrowser.createBrowserContext.mockRejectedValueOnce(new Error('browser is not responding'))
    await print(createCtx(), 'http://example.com/two')

    // The broken browser is retired, but stays open for the running job
    expect(launch).toHaveBeenCalledTimes(2)
    expect(secondBrowser.createBrowserContext).toHaveBeenCalledTimes(1)
    expect(firstBrowser.close).not.toHaveBeenCalled()
    expect(firstBrowser.contexts[0].close).not.toHaveBeenCalled()

    firstPdf.resolve(Buffer.from('first'))
    await expect(first).resolves.toEqual(Buffer.from('first'))

    // Closed once its last page is released
    expect(firstBrowser.close).toHaveBeenCalledTimes(1)
    expect(secondBrowser.close).not.toHaveBeenCalled()

    await closePrintBrowser()
  })

  it('uses the configured page init timeout', async () => {
    const firstBrowser = createBrowser()
    const secondBrowser = createBrowser()
    firstBrowser.createBrowserContext.mockImplementationOnce(() => new Promise(() => {}))
    const launch = jest.fn().mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser)
    const { closePrintBrowser, print } = await loadPrintModule(launch, '1', { PRINT_PAGE_INIT_TIMEOUT_MS: '20' })

    await expect(print(createCtx(), 'http://example.com/one')).resolves.toEqual(Buffer.from('pdf'))

    expect(launch).toHaveBeenCalledTimes(2)
    expect(firstBrowser.close).toHaveBeenCalledTimes(1)
    expect(secondBrowser.createBrowserContext).toHaveBeenCalledTimes(1)

    await closePrintBrowser()
  })

  it('retires the browser when a page context cannot be closed', async () => {
    const firstBrowser = createBrowser()
    const secondBrowser = createBrowser()
    const createContext = firstBrowser.createBrowserContext.getMockImplementation()
    firstBrowser.createBrowserContext.mockImplementationOnce(async () => {
      const context = await createContext()
      context.close = jest.fn(() => new Promise(() => {}))
      return context
    })
    const launch = jest.fn().mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser)
    const { closePrintBrowser, print } = await loadPrintModule(launch, '1', { PRINT_PAGE_INIT_TIMEOUT_MS: '20' })

    await print(createCtx(), 'http://example.com/one')
    expect(firstBrowser.createBrowserContext).toHaveBeenCalledTimes(1)
    expect(firstBrowser.sessions[0].detach).not.toHaveBeenCalled()
    expect(firstBrowser.close).toHaveBeenCalledTimes(1)

    await print(createCtx(), 'http://example.com/two')
    expect(launch).toHaveBeenCalledTimes(2)
    expect(secondBrowser.createBrowserContext).toHaveBeenCalledTimes(1)

    await closePrintBrowser()
  })

  it('recycles the browser after PRINT_BROWSER_MAX_PAGES pages', async () => {
    const firstBrowser = createBrowser()
    const secondBrowser = createBrowser()
    const launch = jest.fn().mockResolvedValueOnce(firstBrowser).mockResolvedValueOnce(secondBrowser)
    const { closePrintBrowser, print } = await loadPrintModule(launch, '1', { PRINT_BROWSER_MAX_PAGES: '2' })

    await print(createCtx(), 'http://example.com/one')
    await print(createCtx(), 'http://example.com/two')
    expect(firstBrowser.close).toHaveBeenCalledTimes(1)

    await print(createCtx(), 'http://example.com/three')
    expect(launch).toHaveBeenCalledTimes(2)
    expect(firstBrowser.createBrowserContext).toHaveBeenCalledTimes(2)
    expect(secondBrowser.createBrowserContext).toHaveBeenCalledTimes(1)

    await closePrintBrowser()
    expect(secondBrowser.close).toHaveBeenCalledTimes(1)
  })
})
