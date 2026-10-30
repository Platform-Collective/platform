// SPDX-License-Identifier: EPL-2.0

import { type MeasureContext } from '@hcengineering/core'
import { type PageRule, describePages, renderDecorationDocument, renderLayersForPage } from '@hcengineering/branding'
import { PDFDocument, type PDFEmbeddedPage } from 'pdf-lib'
import { type PDFOptions, type Page } from 'puppeteer'

import { type PrintBrowserManager, type PrintBrowserPage, withTimeout } from './browser'
import config from './config'
import { ApiError } from './error'
import { printSemaphore, renderPdf } from './print'
import { isAllowedPrintUrl } from './print-url'

export const maxComposedRequestBytes = 60 * 1024 * 1024
const maxPartBytes = 20 * 1024 * 1024
const maxBodyHtmlBytes = 55 * 1024 * 1024
const maxExtraPages = 50
const maxBodyPdfBytes = 100 * 1024 * 1024

export interface ComposedMargins {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * A document print with template pages, header/footer and content stylesheet; geometry in millimetres.
 */
export interface ComposedPrintRequest {
  link?: string
  file?: string
  html?: string
  page: { width: number, height: number }
  margins: ComposedMargins
  before: string[]
  after: string[]
  headerTemplate?: string
  footerTemplate?: string
  contentCss?: string
  overlay?: string
  overlayOnTemplatePages?: boolean
  decorations?: ComposedDecorations
}

export interface ComposedDecorations {
  layers: Array<{ html: string, match: PageRuleInput[], exclude: PageRuleInput[] }>
  numbering: { countTemplatePages: boolean, start: number }
  css: string
}

// Page rules are only compared against known values, unknown ones never match
type PageRuleInput = PageRule

const maxDecorationLayers = 500

function parseRule (value: unknown): PageRuleInput {
  if (typeof value !== 'object' || value === null) throw new ApiError(400, 'Invalid page rule')
  const raw = value as Record<string, unknown>
  if (typeof raw.scope !== 'string' || typeof raw.pages !== 'string') throw new ApiError(400, 'Invalid page rule')
  if (raw.custom !== undefined && (typeof raw.custom !== 'string' || raw.custom.length > 200)) {
    throw new ApiError(400, 'Invalid page range')
  }
  return { scope: raw.scope, pages: raw.pages, custom: raw.custom } as unknown as PageRuleInput
}

function parseDecorations (value: unknown): ComposedDecorations | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') throw new ApiError(400, 'Invalid decorations')
  const raw = value as Record<string, unknown>
  if (!Array.isArray(raw.layers) || raw.layers.length > maxDecorationLayers) throw new ApiError(400, 'Invalid decorations')
  const layers = raw.layers.map((layer: unknown) => {
    const l = layer as Record<string, unknown>
    if (typeof l?.html !== 'string' || !Array.isArray(l.match) || !Array.isArray(l.exclude)) {
      throw new ApiError(400, 'Invalid decoration layer')
    }
    if (Buffer.byteLength(l.html) > maxPartBytes) throw new ApiError(413, 'Decoration layer is too large')
    return { html: l.html, match: l.match.map(parseRule), exclude: l.exclude.map(parseRule) }
  })
  const numbering = raw.numbering as Record<string, unknown> | undefined
  const start = numbering?.start
  return {
    layers,
    numbering: {
      countTemplatePages: numbering?.countTemplatePages === true,
      start: typeof start === 'number' && Number.isInteger(start) && start >= 0 && start < 100000 ? start : 1
    },
    css: optionalString(raw.css, 'decorations css') ?? ''
  }
}

function isNumberInRange (value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function optionalString (value: unknown, name: string, maxBytes = maxPartBytes): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ApiError(400, `Invalid ${name}`)
  if (Buffer.byteLength(value) > maxBytes) throw new ApiError(413, `${name} is too large`)
  return value
}

function stringArray (value: unknown, name: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new ApiError(400, `Invalid ${name}`)
  }
  for (const v of value) {
    if (Buffer.byteLength(v) > maxPartBytes) throw new ApiError(413, `${name} page is too large`)
  }
  return value
}

/**
 * Validate an untrusted composed print request body.
 */
export function parseComposedRequest (body: unknown): ComposedPrintRequest {
  if (typeof body !== 'object' || body === null) {
    throw new ApiError(400, 'Invalid request body')
  }
  const raw = body as Record<string, unknown>
  const link = optionalString(raw.link, 'link')
  const file = optionalString(raw.file, 'file')
  // The body document carries the inlined images of the content
  const html = optionalString(raw.html, 'html', maxBodyHtmlBytes)
  if ([link, file, html].filter((v) => v !== undefined).length !== 1) {
    throw new ApiError(400, 'Exactly one of link, file or html must be provided')
  }
  if (file !== undefined && !/^[\w.-]+$/.test(file)) {
    throw new ApiError(400, 'Invalid file')
  }

  const page = raw.page as Record<string, unknown> | undefined
  if (page === undefined || !isNumberInRange(page.width, 50, 2000) || !isNumberInRange(page.height, 50, 2000)) {
    throw new ApiError(400, 'Invalid page size')
  }
  const margins = raw.margins as Record<string, unknown> | undefined
  const sides = ['top', 'right', 'bottom', 'left'] as const
  if (margins === undefined || sides.some((s) => !isNumberInRange(margins[s], 0, 500))) {
    throw new ApiError(400, 'Invalid margins')
  }
  if ((margins.top as number) + (margins.bottom as number) >= (page.height as number) - 10) {
    throw new ApiError(400, 'Margins leave no room for content')
  }

  const before = stringArray(raw.before, 'before')
  const after = stringArray(raw.after, 'after')
  if (before.length + after.length > maxExtraPages) {
    throw new ApiError(400, 'Too many template pages')
  }

  return {
    link,
    file,
    html,
    page: { width: page.width as number, height: page.height as number },
    margins: {
      top: margins.top as number,
      right: margins.right as number,
      bottom: margins.bottom as number,
      left: margins.left as number
    },
    before,
    after,
    headerTemplate: optionalString(raw.headerTemplate, 'headerTemplate'),
    footerTemplate: optionalString(raw.footerTemplate, 'footerTemplate'),
    contentCss: optionalString(raw.contentCss, 'contentCss'),
    overlay: optionalString(raw.overlay, 'overlay'),
    overlayOnTemplatePages: raw.overlayOnTemplatePages === true,
    decorations: parseDecorations(raw.decorations)
  }
}

/**
 * Template pages come from the client, so they are rendered offline: scripts are disabled and
 * every request except inline data is blocked, the HTML cannot reach internal services.
 */
async function isolatePage (page: Page): Promise<void> {
  await page.setJavaScriptEnabled(false)
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith('data:') || url === 'about:blank') {
      void request.continue()
    } else {
      void request.abort('blockedbyclient')
    }
  })
}

/**
 * Browser pages of one composed job; released together when the job ends or is abandoned on timeout.
 */
class JobPages {
  private readonly pages: PrintBrowserPage[] = []

  constructor (private readonly browserManager: PrintBrowserManager) {}

  async create (): Promise<PrintBrowserPage> {
    const page = await this.browserManager.createPage()
    this.pages.push(page)
    return page
  }

  async releaseAll (): Promise<void> {
    await Promise.allSettled(this.pages.map(async (p) => { await p.release() }))
  }
}

async function renderHtmlPage (
  ctx: MeasureContext,
  pages: JobPages,
  html: string,
  pdfOptions: PDFOptions = { preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }
): Promise<Uint8Array> {
  const browserPage = await pages.create()
  try {
    const page = browserPage.page
    await isolatePage(page)
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMediaType('print')
    try {
      // Inline @font-face fonts are loaded lazily, wait for them before printing
      await page.evaluate(async () => {
        await document.fonts.ready
      })
    } catch (err: unknown) {
      ctx.warn('fonts not awaited', { message: err instanceof Error ? err.message : String(err) })
    }
    // No own pdf timeout: the whole job is bounded by the composed print timeout
    return await page.pdf({ printBackground: true, timeout: 0, ...pdfOptions })
  } finally {
    await browserPage.release()
  }
}

async function compose (
  ctx: MeasureContext,
  request: ComposedPrintRequest,
  pages: JobPages,
  readFile: (file: string) => Promise<Buffer | undefined>,
  allowedHostnames: readonly string[]
): Promise<Buffer> {
  const mm = (v: number): string => `${v}mm`
  const margin = {
    top: mm(request.margins.top),
    right: mm(request.margins.right),
    bottom: mm(request.margins.bottom),
    left: mm(request.margins.left)
  }
  let body: Uint8Array | undefined
  if (request.link !== undefined) {
    const browserPage = await pages.create()
    try {
      body = await ctx.with('body', {}, (ctx) =>
        renderPdf(
          ctx,
          browserPage.page,
          request.link as string,
          {
            width: mm(request.page.width),
            height: mm(request.page.height),
            margin,
            headerTemplate: request.decorations !== undefined ? '' : request.headerTemplate,
            footerTemplate: request.decorations !== undefined ? '' : request.footerTemplate,
            contentCss: request.contentCss,
            printBackground: true
          },
          allowedHostnames
        )
      )
    } finally {
      await browserPage.release()
    }
  } else if (request.html !== undefined) {
    const headerTemplate = request.headerTemplate ?? ''
    const footerTemplate = request.footerTemplate ?? ''
    body = await ctx.with('body', { source: 'html' }, (ctx) =>
      renderHtmlPage(ctx, pages, request.html as string, {
        width: mm(request.page.width),
        height: mm(request.page.height),
        margin,
        displayHeaderFooter: headerTemplate !== '' || footerTemplate !== '',
        // An empty template still needs markup, otherwise Chromium prints its default date and title
        headerTemplate: headerTemplate !== '' ? headerTemplate : '<span></span>',
        footerTemplate: footerTemplate !== '' ? footerTemplate : '<span></span>'
      })
    )
  } else if (request.file !== undefined) {
    body = await readFile(request.file)
    if (body === undefined) {
      throw new ApiError(404, `File ${request.file} not found`)
    }
    if (body.length > maxBodyPdfBytes) {
      throw new ApiError(413, 'Document is too large')
    }
  }
  if (body === undefined) {
    throw new ApiError(400, 'Failed to print')
  }

  const before: Uint8Array[] = []
  for (const html of request.before) {
    before.push(await ctx.with('page', { placement: 'before' }, (ctx) => renderHtmlPage(ctx, pages, html)))
  }
  const after: Uint8Array[] = []
  for (const html of request.after) {
    after.push(await ctx.with('page', { placement: 'after' }, (ctx) => renderHtmlPage(ctx, pages, html)))
  }

  const overlay =
    request.overlay !== undefined
      ? await ctx.with('overlay', {}, (ctx) =>
        renderHtmlPage(ctx, pages, request.overlay as string, {
          preferCSSPageSize: true,
          omitBackground: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 }
        })
      )
      : undefined
  const stampTemplatePages = request.overlayOnTemplatePages === true
  const decorations =
    request.decorations !== undefined
      ? await ctx.with('decorations', {}, (ctx) =>
        renderDecorations(ctx, pages, request, [before, [body as Uint8Array], after])
      )
      : undefined
  return await ctx.with('merge', {}, () =>
    mergePdfs(
      [
        ...before.map((data) => ({ data, stamp: stampTemplatePages })),
        { data: body as Uint8Array, stamp: true },
        ...after.map((data) => ({ data, stamp: stampTemplatePages }))
      ],
      overlay,
      decorations
    )
  )
}

async function countPages (parts: Uint8Array[]): Promise<number> {
  let count = 0
  for (const part of parts) {
    try {
      count += (await PDFDocument.load(part)).getPageCount()
    } catch (err: unknown) {
      throw new ApiError(400, `Invalid PDF part: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return count
}

/**
 * One transparent page per document page with the headers, footers and overlays that page shows,
 * resolved from the page rules once the page count of every part is known.
 */
async function renderDecorations (
  ctx: MeasureContext,
  pages: JobPages,
  request: ComposedPrintRequest,
  [before, body, after]: [Uint8Array[], Uint8Array[], Uint8Array[]]
): Promise<Uint8Array | undefined> {
  const decorations = request.decorations
  if (decorations === undefined || decorations.layers.length === 0) return undefined
  const positions = describePages(await countPages(before), await countPages(body), await countPages(after))
  const html = renderDecorationDocument(
    request.page,
    decorations.css,
    positions.map((pos) => renderLayersForPage(decorations.layers, pos, decorations.numbering))
  )
  return await renderHtmlPage(ctx, pages, html, {
    preferCSSPageSize: true,
    omitBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  })
}

/**
 * Concatenate PDF documents in order.
 */
export async function mergePdfs (
  parts: Array<Uint8Array | { data: Uint8Array, stamp: boolean }>,
  overlay?: Uint8Array,
  // One page per document page, drawn over the page with the same index
  decorations?: Uint8Array
): Promise<Buffer> {
  const result = await PDFDocument.create()
  // The overlay page is drawn over the selected pages, scaled to each page size
  const stamp = overlay !== undefined ? (await result.embedPdf(overlay, [0]))[0] : undefined
  const perPage = decorations !== undefined ? await embedEachPage(result, decorations) : []
  let pageIndex = 0
  for (const part of parts) {
    const { data, stamp: stampPart } = part instanceof Uint8Array ? { data: part, stamp: false } : part
    let doc: PDFDocument
    try {
      doc = await PDFDocument.load(data, { ignoreEncryption: false })
    } catch (err: unknown) {
      throw new ApiError(400, `Invalid PDF part: ${err instanceof Error ? err.message : String(err)}`)
    }
    const pages = await result.copyPages(doc, doc.getPageIndices())
    for (const page of pages) {
      result.addPage(page)
      if (stamp !== undefined && stampPart) {
        page.drawPage(stamp, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
      }
      const decoration = perPage[pageIndex]
      if (decoration !== undefined) {
        page.drawPage(decoration, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
      }
      pageIndex++
    }
  }
  return Buffer.from(await result.save())
}

/**
 * Embed every page; pages without any drawing have no content stream and are skipped.
 */
async function embedEachPage (target: PDFDocument, data: Uint8Array): Promise<Array<PDFEmbeddedPage | undefined>> {
  const source = await PDFDocument.load(data)
  const result: Array<PDFEmbeddedPage | undefined> = []
  for (const index of source.getPageIndices()) {
    // Embedding is resolved when the document is saved, so empty pages must be skipped up front
    if (source.getPage(index).node.Contents() === undefined) {
      result.push(undefined)
      continue
    }
    result.push((await target.embedPdf(source, [index]))[0])
  }
  return result
}

export async function printComposed (
  ctx: MeasureContext,
  request: ComposedPrintRequest,
  browserManager: PrintBrowserManager,
  readFile: (file: string) => Promise<Buffer | undefined>,
  allowedHostnames: readonly string[]
): Promise<Buffer> {
  if (request.link !== undefined && !isAllowedPrintUrl(request.link, allowedHostnames)) {
    throw new ApiError(403, 'Cannot process provided link')
  }

  const release = await printSemaphore.acquire()
  const pages = new JobPages(browserManager)
  try {
    const job = compose(ctx, request, pages, readFile, allowedHostnames)
    // After a timeout the job is abandoned; closing its pages makes pending puppeteer calls reject,
    // which must not surface as an unhandled rejection
    job.catch(() => {})
    // Every template page is a separate render, allow more time than for a plain print
    const timeoutMs = config.PrintTimeoutMs * 2
    return await withTimeout(job, timeoutMs, `Composed print timed out after ${timeoutMs} ms`)
  } finally {
    try {
      await pages.releaseAll()
    } finally {
      release()
    }
  }
}
