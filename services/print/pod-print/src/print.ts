//
// Copyright © 2024 Hardcore Engineering Inc.
//
import { MeasureContext } from '@hcengineering/core'
import { type CDPSession, type Page, type Viewport } from 'puppeteer'

import { type PrintBrowserManager, type PrintBrowserPage, withTimeout } from './browser'
import config from './config'
import { ApiError } from './error'
import { isAllowedPrintUrl } from './print-url'
import { Semaphore } from './semaphore'

export interface PrintOptions {
  kind?: ExportKind
  orientation?: PageOrientation
  viewport?: Viewport
}

export const validKinds = ['pdf', 'jpeg', 'png', 'webp'] as const
export const validPageOrientations = ['portrait', 'landscape'] as const

export type ExportKind = (typeof validKinds)[number]
export type PageOrientation = (typeof validPageOrientations)[number]

const printSemaphore = new Semaphore(config.PrintConcurrency)

/**
 * Prints a webpage with the specified options
 * @public
 * @param url - The URL of the webpage to print.
 * @param options - The options to use when printing the webpage.
 * @returns Buffer with the printed content.
 */
export async function print (
  ctx: MeasureContext,
  url: string,
  options: PrintOptions | undefined,
  browserManager: PrintBrowserManager,
  allowedHostnames: readonly string[]
): Promise<Buffer | undefined> {
  if (!isAllowedPrintUrl(url, allowedHostnames)) {
    throw new ApiError(403, 'Cannot process provided link')
  }

  const kind = options?.kind ?? 'pdf'
  const orientation = options?.orientation ?? 'portrait'
  const viewport = options?.viewport ?? { width: 1440, height: 900 }
  const release = await printSemaphore.acquire()
  let browserPage: PrintBrowserPage | undefined
  let popupSession: CDPSession | undefined
  let finished = false

  try {
    ctx.info('print', { url, kind, orientation, viewport })

    browserPage = await browserManager.createPage()
    const page = browserPage.page
    const job = (async () => {
      const session = await page.browser().target().createCDPSession()
      // The context may have been released while session creation was pending.
      if (finished) {
        await session.detach()
        return undefined
      }
      popupSession = session
      await blockPopups(ctx, page, session)
      if (finished) return undefined
      return await render(ctx, page, url, kind, orientation, viewport, allowedHostnames)
    })()
    // After a timeout the job is abandoned; closing its context makes the pending
    // puppeteer calls reject, which must not surface as an unhandled rejection.
    job.catch(() => {})

    return await withTimeout(job, config.PrintTimeoutMs, `Print timed out after ${config.PrintTimeoutMs} ms`)
  } finally {
    finished = true
    try {
      await browserPage?.release()
    } finally {
      try {
        // Detaching resumes paused targets. Keep the guard if closing the context failed;
        // the browser manager will retire that browser once its running jobs finish.
        if (browserPage?.context.closed === true) {
          await popupSession?.detach().catch((err: unknown) => {
            ctx.warn('Failed to detach print popup guard', { err })
          })
        }
      } finally {
        release()
      }
    }
  }
}

async function blockPopups (ctx: MeasureContext, page: Page, session: CDPSession): Promise<void> {
  const pageSession = await page.createCDPSession()
  let mainTargetId: string
  try {
    const { targetInfo } = await pageSession.send('Target.getTargetInfo')
    mainTargetId = targetInfo.targetId
  } finally {
    await pageSession.detach()
  }
  const contextId = page.browserContext().id
  if (contextId === undefined) throw new Error('Print page must have an isolated browser context')

  session.on('Target.attachedToTarget', ({ sessionId, targetInfo, waitingForDebugger }) => {
    void (async () => {
      try {
        if (targetInfo.browserContextId === contextId && targetInfo.targetId !== mainTargetId) {
          // Do not resume the target, even if closing fails. Scope by context rather than
          // openerId to include noopener links, named form targets and blank popups.
          await session.send('Target.closeTarget', { targetId: targetInfo.targetId })
        } else if (waitingForDebugger) {
          // Browser-level auto-attach also sees other print jobs. Release only our own
          // session's pause; their guards and Puppeteer's sessions remain independent.
          const targetSession = session.connection()?.session(sessionId)
          if (targetSession === undefined || targetSession === null) throw new Error('Missing attached target session')
          await targetSession.send('Runtime.runIfWaitingForDebugger')
        }
      } catch (err: unknown) {
        ctx.warn('Failed to handle print popup target', { targetId: targetInfo.targetId, err })
      }
    })()
  })
  // A browser-target session covers new windows before their first request. Page-level
  // auto-attach and the Puppeteer popup/targetcreated events do not provide this guarantee.
  // Only attach pages: iframe and worker/subresource behaviour stays unchanged.
  await session.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: 'page' }]
  })
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'open', { value: () => null, writable: false, configurable: false })
  })
}

async function render (
  ctx: MeasureContext,
  page: Page,
  url: string,
  kind: ExportKind,
  orientation: PageOrientation,
  viewport: Viewport,
  allowedHostnames: readonly string[]
): Promise<Buffer | undefined> {
  page
    .on('pageerror', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      ctx.warn('pageerror', { message })
    })
    .on('requestfailed', (request) => {
      ctx.warn('requestfailed', { url: request.url(), errorText: request.failure()?.errorText })
    })
    .on('request', (request) => {
      void (async () => {
        try {
          // Navigations (including redirects and frames) must stay on allowed hosts. Subresources of the
          // allowed page are not restricted, so external images and other service hosts keep rendering.
          if (!request.isNavigationRequest() || isAllowedPrintUrl(request.url(), allowedHostnames)) {
            await request.continue()
          } else {
            await request.abort('blockedbyclient')
          }
        } catch (err: unknown) {
          ctx.warn('Failed to handle print request', { url: request.url(), err })
        }
      })()
    })

  await page.setBypassServiceWorker(true)
  await page.setRequestInterception(true)
  await page.setViewport(viewport)

  // NOTE: Issues opened with a guest link worked fine only with networkidle0 here and
  // waitForNetworkIdle 1000 afterwards. Also tried 700 but sometimes it was not enough.
  await page.goto(url, {
    waitUntil: ['domcontentloaded', 'networkidle0']
  })
  await page.waitForNetworkIdle({ idleTime: 1000 })

  let res: Uint8Array | undefined

  if (kind === 'pdf') {
    await page.emulateMediaType('print')
    // Scroll throught the page to render all the content (e.g. as images are only rendered
    // when they are visible in the viewport)
    await scrollThrough(page)

    // Read page header and footer if defined
    const pageHeader = await page.evaluate(() => {
      const header = document.querySelector('#page-header')
      return header?.innerHTML ?? ''
    })

    const pageFooter = await page.evaluate(() => {
      const footer = document.querySelector('#page-footer')
      return footer?.innerHTML ?? ''
    })

    const displayHeaderFooter = pageHeader !== '' || pageFooter !== ''

    // No own pdf timeout: the whole job is bounded by PrintTimeoutMs
    res = await ctx.with('pdf', {}, () =>
      page.pdf({
        format: 'A4',
        landscape: orientation === 'landscape',
        timeout: 0,
        headerTemplate: pageHeader,
        footerTemplate: pageFooter,
        displayHeaderFooter,
        margin: {
          top: '1.5cm',
          right: '1cm',
          bottom: '1.5cm',
          left: '1cm'
        }
      })
    )
  } else {
    // Note: currently we do not take the full page screenshot - only the viewport
    // might make it configurable in the future
    res = await ctx.with('screenshot', { kind }, () => page.screenshot({ type: kind }))
  }

  return res !== undefined ? Buffer.from(res) : undefined
}

async function scrollThrough (page: Page): Promise<void> {
  const MAX_SCROLLS = 10
  const TIMEOUT_BETWEEN_SCROLLS_MS = 400

  await page.evaluate(
    async (maxScrolls, timeoutBetweenScrollsMs) => {
      let oldScrollY: number = 0
      let newScrollY: number = 0
      let count = 0

      do {
        oldScrollY = window.scrollY
        window.scrollBy(0, window.innerHeight)
        newScrollY = window.scrollY
        // Wait for the page to render previously loaded images
        // as they are only displayed when visible also content dependent on
        // intersection observers etc...
        await new Promise((resolve) => setTimeout(resolve, timeoutBetweenScrollsMs))
      } while (oldScrollY < newScrollY && count++ < maxScrolls)
    },
    MAX_SCROLLS,
    TIMEOUT_BETWEEN_SCROLLS_MS
  )
}
