// SPDX-License-Identifier: EPL-2.0

import {
  createDefaultDesign,
  createDesignForType,
  createElement,
  createAlternateBand,
  createWatermark,
  getPageDimensions,
  normalizeDesign
} from '../defaults'
import { TEMPLATE_TYPES } from '../types'
import { type PageRule, describePages, pageNumberFor, renderLayersForPage, ruleMatches, totalPagesFor } from '../pages'
import { extractFields, splitFields, substituteFields } from '../fields'
import {
  buildComposedRequest,
  buildDecorationLayers,
  cssColor,
  cssFontFamily,
  renderBandTemplate,
  renderElementHtml,
  renderPageDocument,
  renderTypographyCss,
  type RenderContext
} from '../render'

const ctx: RenderContext = {
  values: { title: 'Annual <Report>', author: 'Jane' },
  mode: 'print',
  resolveFile: (file) => (file === 'logo' ? 'data:image/png;base64,AAAA' : undefined)
}

describe('fields', () => {
  it('extracts and substitutes placeholders', () => {
    expect(extractFields('{{title}} by {{ author }} {{attr:major}}')).toEqual(['title', 'author', 'attr:major'])
    expect(substituteFields('{{title}} / {{missing}}', { title: 'T' })).toBe('T / ')
  })

  it('keeps page fields for the renderer', () => {
    expect(substituteFields('{{pageNumber}} of {{totalPages}}', {})).toBe('{{pageNumber}} of {{totalPages}}')
  })

  it('splits text into literal and field chunks', () => {
    expect(splitFields('A {{b}} C')).toEqual([{ text: 'A ' }, { text: '{{b}}', field: 'b' }, { text: ' C' }])
  })
})

describe('render', () => {
  it('escapes substituted values', () => {
    const html = renderElementHtml(createElement('text', { text: '{{title}}' }), ctx)
    expect(html).toContain('Annual &lt;Report&gt;')
    expect(html).not.toContain('<Report>')
  })

  it('uses edited text of editable elements', () => {
    const el = createElement('text', { text: '{{title}}', editable: true })
    const html = renderElementHtml(el, { ...ctx, overrides: { [el.id]: 'Custom title' } })
    expect(html).toContain('Custom title')
  })

  it('renders page numbers as chromium markers in print mode', () => {
    const el = createElement('text', { text: '{{pageNumber}}/{{totalPages}}' })
    expect(renderElementHtml(el, ctx)).toContain('<span class="pageNumber"></span>/<span class="totalPages"></span>')
    expect(renderElementHtml(el, { ...ctx, mode: 'preview' })).toContain('1/1')
  })

  it('skips images without resolvable file and hidden elements', () => {
    expect(renderElementHtml(createElement('image', { file: 'unknown' as any }), ctx)).toBe('')
    expect(renderElementHtml(createElement('image', { file: 'logo' as any }), ctx)).toContain('data:image/png')
    expect(renderElementHtml(createElement('shape', { hidden: true }), ctx)).toBe('')
  })

  it('sanitizes css values', () => {
    expect(cssColor('red;background:url(x)')).toBe('transparent')
    expect(cssColor('#1e3a5f')).toBe('#1e3a5f')
    expect(cssFontFamily('"Brand Sans", Arial, sans-serif')).toBe("'Brand Sans', Arial, sans-serif")
    expect(cssFontFamily('x;}</style><script>')).not.toMatch(/[;<>{}]/)
  })

  it('keeps style attributes intact for background images', () => {
    const design = createDefaultDesign()
    design.pages[0].background.file = 'logo' as any
    const html = renderPageDocument(design, design.pages[0], ctx)
    expect(html).toContain("background-image:url('data:image/png;base64,AAAA')")
    const style = html.match(/<div class="page" style="([^"]*)"/)?.[1] ?? ''
    expect(style).toContain('background-size:cover')
  })

  it('ignores unknown enum values in styles', () => {
    const el = createElement('text', { text: 'x' })
    el.style.align = 'left" onmouseover="alert(1)' as any
    const html = renderElementHtml(el, ctx)
    expect(html).not.toContain('onmouseover')
    expect(html).toContain('text-align:left')
  })

  it('renders a standalone page with the template page size', () => {
    const design = createDefaultDesign()
    const html = renderPageDocument(design, design.pages[0], ctx)
    expect(html).toContain('@page{size:210mm 297mm;margin:0}')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('swaps page dimensions in landscape', () => {
    const design = createDefaultDesign()
    design.page.orientation = 'landscape'
    expect(getPageDimensions(design.page)).toEqual({ width: 297, height: 210 })
  })

  it('anchors footer band to the bottom of the margin area', () => {
    const design = createDefaultDesign()
    expect(renderBandTemplate(design, design.footer, 'footer', ctx)).toContain('bottom:0')
  })

  it('scopes typography css', () => {
    const css = renderTypographyCss(createDefaultDesign().typography, '.sample')
    expect(css).toContain('.sample h1{')
    expect(css).not.toContain('.text-editor-view')
  })
})

describe('template types and body formatting', () => {
  it('creates a starter design for every type', () => {
    for (const type of TEMPLATE_TYPES) {
      const design = createDesignForType(type)
      expect(design.typography.headings.h1).toBeDefined()
      expect(() => buildComposedRequest(design, ctx, { file: 'x' })).not.toThrow()
    }
    expect(getPageDimensions(createDesignForType('presentation').page)).toEqual({ width: 297, height: 210 })
    expect(createDesignForType('letter').pages).toHaveLength(0)
  })

  it('fills settings missing in designs saved by earlier versions', () => {
    const design = createDefaultDesign()
    const legacy: any = { ...design, typography: { ...design.typography } }
    delete legacy.typography.paragraphSpacing
    delete legacy.typography.numberHeadings
    delete legacy.typography.headings.h6
    const normalized = normalizeDesign(legacy)
    expect(normalized.typography.paragraphSpacing).toBe(6)
    expect(normalized.typography.numberHeadings).toBe(false)
    expect(normalized.typography.headings.h6.fontSize).toBeGreaterThan(0)
  })

  it('numbers sections only when enabled', () => {
    const typography = createDefaultDesign().typography
    expect(renderTypographyCss(typography, '.s')).not.toContain('counter-increment')
    const css = renderTypographyCss({ ...typography, numberHeadings: true }, '.s')
    expect(css).toContain('.s h2::before{counter-increment:bh2;content:counter(bh1) "." counter(bh2) " "}')
  })

  it('styles paragraphs, quotes and code', () => {
    const css = renderTypographyCss({ ...createDefaultDesign().typography, paragraphSpacing: 9 }, '.s')
    expect(css).toContain('.s p{margin:0 0 9pt 0 !important}')
    expect(css).toContain('.s blockquote{')
    expect(css).toContain('.s :is(code,pre){')
  })

  it('uses preview page numbers', () => {
    const el = createElement('text', { text: '{{pageNumber}} / {{totalPages}}' })
    expect(renderElementHtml(el, { ...ctx, mode: 'preview', pageNumber: 3, totalPages: 7 })).toContain('3 / 7')
  })
})

describe('overlay and fills', () => {
  it('adds the overlay as a layer only when enabled with visible elements', () => {
    const design = normalizeDesign(createDefaultDesign())
    const watermarks = (d: typeof design): number =>
      buildDecorationLayers(d, ctx).filter((l) => l.html.includes('CONFIDENTIAL')).length
    expect(watermarks(design)).toBe(0)
    design.overlay = { enabled: true, onTemplatePages: true, elements: [createWatermark(design.page)] }
    expect(watermarks(normalizeDesign(design))).toBe(1)
    design.overlay.elements[0].hidden = true
    expect(watermarks(normalizeDesign(design))).toBe(0)
  })

  it('renders gradient fills and dashed outlines', () => {
    const shape = createElement('shape', { fill: '#000000', fill2: '#ffffff', gradientAngle: 90, strokeWidth: 1, strokeDash: 'dashed' })
    const html = renderElementHtml(shape, ctx)
    expect(html).toContain('linear-gradient(90deg, #000000, #ffffff)')
    expect(html).toContain('1mm dashed')
  })

  it('keeps an overlay saved before normalization', () => {
    const design = createDefaultDesign()
    design.overlay = { enabled: true, onTemplatePages: false, elements: [createWatermark(design.page, 'DRAFT')] }
    expect(normalizeDesign(design).overlay.elements).toHaveLength(1)
  })
})

describe('buildComposedRequest', () => {
  it('splits pages by placement and grows margins to fit bands', () => {
    const design = createDefaultDesign()
    design.page.margins.top = 10
    design.header.height = 18
    const request = buildComposedRequest(design, ctx, { link: 'https://example.com/guest/doc' })
    // Cover is enabled, document info page is disabled by default
    expect(request.before).toHaveLength(1)
    expect(request.after).toHaveLength(1)
    expect(request.margins.top).toBe(18)
    expect(request.headerTemplate).toBeUndefined()
    expect(request.decorations?.layers.length).toBeGreaterThan(0)
    expect(request.page).toEqual({ width: 210, height: 297 })
    expect(request.link).toBe('https://example.com/guest/doc')
  })

  it('omits disabled bands', () => {
    const design = createDefaultDesign()
    design.header.enabled = false
    design.footer.enabled = false
    const request = buildComposedRequest(normalizeDesign(design), ctx, { file: 'blob' })
    expect(request.decorations?.layers).toHaveLength(0)
    expect(request.margins).toEqual(design.page.margins)
  })
})

describe('page rules', () => {
  // Cover + 4 content pages + back cover
  const pages = describePages(1, 4, 1)
  const shown = (rule: PageRule): number[] => pages.filter((p) => ruleMatches(rule, p)).map((p) => p.index)

  it('describes page kinds and positions', () => {
    expect(pages.map((p) => `${p.kind}:${p.kindIndex}`)).toEqual([
      'template:1',
      'content:1',
      'content:2',
      'content:3',
      'content:4',
      'template:2'
    ])
  })

  it('selects pages within the scope', () => {
    expect(shown({ scope: 'content', pages: 'all' })).toEqual([2, 3, 4, 5])
    expect(shown({ scope: 'content', pages: 'first' })).toEqual([2])
    expect(shown({ scope: 'content', pages: 'notFirst' })).toEqual([3, 4, 5])
    expect(shown({ scope: 'content', pages: 'last' })).toEqual([5])
    expect(shown({ scope: 'template', pages: 'all' })).toEqual([1, 6])
    expect(shown({ scope: 'all', pages: 'first' })).toEqual([1])
  })

  it('uses physical pages for odd and even', () => {
    expect(shown({ scope: 'content', pages: 'odd' })).toEqual([3, 5])
    expect(shown({ scope: 'content', pages: 'even' })).toEqual([2, 4])
  })

  it('parses custom ranges', () => {
    expect(shown({ scope: 'content', pages: 'custom', custom: '1, 3-' })).toEqual([2, 4, 5])
    expect(shown({ scope: 'content', pages: 'custom', custom: '-1' })).toEqual([5])
    expect(shown({ scope: 'all', pages: 'custom', custom: '2-3' })).toEqual([2, 3])
    expect(shown({ scope: 'content', pages: 'custom', custom: 'abc' })).toEqual([])
  })

  it('never matches unknown rules', () => {
    expect(shown({ scope: 'nowhere' as any, pages: 'all' })).toEqual([])
    expect(shown({ scope: 'all', pages: 'sometimes' as any })).toEqual([])
  })

  it('numbers content pages, optionally counting template pages', () => {
    const contentOnly = { countTemplatePages: false, start: 1 }
    expect(pages.map((p) => pageNumberFor(p, contentOnly))).toEqual(['', '1', '2', '3', '4', ''])
    expect(totalPagesFor(pages[1], contentOnly)).toBe('4')
    expect(pageNumberFor(pages[1], { countTemplatePages: true, start: 1 })).toBe('2')
    expect(totalPagesFor(pages[1], { countTemplatePages: true, start: 1 })).toBe('6')
    expect(pageNumberFor(pages[1], { countTemplatePages: false, start: 10 })).toBe('10')
  })

  it('replaces the main header by an alternate on its pages', () => {
    const design = normalizeDesign(createDefaultDesign())
    design.header.elements = [createElement('text', { text: 'MAIN' })]
    design.headerAlternates = [createAlternateBand(design.header, 'First', { scope: 'content', pages: 'first' })]
    design.headerAlternates[0].elements = [createElement('text', { text: 'FIRST' })]
    design.footer.enabled = false
    const layers = buildDecorationLayers(design, ctx)
    const text = (index: number): string => renderLayersForPage(layers, pages[index - 1], design.numbering)
    expect(text(1)).toBe('')
    expect(text(2)).toContain('FIRST')
    expect(text(2)).not.toContain('MAIN')
    expect(text(3)).toContain('MAIN')
    expect(text(3)).not.toContain('FIRST')
  })

  it('shows elements with their own rule on matching pages of the band only', () => {
    const design = normalizeDesign(createDefaultDesign())
    design.footer.enabled = false
    design.header.elements = [
      createElement('text', { text: 'ALWAYS' }),
      createElement('text', { text: 'ONLY-LAST', showOn: { scope: 'all', pages: 'last' } })
    ]
    const layers = buildDecorationLayers(design, ctx)
    const last = renderLayersForPage(layers, pages[4], design.numbering)
    const first = renderLayersForPage(layers, pages[1], design.numbering)
    expect(last).toContain('ONLY-LAST')
    expect(first).toContain('ALWAYS')
    expect(first).not.toContain('ONLY-LAST')
  })

  it('fills page numbers per page', () => {
    const design = normalizeDesign(createDefaultDesign())
    design.header.enabled = false
    design.footer.elements = [createElement('text', { text: 'Page {{pageNumber}} of {{totalPages}}' })]
    const layers = buildDecorationLayers(design, ctx)
    expect(renderLayersForPage(layers, pages[2], design.numbering)).toContain('Page 2 of 4')
  })
})
