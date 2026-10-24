// SPDX-License-Identifier: EPL-2.0
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'

import { mergePdfs, parseComposedRequest } from '../composed'

// Rendering is not exercised here, only request validation and merging
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }))
jest.mock('../config', () => ({
  __esModule: true,
  default: { PrintConcurrency: 1, PrintTimeoutMs: 1000, PageInitTimeoutMs: 1000, BrowserMaxPages: 0 }
}))

const valid = {
  link: 'https://front.example.com/guest/doc',
  page: { width: 210, height: 297 },
  margins: { top: 25, right: 15, bottom: 20, left: 15 },
  before: ['<html></html>'],
  after: [],
  headerTemplate: '<div>header</div>',
  contentCss: 'h1{color:red}'
}

async function pdfWithPages (count: number, width = 595): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) doc.addPage([width, 842])
  return await doc.save()
}

async function overlayPdf (): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842]).drawRectangle({ x: 10, y: 10, width: 50, height: 50, opacity: 0.2 })
  return await doc.save()
}

describe('composed print request', () => {
  it('accepts a valid request', () => {
    const request = parseComposedRequest(valid)
    expect(request.before).toHaveLength(1)
    expect(request.after).toEqual([])
    expect(request.footerTemplate).toBeUndefined()
  })

  it('requires exactly one body source', () => {
    expect(() => parseComposedRequest({ ...valid, link: undefined })).toThrow(/Exactly one/)
    expect(() => parseComposedRequest({ ...valid, file: 'blob-id' })).toThrow(/Exactly one/)
    expect(parseComposedRequest({ ...valid, link: undefined, file: 'blob-id' }).file).toBe('blob-id')
    expect(parseComposedRequest({ ...valid, link: undefined, html: '<html></html>' }).html).toBe('<html></html>')
    expect(() => parseComposedRequest({ ...valid, html: '<html></html>' })).toThrow(/Exactly one/)
    expect(() => parseComposedRequest({ ...valid, link: undefined, html: 42 })).toThrow(/Invalid html/)
  })

  it('rejects unsafe file ids and invalid geometry', () => {
    expect(() => parseComposedRequest({ ...valid, link: undefined, file: '../secret' })).toThrow(/Invalid file/)
    expect(() => parseComposedRequest({ ...valid, page: { width: 10, height: 297 } })).toThrow(/page size/)
    expect(() => parseComposedRequest({ ...valid, margins: { ...valid.margins, top: -1 } })).toThrow(/margins/)
    expect(() => parseComposedRequest({ ...valid, margins: { ...valid.margins, top: 150, bottom: 150 } })).toThrow(
      /no room/
    )
  })

  it('rejects non-string pages and too many pages', () => {
    expect(() => parseComposedRequest({ ...valid, before: [1] })).toThrow(/Invalid before/)
    expect(() => parseComposedRequest({ ...valid, after: Array(60).fill('<html></html>') })).toThrow(/Too many/)
  })

  it('merges pdf parts in order', async () => {
    const merged = await mergePdfs([await pdfWithPages(1, 500), await pdfWithPages(3), await pdfWithPages(1, 400)])
    const doc = await PDFDocument.load(merged)
    expect(doc.getPageCount()).toBe(5)
    expect(doc.getPage(0).getWidth()).toBe(500)
    expect(doc.getPage(4).getWidth()).toBe(400)
  })

  it('stamps the overlay on selected parts only', async () => {
    const merged = await mergePdfs(
      [
        { data: await pdfWithPages(1), stamp: false },
        { data: await pdfWithPages(2), stamp: true }
      ],
      await overlayPdf()
    )
    const doc = await PDFDocument.load(merged)
    expect(doc.getPageCount()).toBe(3)
    // Stamped pages reference the embedded overlay as an extra XObject
    const xObjects = (i: number): number => {
      const resources = doc.getPage(i).node.Resources()
      const dict = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
      return dict?.keys().length ?? 0
    }
    expect(xObjects(0)).toBe(0)
    expect(xObjects(1)).toBe(1)
    expect(xObjects(2)).toBe(1)
  })

  it('stamps decoration page N on document page N', async () => {
    const decorations = await PDFDocument.create()
    // Page 1 has nothing to draw, page 2 has a decoration
    decorations.addPage([595, 842])
    decorations.addPage([595, 842]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 })
    const merged = await mergePdfs(
      [{ data: await pdfWithPages(1), stamp: false }, { data: await pdfWithPages(1), stamp: false }],
      undefined,
      await decorations.save()
    )
    const doc = await PDFDocument.load(merged)
    const xObjects = (i: number): number =>
      doc.getPage(i).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0
    expect(xObjects(0)).toBe(0)
    expect(xObjects(1)).toBe(1)
  })

  it('validates decorations', () => {
    const decorations = {
      layers: [{ html: '<div></div>', match: [{ scope: 'content', pages: 'first' }], exclude: [] }],
      numbering: { countTemplatePages: false, start: 5 },
      css: ''
    }
    expect(parseComposedRequest({ ...valid, decorations }).decorations?.numbering.start).toBe(5)
    expect(() => parseComposedRequest({ ...valid, decorations: { ...decorations, layers: [{ html: 1 }] } })).toThrow(
      /Invalid decoration layer/
    )
    expect(() =>
      parseComposedRequest({ ...valid, decorations: { ...decorations, layers: [{ html: '', match: [{}], exclude: [] }] } })
    ).toThrow(/Invalid page rule/)
  })

  it('accepts an overlay page', () => {
    const request = parseComposedRequest({ ...valid, overlay: '<html></html>', overlayOnTemplatePages: true })
    expect(request.overlay).toBe('<html></html>')
    expect(request.overlayOnTemplatePages).toBe(true)
  })

  it('reports invalid pdf parts', async () => {
    await expect(mergePdfs([new Uint8Array([1, 2, 3])])).rejects.toMatchObject({ code: 400 })
  })
})
