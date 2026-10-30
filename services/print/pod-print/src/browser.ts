//
// Copyright © 2026 Hardcore Engineering Inc.
//

import puppeteer, { type Browser, type BrowserContext, type CDPSession, type Page } from 'puppeteer'

import config from './config'

export type BrowserStatus = 'not_started' | 'launching' | 'connected' | 'disconnected'

export interface PrintBrowserPage {
  context: BrowserContext
  page: Page
  /**
   * Closes the page context and releases its hold on the browser.
   * Safe to call more than once.
   */
  release: () => Promise<void>
}

export interface PrintBrowserOptions {
  /** Timeout for initializing the guard, creating a context/page or closing a context */
  pageInitTimeoutMs: number
  /** Retire the browser after this many pages; 0 disables recycling */
  maxPagesPerBrowser: number
}

/** Delay before a blocked popup target is closed, see PrintBrowserManager.holdPopup */
export const POPUP_CLOSE_DELAY_MS = 1500

interface PrintPopupGuard {
  session: CDPSession
  contexts: Map<string, string>
}

async function getMainTargetId (page: Page): Promise<string> {
  const session = await page.createCDPSession()
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo')
    return targetInfo.targetId
  } finally {
    await session.detach()
  }
}

function getLaunchOptions (): Parameters<typeof puppeteer.launch>[0] {
  return {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-setuid-sandbox',
      ...config.PuppeteerArgs
    ]
  }
}

export class TimeoutError extends Error {}

export async function withTimeout<T> (promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new TimeoutError(message))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

/**
 * Keeps one "hot" browser for print jobs.
 *
 * Each job gets its own browser context, so jobs do not share cookies or storage.
 * A browser that misbehaves (cannot create a page, cannot close a context, or has
 * served maxPagesPerBrowser pages) is retired: new jobs go to a freshly launched
 * browser, while jobs that are still running on the retired one finish normally.
 * The retired browser is closed once its last page is released.
 */
export class PrintBrowserManager {
  private browser: Browser | undefined
  private launchPromise: Promise<Browser> | undefined
  private readonly activePages = new Map<Browser, number>()
  private readonly pagesServed = new Map<Browser, number>()
  private readonly retired = new Set<Browser>()
  private readonly popupGuards = new Map<Browser, PrintPopupGuard>()

  constructor (
    private readonly options: PrintBrowserOptions = {
      pageInitTimeoutMs: config.PageInitTimeoutMs,
      maxPagesPerBrowser: config.BrowserMaxPages
    }
  ) {}

  getStatus (): BrowserStatus {
    if (this.browser !== undefined) {
      return this.browser.connected ? 'connected' : 'disconnected'
    }

    return this.launchPromise !== undefined ? 'launching' : 'not_started'
  }

  async getBrowser (): Promise<Browser> {
    if (this.browser !== undefined && this.browser.connected) {
      return this.browser
    }

    if (this.browser !== undefined) {
      await this.retire(this.browser)
    }

    if (this.launchPromise === undefined) {
      const launchPromise = puppeteer
        .launch(getLaunchOptions())
        .then(async (launchedBrowser) => {
          try {
            // Publish the browser only after its single guard is ready for all jobs.
            await withTimeout(
              this.installPopupGuard(launchedBrowser),
              this.options.pageInitTimeoutMs,
              'Browser popup guard creation timed out'
            )
          } catch (err) {
            await this.closeBrowser(launchedBrowser)
            this.forget(launchedBrowser)
            throw err
          }
          if (this.launchPromise === launchPromise) {
            this.browser = launchedBrowser
          } else {
            // The manager was closed while launching
            void this.closeBrowser(launchedBrowser)
          }
          launchedBrowser.on('disconnected', () => {
            if (this.browser === launchedBrowser) {
              this.browser = undefined
              this.launchPromise = undefined
            }
            this.forget(launchedBrowser)
          })
          return launchedBrowser
        })
        .catch((err) => {
          if (this.launchPromise === launchPromise) {
            this.launchPromise = undefined
          }
          throw err
        })
      this.launchPromise = launchPromise
    }

    return await this.launchPromise
  }

  async createPage (): Promise<PrintBrowserPage> {
    const browser = await this.getBrowser()

    try {
      return await this.createPageInBrowser(browser)
    } catch (err) {
      // Only retire the browser: jobs that already run on it keep their pages,
      // it is closed when the last of them is released.
      await this.retire(browser)
      return await this.createPageInBrowser(await this.getBrowser())
    }
  }

  async close (): Promise<void> {
    const currentBrowser = this.browser
    const currentLaunchPromise = this.launchPromise

    this.browser = undefined
    this.launchPromise = undefined

    const launchedBrowser = currentBrowser ?? (await currentLaunchPromise?.catch(() => undefined))
    const browsers = new Set([...this.retired, ...this.activePages.keys()])
    if (launchedBrowser !== undefined) {
      browsers.add(launchedBrowser)
    }

    await Promise.all(
      Array.from(browsers).map(async (browser) => {
        this.forget(browser)
        await this.closeBrowser(browser)
      })
    )
  }

  private async installPopupGuard (browser: Browser): Promise<void> {
    const session = await browser.target().createCDPSession()
    if (!browser.connected) {
      await session.detach().catch(() => {})
      throw new Error('Browser disconnected while creating popup guard')
    }
    const contexts = new Map<string, string>()
    this.popupGuards.set(browser, { session, contexts })
    session.on('Target.attachedToTarget', ({ sessionId, targetInfo, waitingForDebugger }) => {
      void (async () => {
        try {
          const mainTargetId = targetInfo.browserContextId === undefined
            ? undefined
            : contexts.get(targetInfo.browserContextId)
          if (mainTargetId !== undefined && targetInfo.targetId !== mainTargetId) {
            // Never resume an extra target, even if holding or closing it fails.
            await this.holdPopup(session, sessionId, targetInfo.targetId)
          } else if (waitingForDebugger) {
            const targetSession = session.connection()?.session(sessionId)
            if (targetSession === undefined || targetSession === null) throw new Error('Missing attached target session')
            await targetSession.send('Runtime.runIfWaitingForDebugger')
          }
        } catch (err: unknown) {
          console.warn('Failed to handle print popup target', { targetId: targetInfo.targetId, err })
        }
      })()
    })
    // A browser-level guard pauses popups before their first script runs.
    await session.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      // Chrome rejects 'tab' and 'page' together; page targets cover popups, links and form targets (verified live).
      filter: [{ type: 'page' }]
    })
  }

  /**
   * Neutralizes an extra target of a print context: it stays paused (never resumed)
   * and every request it could still make is failed before it leaves the browser.
   * Closing is deferred: closing a popup while its opener is still inside the
   * synchronous popup creation (window.open, link or form target) leaves the opener
   * blocked, so concurrent popups of different jobs would hang Runtime/PDF calls.
   */
  private async holdPopup (session: CDPSession, sessionId: string, targetId: string): Promise<void> {
    const close = async (): Promise<void> => {
      await session.send('Target.closeTarget', { targetId })
    }
    try {
      const targetSession = session.connection()?.session(sessionId)
      if (targetSession === undefined || targetSession === null) throw new Error('Missing attached target session')
      targetSession.on('Fetch.requestPaused', ({ requestId }) => {
        void targetSession.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {})
      })
      await targetSession.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    } catch (err: unknown) {
      // Cannot intercept requests: closing right away is the only safe option.
      console.warn('Failed to block print popup requests, closing it immediately', { targetId, err })
      await close()
      return
    }
    const timer = setTimeout(() => {
      close().catch((err: unknown) => {
        // The popup is already gone when its context or reused named window was closed first
        if (err instanceof Error && err.message.includes('No target with given id')) return
        console.warn('Failed to close print popup target', { targetId, err })
      })
    }, POPUP_CLOSE_DELAY_MS)
    timer.unref()
  }

  private async closeContext (browser: Browser, context: BrowserContext): Promise<void> {
    await context.close()
    // Keep the registration until closure actually completes, even after a timeout.
    if (context.id !== undefined) this.popupGuards.get(browser)?.contexts.delete(context.id)
  }

  private async createPageInBrowser (browser: Browser): Promise<PrintBrowserPage> {
    let context: BrowserContext | undefined
    const timeoutMs = this.options.pageInitTimeoutMs

    this.acquire(browser)
    try {
      context = await withTimeout(browser.createBrowserContext(), timeoutMs, 'Browser context creation timed out')
      const page = await withTimeout(context.newPage(), timeoutMs, 'Browser page creation timed out')
      const mainTargetId = await withTimeout(getMainTargetId(page), timeoutMs, 'Browser page target lookup timed out')
      const guard = this.popupGuards.get(browser)
      if (context.id === undefined || guard === undefined) throw new Error('Missing isolated print context or popup guard')
      // The initial blank page/tab is resumed while unregistered. Register before
      // handing the page to a job so every subsequent target in this context is guarded.
      guard.contexts.set(context.id, mainTargetId)
      return { context, page, release: this.createRelease(browser, context) }
    } catch (err) {
      if (context !== undefined) {
        await withTimeout(this.closeContext(browser, context), timeoutMs, 'Browser context close timed out').catch(() => {})
      }
      await this.releaseBrowser(browser)
      throw new Error(`Failed to create browser page: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private createRelease (browser: Browser, context: BrowserContext): () => Promise<void> {
    let released = false
    return async () => {
      if (released) return
      released = true

      try {
        await withTimeout(this.closeContext(browser, context), this.options.pageInitTimeoutMs, 'Browser context close timed out')
      } catch {
        // A context that cannot be closed means the browser is unhealthy
        this.retired.add(browser)
        if (this.browser === browser) {
          this.browser = undefined
          this.launchPromise = undefined
        }
      }
      await this.releaseBrowser(browser)
    }
  }

  private acquire (browser: Browser): void {
    this.activePages.set(browser, (this.activePages.get(browser) ?? 0) + 1)
    const served = (this.pagesServed.get(browser) ?? 0) + 1
    this.pagesServed.set(browser, served)

    const maxPages = this.options.maxPagesPerBrowser
    if (maxPages > 0 && served >= maxPages) {
      // Recycle against memory growth; closed after its last page is released
      this.retired.add(browser)
      if (this.browser === browser) {
        this.browser = undefined
        this.launchPromise = undefined
      }
    }
  }

  private async releaseBrowser (browser: Browser): Promise<void> {
    const active = (this.activePages.get(browser) ?? 1) - 1
    if (active > 0) {
      this.activePages.set(browser, active)
      return
    }
    this.activePages.delete(browser)
    if (this.retired.has(browser)) {
      this.forget(browser)
      await this.closeBrowser(browser)
    }
  }

  private async retire (browser: Browser): Promise<void> {
    if (this.browser === browser) {
      this.browser = undefined
      this.launchPromise = undefined
    }
    if ((this.activePages.get(browser) ?? 0) > 0) {
      this.retired.add(browser)
      return
    }
    this.forget(browser)
    await this.closeBrowser(browser)
  }

  private forget (browser: Browser): void {
    this.retired.delete(browser)
    this.activePages.delete(browser)
    this.pagesServed.delete(browser)
    this.popupGuards.delete(browser)
  }

  private async closeBrowser (browser: Browser): Promise<void> {
    if (browser.connected) {
      await browser.close().catch(() => {})
    }
  }
}
