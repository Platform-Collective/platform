// SPDX-License-Identifier: EPL-2.0

import { getPageDimensions } from './defaults'
import { type PageLayer, type PageRule, defaultNumbering, defaultPageRule } from './pages'
import { substituteFields } from './fields'
import type { ComposedPrintRequest } from '@hcengineering/print'
import type {
  FieldValues,
  ImageElement,
  LineElement,
  PageBackground,
  ShapeElement,
  TemplateBand,
  TemplateDesign,
  TemplateElement,
  TemplatePage,
  TemplateTypography,
  TextElement,
  TextStyle
} from './types'

/** @public */
export interface FontSource {
  family: string
  url: string
}

/** @public */
export interface RenderContext {
  values: FieldValues
  // Text replacements for editable elements, keyed by element id
  overrides?: Record<string, string>
  // Resolves a blob reference to an URL usable by the renderer (data URI for print)
  resolveFile: (file: string) => string | undefined
  fonts?: FontSource[]
  // 'print' emits Chromium header/footer page number markers, 'preview' emits sample numbers
  mode: 'print' | 'preview'
  // Show placeholders as typed instead of their values (template editor)
  keepPlaceholders?: boolean
  // Page numbers shown in preview mode
  pageNumber?: number
  totalPages?: number
}

const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(rgb|rgba|hsl|hsla)\([0-9.,%\s]+\))$/

/** @public */
export function cssColor (value: string | undefined, fallback = 'transparent'): string {
  const v = (value ?? '').trim()
  return v !== '' && SAFE_COLOR.test(v) ? v : fallback
}

/** @public */
export function cssFontFamily (value: string | undefined): string {
  const families = (value ?? '')
    .split(',')
    .map((f) => f.replace(/["'<>;{}\\]/g, '').trim())
    .filter((f) => f !== '')
  if (families.length === 0) {
    return 'sans-serif'
  }
  return families.map((f) => (/^[a-zA-Z-]+$/.test(f) ? f : `'${f}'`)).join(', ')
}

function cssUrl (url: string): string {
  // Used inside double quoted style attributes, so single quotes and percent-encoding only
  const encoded = url.replace(/["'\\\n\r()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
  return `url('${encoded}')`
}

function num (value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : fallback
}

// Enum values come from stored designs and end up in style attributes, only known keywords pass
function oneOf<T extends string> (value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const
const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'] as const
const LINE_DASHES = ['solid', 'dashed', 'dotted'] as const
const IMAGE_FITS = ['contain', 'cover', 'fill'] as const

/** @public */
export function escapeHtml (text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** @public */
export function textStyleCss (style: TextStyle): string {
  return [
    `font-family:${cssFontFamily(style.fontFamily)}`,
    `font-size:${num(style.fontSize, 11)}pt`,
    `font-weight:${num(style.fontWeight, 400)}`,
    `font-style:${style.italic ? 'italic' : 'normal'}`,
    `text-decoration:${style.underline ? 'underline' : 'none'}`,
    `color:${cssColor(style.color, '#000')}`,
    `text-align:${oneOf(style.align, TEXT_ALIGNS, 'left')}`,
    `line-height:${num(style.lineHeight, 1.4)}`,
    `letter-spacing:${num(style.letterSpacing)}pt`,
    `text-transform:${oneOf(style.textTransform, TEXT_TRANSFORMS, 'none')}`
  ].join(';')
}

/**
 * Positioning style of an element box, shared by the editor canvas and the print renderer.
 * @public
 */
export function elementBoxCss (el: TemplateElement): string {
  const parts = [
    'position:absolute',
    `left:${num(el.x)}mm`,
    `top:${num(el.y)}mm`,
    `width:${num(el.width)}mm`,
    `height:${num(el.height)}mm`,
    `opacity:${num(el.opacity, 1)}`
  ]
  if (num(el.rotation) !== 0) {
    parts.push(`transform:rotate(${num(el.rotation)}deg)`, 'transform-origin:center center')
  }
  return parts.join(';')
}

/** @public */
export function textContainerCss (el: TextElement): string {
  const justify = el.verticalAlign === 'middle' ? 'center' : el.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start'
  return [
    'display:flex',
    'flex-direction:column',
    `justify-content:${justify}`,
    'width:100%',
    'height:100%',
    'overflow:hidden',
    `padding:${num(el.padding)}mm`,
    `background:${cssColor(el.background)}`
  ].join(';')
}

/** @public */
export function textInnerCss (el: TextElement): string {
  return `${textStyleCss(el.style)};white-space:pre-wrap;overflow-wrap:break-word;margin:0`
}

/** @public */
function fillCss (color: string | undefined, color2: string | undefined, angle: number | undefined, fallback: string): string {
  const first = cssColor(color, fallback)
  if (color2 === undefined || color2 === '') return first
  return `linear-gradient(${num(angle, 180)}deg, ${first}, ${cssColor(color2, fallback)})`
}

/** @public */
export function shapeCss (el: ShapeElement): string {
  const radius = el.shape === 'ellipse' ? '50%' : `${num(el.borderRadius)}mm`
  const dash = oneOf(el.strokeDash, LINE_DASHES, 'solid')
  const border = num(el.strokeWidth) > 0 ? `${num(el.strokeWidth)}mm ${dash} ${cssColor(el.stroke, '#000')}` : 'none'
  const background = fillCss(el.fill, el.fill2, el.gradientAngle, 'transparent')
  return `width:100%;height:100%;background:${background};border:${border};border-radius:${radius}`
}

/** @public */
export function lineCss (el: LineElement): string {
  return `width:100%;height:0;border-top:${num(el.strokeWidth, 0.3)}mm ${oneOf(el.dash, LINE_DASHES, 'solid')} ${cssColor(el.stroke, '#000')}`
}

/** @public */
export function imageCss (el: ImageElement): string {
  return `width:100%;height:100%;object-fit:${oneOf(el.fit, IMAGE_FITS, 'contain')};border-radius:${num(el.borderRadius)}mm;display:block`
}

/** @public */
export function backgroundCss (background: PageBackground, resolveFile?: (file: string) => string | undefined): string {
  const parts = [`background-color:${cssColor(background.color, '#fff')}`]
  const gradient = background.color2 !== undefined && background.color2 !== ''
    ? fillCss(background.color, background.color2, background.gradientAngle, '#fff')
    : undefined
  const url = background.file !== undefined ? resolveFile?.(background.file) : undefined
  if (url === undefined && gradient !== undefined) {
    parts.push(`background-image:${gradient}`)
  }
  if (url !== undefined) {
    const fit = oneOf(background.fit, IMAGE_FITS, 'cover')
    const size = fit === 'fill' ? '100% 100%' : fit
    parts.push(
      `background-image:${cssUrl(url)}`,
      `background-size:${size}`,
      'background-position:center',
      'background-repeat:no-repeat'
    )
  }
  return parts.join(';')
}

/**
 * Text of a text element after overrides and field substitution, not escaped.
 * @public
 */
export function resolveElementText (
  el: TextElement,
  ctx: Pick<RenderContext, 'values' | 'overrides' | 'keepPlaceholders'>
): string {
  const text = ctx.overrides?.[el.id] ?? el.text
  return ctx.keepPlaceholders === true ? text : substituteFields(text, ctx.values)
}

function renderPageFields (html: string, ctx: RenderContext): string {
  if (ctx.mode === 'print') {
    return html
      .replace(/\{\{\s*pageNumber\s*\}\}/g, '<span class="pageNumber"></span>')
      .replace(/\{\{\s*totalPages\s*\}\}/g, '<span class="totalPages"></span>')
  }
  return html
    .replace(/\{\{\s*pageNumber\s*\}\}/g, String(ctx.pageNumber ?? 1))
    .replace(/\{\{\s*totalPages\s*\}\}/g, String(ctx.totalPages ?? 1))
}

/** @public */
export function renderElementHtml (el: TemplateElement, ctx: RenderContext): string {
  if (el.hidden === true) {
    return ''
  }
  const box = elementBoxCss(el)
  switch (el.kind) {
    case 'text': {
      const escaped = escapeHtml(resolveElementText(el, ctx))
      const text = ctx.keepPlaceholders === true ? escaped : renderPageFields(escaped, ctx)
      return `<div style="${box}"><div style="${textContainerCss(el)}"><div style="${textInnerCss(el)}">${text}</div></div></div>`
    }
    case 'image': {
      const url = el.file !== undefined ? ctx.resolveFile(el.file) : undefined
      if (url === undefined) {
        return ''
      }
      return `<div style="${box}"><img alt="" src="${escapeHtml(url)}" style="${imageCss(el)}"/></div>`
    }
    case 'shape':
      return `<div style="${box}"><div style="${shapeCss(el)}"></div></div>`
    case 'line':
      return `<div style="${box}"><div style="${lineCss(el)}"></div></div>`
  }
}

/** @public */
export function fontFacesCss (fonts: FontSource[] | undefined): string {
  return (fonts ?? [])
    .map((f) => `@font-face{font-family:${cssFontFamily(f.family)};src:${cssUrl(f.url)};font-display:block}`)
    .join('\n')
}

/**
 * Standalone HTML document for a full template page (cover, info page, back cover...).
 * @public
 */
export function renderPageDocument (design: TemplateDesign, page: TemplatePage, ctx: RenderContext): string {
  const { width, height } = getPageDimensions(design.page)
  const elements = page.elements.map((el) => renderElementHtml(el, ctx)).join('')
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"/>',
    `<title>${escapeHtml(page.name)}</title><style>`,
    `@page{size:${num(width)}mm ${num(height)}mm;margin:0}`,
    'html,body{margin:0;padding:0}',
    '*{box-sizing:border-box}',
    'body{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    `.page{position:relative;width:${num(width)}mm;height:${num(height)}mm;overflow:hidden}`,
    fontFacesCss(ctx.fonts),
    '</style></head><body>',
    `<div class="page" style="${backgroundCss(page.background, ctx.resolveFile)}">${elements}</div>`,
    '</body></html>'
  ].join('')
}

/**
 * Transparent full page with the overlay elements, stamped over document pages by the print service.
 * @public
 */
export function renderOverlayDocument (design: TemplateDesign, ctx: RenderContext): string {
  const { width, height } = getPageDimensions(design.page)
  const elements = design.overlay.elements.map((el) => renderElementHtml(el, ctx)).join('')
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"/><style>',
    `@page{size:${num(width)}mm ${num(height)}mm;margin:0}`,
    'html,body{margin:0;padding:0;background:transparent}',
    '*{box-sizing:border-box}',
    'body{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    `.page{position:relative;width:${num(width)}mm;height:${num(height)}mm;overflow:hidden}`,
    fontFacesCss(ctx.fonts),
    '</style></head><body>',
    `<div class="page">${elements}</div>`,
    '</body></html>'
  ].join('')
}

/** @public */
export function hasOverlay (design: TemplateDesign): boolean {
  return design.overlay?.enabled === true && design.overlay.elements.some((el) => el.hidden !== true)
}

/**
 * Chromium header/footer template. The template area spans the full page width and the page margin height,
 * the band is anchored to the page edge.
 * @public
 */
export function renderBandTemplate (
  design: TemplateDesign,
  band: TemplateBand,
  kind: 'header' | 'footer',
  ctx: RenderContext
): string {
  const { width } = getPageDimensions(design.page)
  const elements = band.elements.map((el) => renderElementHtml(el, ctx)).join('')
  const anchor = kind === 'header' ? 'top:0' : 'bottom:0'
  return [
    '<style>',
    '*{box-sizing:border-box}',
    `#band{position:absolute;left:0;${anchor};width:${num(width)}mm;height:${num(band.height)}mm;`,
    `background:${cssColor(band.background)};-webkit-print-color-adjust:exact;print-color-adjust:exact}`,
    fontFacesCss(ctx.fonts),
    '</style>',
    `<div style="position:relative;width:100%;height:100%;margin:0;font-size:0"><div id="band">${elements}</div></div>`
  ].join('')
}

/** @public */
export const CONTENT_SCOPE = ':is(.text-editor-view,.text-markup-view)'

/**
 * Attribute marking a block of the document body that starts on a new page.
 * @public
 */
export const PAGE_BREAK_ATTR = 'data-branding-page-break'

/** @public */
export const DOC_TITLE_CLASS = 'branding-doc-title'

const BODY_SCOPE_CLASS = 'branding-body'

/**
 * Standalone HTML document for a document body formatted with the template typography.
 * Page size, margins, header and footer are applied by the PDF renderer.
 * @public
 */
export function renderBodyDocument (design: TemplateDesign, contentHtml: string, ctx: RenderContext): string {
  const { width, height } = getPageDimensions(design.page)
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"/><style>',
    `@page{size:${num(width)}mm ${num(height)}mm}`,
    'html,body{margin:0;padding:0}',
    '*{box-sizing:border-box}',
    'body{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    fontFacesCss(ctx.fonts),
    renderTypographyCss(design.typography, `.${BODY_SCOPE_CLASS}`),
    '</style></head><body>',
    `<div class="${BODY_SCOPE_CLASS}">${contentHtml}</div>`,
    '</body></html>'
  ].join('')
}

/**
 * Stylesheet applied to the printed document body, so the content follows the template typography.
 * @public
 */
export function renderTypographyCss (typography: TemplateTypography, scope: string = CONTENT_SCOPE): string {
  const paragraphSpacing = num(typography.paragraphSpacing, 6)
  const codeFont = cssFontFamily(typography.codeFontFamily ?? 'monospace')
  const rules: string[] = [
    `${scope}, ${scope} :is(p,li,blockquote,td,th){${important(textStyleCss(typography.body))}}`,
    `${scope} p{${important(`margin:0 0 ${paragraphSpacing}pt 0`)}}`,
    `${scope} :is(ul,ol){${important(`margin:0 0 ${paragraphSpacing}pt 0;padding-left:7mm`)}}`,
    `${scope} ul{list-style:disc outside !important}`,
    `${scope} ol{list-style:decimal outside !important}`,
    `${scope} li{${important('margin:0 0 1.5pt 0;display:list-item')}}`,
    `${scope} :is(strong,b){font-weight:700 !important}`,
    `${scope} li > p{${important('margin:0')}}`,
    `${scope} a{color:${cssColor(typography.linkColor, '#1d4ed8')} !important}`,
    `${scope} table{${important(`border-collapse:collapse;width:100%;margin:0 0 ${paragraphSpacing}pt 0`)}}`,
    `${scope} :is(th,td){${important('padding:1.2mm 2mm;vertical-align:top')}}`,
    `${scope} th{background:${cssColor(typography.tableHeaderBackground)} !important;font-weight:600 !important}`,
    `${scope} :is(table,th,td){border:0.25mm solid ${cssColor(typography.tableBorderColor, '#ccc')} !important}`,
    `${scope} blockquote{${important(
      `margin:0 0 ${paragraphSpacing}pt 0;padding:1mm 0 1mm 4mm;` +
        `border-left:1mm solid ${cssColor(typography.quoteBorderColor, '#999')};` +
        `color:${cssColor(typography.quoteTextColor, '#555')};font-style:italic`
    )}}`,
    `${scope} blockquote :is(p,li){color:${cssColor(typography.quoteTextColor, '#555')} !important}`,
    `${scope} :is(code,pre){${important(`font-family:${codeFont};background:${cssColor(typography.codeBackground)}`)}}`,
    `${scope} code{${important('padding:0 1mm;border-radius:0.6mm;font-size:0.9em')}}`,
    `${scope} pre{${important(`padding:3mm;border-radius:1mm;margin:0 0 ${paragraphSpacing}pt 0;white-space:pre-wrap`)}}`,
    `${scope} pre code{${important('padding:0;background:transparent')}}`,
    `${scope} hr{${important(`border:none;border-top:0.3mm solid ${cssColor(typography.ruleColor, '#ccc')};margin:4mm 0`)}}`,
    `${scope} img{${important('max-width:100%;height:auto')}}`,
    // Keep headings with the text that follows them and avoid splitting small blocks across pages
    `${scope} :is(h1,h2,h3,h4,h5,h6){break-after:avoid;page-break-after:avoid}`,
    `${scope} :is(tr,img,pre,blockquote){break-inside:avoid}`
  ]
  const h1 = typography.headings.h1
  rules.push(
    `${scope} .${DOC_TITLE_CLASS}{${important(
      `${textStyleCss({ ...h1, fontSize: num(h1.fontSize, 22) * 1.3 })};margin:0 0 ${num(h1.spaceAfter) * 2}pt 0;` +
        'border:none;padding:0'
    )}}`,
    `${scope} [${PAGE_BREAK_ATTR}]{break-before:page !important;page-break-before:always !important}`
  )
  if (typography.numberHeadings === true) {
    rules.push(
      `${scope}{counter-reset:bh1}`,
      `${scope} h1{counter-reset:bh2}`,
      `${scope} h2{counter-reset:bh3}`,
      `${scope} h1::before{counter-increment:bh1;content:counter(bh1) ". "}`,
      `${scope} h2::before{counter-increment:bh2;content:counter(bh1) "." counter(bh2) " "}`,
      `${scope} h3::before{counter-increment:bh3;content:counter(bh1) "." counter(bh2) "." counter(bh3) " "}`
    )
  }
  for (const [level, style] of Object.entries(typography.headings)) {
    const decl = [
      textStyleCss(style),
      `margin-top:${num(style.spaceBefore)}pt`,
      `margin-bottom:${num(style.spaceAfter)}pt`,
      style.borderBottom ? `border-bottom:0.3mm solid ${cssColor(style.borderColor, '#ccc')}` : 'border-bottom:none',
      style.borderBottom ? 'padding-bottom:1.5mm' : '',
      style.pageBreakBefore ? 'break-before:page' : ''
    ]
      .filter((d) => d !== '')
      .join(';')
    rules.push(`${scope} ${level}{${important(decl)}}`)
  }
  return rules.join('\n')
}

function important (decl: string): string {
  return decl
    .split(';')
    .filter((d) => d.trim() !== '')
    .map((d) => `${d} !important`)
    .join(';')
}

/**
 * Build the print service request that renders the document with the template applied.
 * @public
 */
export function buildComposedRequest (
  design: TemplateDesign,
  ctx: RenderContext,
  body: { link?: string, file?: string, html?: string }
): ComposedPrintRequest {
  const printCtx: RenderContext = { ...ctx, mode: 'print' }
  const page = getPageDimensions(design.page)
  const pages = design.pages.filter((p) => p.enabled)
  return {
    ...body,
    page,
    margins: contentMargins(design),
    before: pages.filter((p) => p.placement === 'before').map((p) => renderPageDocument(design, p, printCtx)),
    after: pages.filter((p) => p.placement === 'after').map((p) => renderPageDocument(design, p, printCtx)),
    contentCss: renderTypographyCss(design.typography),
    // Headers, footers and overlays are stamped per page by the print service, following their page rules
    decorations: {
      layers: buildDecorationLayers(design, printCtx),
      numbering: design.numbering ?? defaultNumbering(),
      css: fontFacesCss(printCtx.fonts)
    }
  }
}

function enabledBands (design: TemplateDesign, kind: 'header' | 'footer'): TemplateBand[] {
  const main = kind === 'header' ? design.header : design.footer
  const alternates = (kind === 'header' ? design.headerAlternates : design.footerAlternates) ?? []
  return [main, ...alternates].filter((b) => b.enabled)
}

/**
 * Margins around the document content; they leave room for the tallest header and footer.
 * @public
 */
export function contentMargins (design: TemplateDesign): TemplateDesign['page']['margins'] {
  const margins = { ...design.page.margins }
  for (const band of enabledBands(design, 'header')) margins.top = Math.max(margins.top, band.height)
  for (const band of enabledBands(design, 'footer')) margins.bottom = Math.max(margins.bottom, band.height)
  return margins
}

function elementLayers (
  elements: TemplateElement[],
  wrap: (inner: string) => string,
  match: PageRule[],
  exclude: PageRule[],
  ctx: RenderContext,
  alwaysWrap: boolean
): PageLayer[] {
  const common = elements.filter((el) => el.showOn === undefined && el.hidden !== true)
  const layers: PageLayer[] = []
  if (common.length > 0 || alwaysWrap) {
    layers.push({ html: wrap(common.map((el) => renderElementHtml(el, ctx)).join('')), match, exclude })
  }
  for (const el of elements) {
    if (el.showOn === undefined || el.hidden === true) continue
    // Elements with their own page rule are separate layers, positioned in the same band;
    // their pages are counted like the band's ("first page" of a content header is the first content page)
    const scope = match[0]?.scope ?? 'content'
    layers.push({ html: wrap(renderElementHtml(el, ctx)), match: [...match, { ...el.showOn, scope }], exclude })
  }
  return layers
}

function bandLayers (design: TemplateDesign, kind: 'header' | 'footer', ctx: RenderContext): PageLayer[] {
  const { width, height } = getPageDimensions(design.page)
  const main = kind === 'header' ? design.header : design.footer
  const alternates = ((kind === 'header' ? design.headerAlternates : design.footerAlternates) ?? []).filter(
    (b) => b.enabled
  )
  const layers: PageLayer[] = []
  const wrap = (band: TemplateBand) => (inner: string) => {
    const top = kind === 'header' ? 0 : height - band.height
    return (
      `<div style="position:absolute;left:0;top:${num(top)}mm;width:${num(width)}mm;height:${num(band.height)}mm;` +
      `background:${cssColor(band.background)};overflow:hidden">${inner}</div>`
    )
  }
  // The first alternate whose rule applies replaces the main band on a page
  alternates.forEach((band, index) => {
    const earlier = alternates.slice(0, index).map((b) => b.rule ?? defaultPageRule())
    const hasBackground = cssColor(band.background) !== 'transparent'
    layers.push(...elementLayers(band.elements, wrap(band), [band.rule ?? defaultPageRule()], earlier, ctx, hasBackground))
  })
  if (main.enabled) {
    const replaced = alternates.map((b) => b.rule ?? defaultPageRule())
    const hasBackground = cssColor(main.background) !== 'transparent'
    layers.push(...elementLayers(main.elements, wrap(main), [main.rule ?? defaultPageRule()], replaced, ctx, hasBackground))
  }
  return layers
}

/**
 * Headers, footers and the overlay as page layers, in drawing order.
 * @public
 */
export function buildDecorationLayers (design: TemplateDesign, ctx: RenderContext): PageLayer[] {
  const layers = [...bandLayers(design, 'header', ctx), ...bandLayers(design, 'footer', ctx)]
  if (hasOverlay(design)) {
    const rule = design.overlay.rule ?? defaultPageRule(design.overlay.onTemplatePages ? 'all' : 'content')
    layers.push(...elementLayers(design.overlay.elements, (inner) => inner, [rule], [], ctx, false))
  }
  return layers
}
