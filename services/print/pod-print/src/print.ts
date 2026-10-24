//
// Copyright © 2024 Hardcore Engineering Inc.
//
import { MeasureContext } from '@hcengineering/core'
import { type PDFMargin, type Page, type PaperFormat, type Viewport } from 'puppeteer'

import { type PrintBrowserManager, type PrintBrowserPage, withTimeout } from './browser'
import config from './config'
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

export const printSemaphore = new Semaphore(config.PrintConcurrency)

/**
 * Paper and decorations of a printed document.
 */
export interface PdfLayout {
  format?: PaperFormat
  width?: string
  height?: string
  landscape?: boolean
  margin: PDFMargin
  // Override the #page-header / #page-footer provided by the page itself
  headerTemplate?: string
  footerTemplate?: string
  // Stylesheet injected into the page before printing
  contentCss?: string
  printBackground?: boolean
}

const defaultMargin: PDFMargin = {
  top: '1.5cm',
  right: '1cm',
  bottom: '1.5cm',
  left: '1cm'
}

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
  browserManager: PrintBrowserManager
): Promise<Buffer | undefined> {
  const kind = options?.kind ?? 'pdf'
  const orientation = options?.orientation ?? 'portrait'
  const viewport = options?.viewport ?? { width: 1440, height: 900 }
  const release = await printSemaphore.acquire()
  let browserPage: PrintBrowserPage | undefined

  try {
    ctx.info('print', { url, kind, orientation, viewport })

    browserPage = await browserManager.createPage()
    const job = render(ctx, browserPage.page, url, kind, orientation, viewport)
    // After a timeout the job is abandoned; closing its context makes the pending
    // puppeteer calls reject, which must not surface as an unhandled rejection.
    job.catch(() => {})

    return await withTimeout(job, config.PrintTimeoutMs, `Print timed out after ${config.PrintTimeoutMs} ms`)
  } finally {
    try {
      await browserPage?.release()
    } finally {
      release()
    }
  }
}

async function render (
  ctx: MeasureContext,
  page: Page,
  url: string,
  kind: ExportKind,
  orientation: PageOrientation,
  viewport: Viewport
): Promise<Buffer | undefined> {
  await openPage(ctx, page, url, viewport)

  let res: Uint8Array | undefined

  if (kind === 'pdf') {
    res = await printOpenedPage(ctx, page, {
      format: 'A4',
      landscape: orientation === 'landscape',
      margin: defaultMargin
    })
  } else {
    // Note: currently we do not take the full page screenshot - only the viewport
    // might make it configurable in the future
    res = await ctx.with('screenshot', { kind }, () => page.screenshot({ type: kind }))
  }

  return res !== undefined ? Buffer.from(res) : undefined
}

/**
 * Open the URL and print it to PDF with the given layout.
 */
export async function renderPdf (
  ctx: MeasureContext,
  page: Page,
  url: string,
  layout: PdfLayout,
  viewport: Viewport = { width: 1440, height: 900 }
): Promise<Uint8Array> {
  await openPage(ctx, page, url, viewport)
  return await printOpenedPage(ctx, page, layout)
}

async function openPage (ctx: MeasureContext, page: Page, url: string, viewport: Viewport): Promise<void> {
  page
    .on('pageerror', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      ctx.warn('pageerror', { message })
    })
    .on('requestfailed', (request) => {
      ctx.warn('requestfailed', { url: request.url(), errorText: request.failure()?.errorText })
    })

  await page.setViewport(viewport)

  // NOTE: Issues opened with a guest link worked fine only with networkidle0 here and
  // waitForNetworkIdle 1000 afterwards. Also tried 700 but sometimes it was not enough.
  await page.goto(url, {
    waitUntil: ['domcontentloaded', 'networkidle0']
  })
  await page.waitForNetworkIdle({ idleTime: 1000 })
}

async function printOpenedPage (ctx: MeasureContext, page: Page, layout: PdfLayout): Promise<Uint8Array> {
  await page.emulateMediaType('print')
  if (layout.contentCss !== undefined && layout.contentCss !== '') {
    await page.addStyleTag({ content: layout.contentCss })
  }
  // Scroll throught the page to render all the content (e.g. as images are only rendered
  // when they are visible in the viewport)
  await scrollThrough(page)

  // Read page header and footer if defined
  const pageHeader =
    layout.headerTemplate ??
    (await page.evaluate(() => {
      const header = document.querySelector('#page-header')
      return header?.innerHTML ?? ''
    }))

  const pageFooter =
    layout.footerTemplate ??
    (await page.evaluate(() => {
      const footer = document.querySelector('#page-footer')
      return footer?.innerHTML ?? ''
    }))

  const displayHeaderFooter = pageHeader !== '' || pageFooter !== ''

  // No own pdf timeout: the whole job is bounded by PrintTimeoutMs
  return await ctx.with('pdf', {}, () =>
    page.pdf({
      format: layout.format,
      width: layout.width,
      height: layout.height,
      landscape: layout.landscape,
      timeout: 0,
      headerTemplate: pageHeader,
      footerTemplate: pageFooter,
      displayHeaderFooter,
      printBackground: layout.printBackground,
      margin: layout.margin
    })
  )
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
