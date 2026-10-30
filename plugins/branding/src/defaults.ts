// SPDX-License-Identifier: EPL-2.0

import type {
  ElementKind,
  HeadingLevel,
  HeadingStyle,
  PageSetup,
  PageSizeName,
  TemplateBand,
  TemplateDesign,
  TemplateElement,
  TemplateOverlay,
  TemplatePage,
  TemplateType,
  TemplateTypography,
  TextElement,
  TextStyle
} from './types'
import { TEMPLATE_DESIGN_VERSION } from './types'
import { type PageRule, defaultNumbering, defaultPageRule } from './pages'

/**
 * Portrait page dimensions in millimetres.
 * @public
 */
export const PAGE_SIZES: Record<Exclude<PageSizeName, 'Custom'>, { width: number, height: number }> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 }
}

/** @public */
export const HEADING_LEVELS: HeadingLevel[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

/** @public */
export const DEFAULT_FONT_FAMILY = 'Helvetica, Arial, sans-serif'

/** @public */
export function generateElementId (): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/**
 * Page dimensions taking orientation into account.
 * @public
 */
export function getPageDimensions (page: PageSetup): { width: number, height: number } {
  return page.orientation === 'landscape'
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height }
}

/** @public */
export function defaultTextStyle (overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 11,
    fontWeight: 400,
    italic: false,
    underline: false,
    color: '#1f2933',
    align: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    textTransform: 'none',
    ...overrides
  }
}

function headingStyle (fontSize: number, overrides: Partial<HeadingStyle> = {}): HeadingStyle {
  return {
    ...defaultTextStyle({ fontSize, fontWeight: 700, lineHeight: 1.25 }),
    spaceBefore: Math.round(fontSize * 0.8),
    spaceAfter: Math.round(fontSize * 0.4),
    borderBottom: false,
    borderColor: '#d0d5dd',
    pageBreakBefore: false,
    ...overrides
  }
}

/** @public */
export function defaultTypography (): TemplateTypography {
  return {
    body: defaultTextStyle(),
    headings: {
      h1: headingStyle(22, { borderBottom: true }),
      h2: headingStyle(17),
      h3: headingStyle(14),
      h4: headingStyle(12),
      h5: headingStyle(11),
      h6: headingStyle(10, { textTransform: 'uppercase' })
    },
    linkColor: '#1d4ed8',
    tableHeaderBackground: '#f2f4f7',
    tableBorderColor: '#d0d5dd',
    paragraphSpacing: 6,
    numberHeadings: false,
    quoteBorderColor: '#1e3a5f',
    quoteTextColor: '#475467',
    codeFontFamily: '"Courier New", Courier, monospace',
    codeBackground: '#f2f4f7',
    ruleColor: '#d0d5dd'
  }
}

/** @public */
export function defaultOverlay (): TemplateOverlay {
  return { enabled: false, onTemplatePages: false, rule: defaultPageRule(), elements: [] }
}

function normalizeOverlay (overlay: TemplateOverlay | undefined): TemplateOverlay {
  const value = { ...defaultOverlay(), ...(overlay ?? {}) }
  return { ...value, rule: value.rule ?? defaultPageRule(value.onTemplatePages ? 'all' : 'content') }
}

/**
 * Alternate header or footer shown instead of the main one on the selected pages.
 * @public
 */
export function createAlternateBand (base: TemplateBand, name: string, rule: PageRule): TemplateBand {
  return {
    ...base,
    id: generateElementId(),
    name,
    rule,
    elements: base.elements.map((el) => ({ ...el, id: generateElementId() }))
  }
}

/**
 * Diagonal text watermark across the page centre.
 * @public
 */
export function createWatermark (page: PageSetup, text = 'CONFIDENTIAL'): TextElement {
  const { width, height } = getPageDimensions(page)
  const boxWidth = Math.min(width, height) * 1.1
  return createElement('text', {
    name: 'Watermark',
    x: (width - boxWidth) / 2,
    y: height / 2 - 20,
    width: boxWidth,
    height: 40,
    rotation: -40,
    opacity: 0.12,
    verticalAlign: 'middle',
    text,
    style: defaultTextStyle({ fontSize: 72, fontWeight: 800, color: '#101828', align: 'center', letterSpacing: 6 })
  })
}

/**
 * Fill settings added in later versions, so designs saved earlier keep working.
 * @public
 */
export function normalizeDesign (design: TemplateDesign): TemplateDesign {
  const typography = defaultTypography()
  const headings = { ...typography.headings }
  for (const level of HEADING_LEVELS) {
    headings[level] = { ...headings[level], ...(design.typography?.headings?.[level] ?? {}) }
  }
  return {
    ...design,
    version: TEMPLATE_DESIGN_VERSION,
    overlay: normalizeOverlay(design.overlay),
    header: { rule: defaultPageRule(), ...design.header },
    footer: { rule: defaultPageRule(), ...design.footer },
    headerAlternates: design.headerAlternates ?? [],
    footerAlternates: design.footerAlternates ?? [],
    numbering: { ...defaultNumbering(), ...(design.numbering ?? {}) },
    page: { ...defaultPageSetup(), ...design.page },
    pages: design.pages ?? [],
    typography: {
      ...typography,
      ...design.typography,
      body: { ...typography.body, ...(design.typography?.body ?? {}) },
      headings
    }
  }
}

/** @public */
export function defaultPageSetup (): PageSetup {
  return {
    size: 'A4',
    ...PAGE_SIZES.A4,
    orientation: 'portrait',
    margins: { top: 25, right: 15, bottom: 20, left: 15 }
  }
}

/** @public */
export type ElementOfKind<K extends ElementKind> = Extract<TemplateElement, { kind: K }>

/** @public */
export function createElement<K extends ElementKind> (kind: K, props: Partial<ElementOfKind<K>> = {}): ElementOfKind<K> {
  return { ...elementDefaults(kind), ...props, kind } as unknown as ElementOfKind<K>
}

function elementDefaults (kind: ElementKind): TemplateElement {
  const base = {
    id: generateElementId(),
    x: 20,
    y: 20,
    width: 80,
    height: 15,
    rotation: 0,
    opacity: 1
  }
  switch (kind) {
    case 'text':
      return {
        ...base,
        kind,
        text: 'Text',
        style: defaultTextStyle({ fontSize: 14 }),
        verticalAlign: 'top',
        padding: 0,
        editable: false
      }
    case 'image':
      return { ...base, kind, width: 40, height: 30, fit: 'contain', borderRadius: 0 }
    case 'shape':
      return {
        ...base,
        kind,
        width: 50,
        height: 30,
        shape: 'rect',
        fill: '#e4e7ec',
        stroke: '#98a2b3',
        strokeWidth: 0,
        borderRadius: 0
      }
    case 'line':
      return { ...base, kind, width: 80, height: 0, stroke: '#1f2933', strokeWidth: 0.4, dash: 'solid' }
  }
}

/** @public */
export function createPage (name: string, placement: TemplatePage['placement'], elements: TemplateElement[] = []): TemplatePage {
  return {
    id: generateElementId(),
    name,
    placement,
    enabled: true,
    background: { color: '#ffffff', fit: 'cover' },
    elements
  }
}

function defaultBand (kind: 'header' | 'footer', page: PageSetup): TemplateBand {
  const { width } = getPageDimensions(page)
  const { left, right } = page.margins
  const contentWidth = width - left - right
  if (kind === 'header') {
    return {
      enabled: true,
      height: 15,
      background: '',
      elements: [
        createElement('text', {
          x: left,
          y: 7,
          width: contentWidth,
          height: 6,
          text: '{{title}}',
          style: defaultTextStyle({ fontSize: 8, color: '#667085' })
        }),
        createElement('line', { x: left, y: 14, width: contentWidth, height: 0, stroke: '#d0d5dd', strokeWidth: 0.3 })
      ]
    }
  }
  return {
    enabled: true,
    height: 12,
    background: '',
    elements: [
      createElement('text', {
        x: left,
        y: 3,
        width: contentWidth / 2,
        height: 6,
        text: '{{workspace}}',
        style: defaultTextStyle({ fontSize: 8, color: '#667085' })
      }),
      createElement('text', {
        x: left + contentWidth / 2,
        y: 3,
        width: contentWidth / 2,
        height: 6,
        text: '{{pageNumber}} / {{totalPages}}',
        style: defaultTextStyle({ fontSize: 8, color: '#667085', align: 'right' })
      })
    ]
  }
}

/**
 * A ready to use starting point: cover, document info page and back cover.
 * @public
 */
export function createDefaultDesign (): TemplateDesign {
  const page = defaultPageSetup()
  const { width, height } = getPageDimensions(page)
  const cover = createPage('Cover', 'before', [
    createElement('shape', { x: 0, y: 0, width, height: 90, fill: '#1e3a5f', stroke: '#1e3a5f' }),
    createElement('text', {
      x: 20,
      y: 110,
      width: width - 40,
      height: 40,
      text: '{{title}}',
      editable: true,
      style: defaultTextStyle({ fontSize: 30, fontWeight: 700, color: '#1e3a5f', lineHeight: 1.15 })
    }),
    createElement('text', {
      x: 20,
      y: 155,
      width: width - 40,
      height: 12,
      text: 'Subtitle',
      editable: true,
      style: defaultTextStyle({ fontSize: 14, color: '#475467' })
    }),
    createElement('line', { x: 20, y: 172, width: 40, height: 0, stroke: '#1e3a5f', strokeWidth: 1.2 }),
    createElement('text', {
      x: 20,
      y: height - 40,
      width: width - 40,
      height: 20,
      text: '{{author}}\n{{printDate}}',
      style: defaultTextStyle({ fontSize: 11, color: '#475467' })
    })
  ])
  const info = createPage('Document information', 'before', [
    createElement('text', {
      x: 20,
      y: 25,
      width: width - 40,
      height: 12,
      text: 'Document information',
      style: defaultTextStyle({ fontSize: 18, fontWeight: 700, color: '#1e3a5f' })
    }),
    createElement('text', {
      x: 20,
      y: 45,
      width: width - 40,
      height: 60,
      text: 'Title: {{title}}\nIdentifier: {{identifier}}\nVersion: {{version}}\nStatus: {{status}}\nAuthor: {{author}}\nCreated: {{createdOn}}\nModified: {{modifiedOn}}',
      style: defaultTextStyle({ fontSize: 11, lineHeight: 1.8 })
    })
  ])
  info.enabled = false
  const back = createPage('Back cover', 'after', [
    createElement('shape', { x: 0, y: height - 60, width, height: 60, fill: '#1e3a5f', stroke: '#1e3a5f' }),
    createElement('text', {
      x: 20,
      y: height - 40,
      width: width - 40,
      height: 12,
      text: '{{workspace}}',
      style: defaultTextStyle({ fontSize: 12, color: '#ffffff', align: 'center' })
    })
  ])
  return {
    version: TEMPLATE_DESIGN_VERSION,
    overlay: defaultOverlay(),
    headerAlternates: [],
    footerAlternates: [],
    numbering: defaultNumbering(),
    page,
    pages: [cover, info, back],
    header: defaultBand('header', page),
    footer: defaultBand('footer', page),
    typography: defaultTypography()
  }
}

function pageNumberFooter (page: PageSetup, left: string): TemplateBand {
  const { width } = getPageDimensions(page)
  const contentWidth = width - page.margins.left - page.margins.right
  return {
    enabled: true,
    height: 12,
    background: '',
    elements: [
      createElement('text', {
        x: page.margins.left,
        y: 3,
        width: contentWidth * 0.7,
        height: 6,
        text: left,
        style: defaultTextStyle({ fontSize: 8, color: '#667085' })
      }),
      createElement('text', {
        x: page.margins.left + contentWidth * 0.7,
        y: 3,
        width: contentWidth * 0.3,
        height: 6,
        text: '{{pageNumber}} / {{totalPages}}',
        style: defaultTextStyle({ fontSize: 8, color: '#667085', align: 'right' })
      })
    ]
  }
}

function createProposalDesign (): TemplateDesign {
  const design = createDefaultDesign()
  const { width, height } = getPageDimensions(design.page)
  const accent = '#0f766e'
  const cover = createPage('Cover', 'before', [
    createElement('shape', { x: 0, y: 0, width: 14, height, fill: accent, stroke: accent }),
    createElement('text', {
      x: 30,
      y: 70,
      width: width - 50,
      height: 8,
      text: 'PROPOSAL',
      style: defaultTextStyle({ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 3 })
    }),
    createElement('text', {
      x: 30,
      y: 82,
      width: width - 50,
      height: 45,
      text: '{{title}}',
      editable: true,
      style: defaultTextStyle({ fontSize: 32, fontWeight: 700, color: '#101828', lineHeight: 1.15 })
    }),
    createElement('text', {
      x: 30,
      y: height - 70,
      width: width - 50,
      height: 30,
      text: 'Prepared for: Client name\nPrepared by: {{author}}\n{{printDate}}',
      editable: true,
      style: defaultTextStyle({ fontSize: 11, color: '#475467', lineHeight: 1.7 })
    })
  ])
  const [, info, back] = design.pages
  back.elements = back.elements.map((el) => (el.kind === 'shape' ? { ...el, fill: accent, stroke: accent } : el))
  design.pages = [cover, { ...info, enabled: true }, back]
  design.typography.numberHeadings = true
  design.typography.headings.h1.color = accent
  design.typography.quoteBorderColor = accent
  return design
}

function createPresentationDesign (): TemplateDesign {
  const page: PageSetup = {
    ...defaultPageSetup(),
    orientation: 'landscape',
    margins: { top: 22, right: 20, bottom: 18, left: 20 }
  }
  const { width, height } = getPageDimensions(page)
  const dark = '#111827'
  const cover = createPage('Title slide', 'before', [
    createElement('text', {
      x: 30,
      y: height / 2 - 30,
      width: width - 60,
      height: 40,
      text: '{{title}}',
      editable: true,
      style: defaultTextStyle({ fontSize: 40, fontWeight: 700, color: '#ffffff', align: 'center', lineHeight: 1.1 })
    }),
    createElement('line', {
      x: width / 2 - 20,
      y: height / 2 + 15,
      width: 40,
      height: 0,
      stroke: '#f59e0b',
      strokeWidth: 1.5
    }),
    createElement('text', {
      x: 30,
      y: height / 2 + 22,
      width: width - 60,
      height: 12,
      text: '{{author}} · {{printDate}}',
      style: defaultTextStyle({ fontSize: 14, color: '#d1d5db', align: 'center' })
    })
  ])
  cover.background.color = dark
  const back = createPage('Closing slide', 'after', [
    createElement('text', {
      x: 30,
      y: height / 2 - 12,
      width: width - 60,
      height: 24,
      text: 'Thank you',
      editable: true,
      style: defaultTextStyle({ fontSize: 36, fontWeight: 700, color: '#ffffff', align: 'center' })
    })
  ])
  back.background.color = dark
  const typography = defaultTypography()
  typography.body = defaultTextStyle({ fontSize: 14, lineHeight: 1.5 })
  typography.headings.h1 = {
    ...typography.headings.h1,
    fontSize: 30,
    pageBreakBefore: true,
    borderBottom: false,
    spaceBefore: 0
  }
  typography.headings.h2 = { ...typography.headings.h2, fontSize: 22 }
  typography.headings.h3 = { ...typography.headings.h3, fontSize: 18 }
  typography.paragraphSpacing = 10
  return {
    version: TEMPLATE_DESIGN_VERSION,
    overlay: defaultOverlay(),
    headerAlternates: [],
    footerAlternates: [],
    numbering: defaultNumbering(),
    page,
    pages: [cover, back],
    header: { enabled: false, height: 12, background: '', elements: [] },
    footer: pageNumberFooter(page, '{{title}}'),
    typography
  }
}

function createLetterDesign (): TemplateDesign {
  const page: PageSetup = { ...defaultPageSetup(), margins: { top: 40, right: 20, bottom: 25, left: 20 } }
  const { width } = getPageDimensions(page)
  const contentWidth = width - 40
  return {
    version: TEMPLATE_DESIGN_VERSION,
    overlay: defaultOverlay(),
    headerAlternates: [],
    footerAlternates: [],
    numbering: defaultNumbering(),
    page,
    pages: [],
    header: {
      enabled: true,
      height: 34,
      background: '',
      elements: [
        createElement('image', { name: 'Logo', x: width - 60, y: 10, width: 40, height: 16 }),
        createElement('text', {
          x: 20,
          y: 12,
          width: contentWidth - 50,
          height: 9,
          text: '{{workspace}}',
          style: defaultTextStyle({ fontSize: 16, fontWeight: 700, color: '#1e3a5f' })
        }),
        createElement('text', {
          x: 20,
          y: 21,
          width: contentWidth - 50,
          height: 6,
          text: 'Street address · City · www.example.com',
          style: defaultTextStyle({ fontSize: 8, color: '#667085' })
        }),
        createElement('line', { x: 20, y: 31, width: contentWidth, height: 0, stroke: '#1e3a5f', strokeWidth: 0.5 })
      ]
    },
    footer: pageNumberFooter(page, 'Registered office · Company number · VAT number'),
    typography: { ...defaultTypography(), body: defaultTextStyle({ fontSize: 11, lineHeight: 1.5 }) }
  }
}

function createMemoDesign (): TemplateDesign {
  const page: PageSetup = { ...defaultPageSetup(), margins: { top: 42, right: 20, bottom: 20, left: 20 } }
  const { width } = getPageDimensions(page)
  const contentWidth = width - 40
  return {
    version: TEMPLATE_DESIGN_VERSION,
    overlay: defaultOverlay(),
    headerAlternates: [],
    footerAlternates: [],
    numbering: defaultNumbering(),
    page,
    pages: [],
    header: {
      enabled: true,
      height: 38,
      background: '',
      elements: [
        createElement('text', {
          x: 20,
          y: 10,
          width: contentWidth,
          height: 10,
          text: 'MEMORANDUM',
          style: defaultTextStyle({ fontSize: 18, fontWeight: 700, letterSpacing: 2, color: '#101828' })
        }),
        createElement('text', {
          x: 20,
          y: 22,
          width: contentWidth,
          height: 12,
          text: 'Subject: {{title}}\nFrom: {{author}} · Date: {{printDate}}',
          style: defaultTextStyle({ fontSize: 9, color: '#475467', lineHeight: 1.5 })
        }),
        createElement('line', { x: 20, y: 36, width: contentWidth, height: 0, stroke: '#101828', strokeWidth: 0.6 })
      ]
    },
    footer: pageNumberFooter(page, '{{workspace}} · Internal'),
    typography: defaultTypography()
  }
}

function createBlankDesign (): TemplateDesign {
  const page = defaultPageSetup()
  return {
    version: TEMPLATE_DESIGN_VERSION,
    overlay: defaultOverlay(),
    headerAlternates: [],
    footerAlternates: [],
    numbering: defaultNumbering(),
    page,
    pages: [],
    header: { enabled: false, height: 15, background: '', elements: [] },
    footer: pageNumberFooter(page, '{{title}}'),
    typography: defaultTypography()
  }
}

/**
 * Starter design for a template type.
 * @public
 */
export function createDesignForType (type: TemplateType): TemplateDesign {
  switch (type) {
    case 'letterhead':
    case 'letter':
      return createLetterDesign()
    case 'notice':
      return createNoticeDesign()
    case 'handbook':
      return createHandbookDesign()
    case 'report':
      return createDefaultDesign()
    case 'proposal':
      return createProposalDesign()
    case 'presentation':
      return createPresentationDesign()
    case 'memo':
      return createMemoDesign()
    default:
      return createBlankDesign()
  }
}

function createNoticeDesign (): TemplateDesign {
  const page: PageSetup = { ...defaultPageSetup(), margins: { top: 62, right: 22, bottom: 30, left: 22 } }
  const { width } = getPageDimensions(page)
  const contentWidth = width - 44
  const red = '#9f1239'
  return {
    version: TEMPLATE_DESIGN_VERSION,
    overlay: defaultOverlay(),
    headerAlternates: [],
    footerAlternates: [],
    numbering: defaultNumbering(),
    page,
    pages: [],
    header: {
      enabled: true,
      height: 58,
      background: '',
      elements: [
        createElement('image', { name: 'Emblem', x: width / 2 - 10, y: 8, width: 20, height: 16 }),
        createElement('text', {
          x: 22,
          y: 26,
          width: contentWidth,
          height: 7,
          text: '{{workspace}}',
          style: defaultTextStyle({ fontSize: 13, fontWeight: 700, align: 'center', textTransform: 'uppercase', letterSpacing: 1 })
        }),
        createElement('line', { x: 22, y: 35, width: contentWidth, height: 0, stroke: red, strokeWidth: 0.8 }),
        createElement('text', {
          x: 22,
          y: 38,
          width: contentWidth,
          height: 9,
          text: 'OFFICIAL NOTICE',
          style: defaultTextStyle({ fontSize: 16, fontWeight: 800, align: 'center', color: red, letterSpacing: 3 })
        }),
        createElement('text', {
          x: 22,
          y: 49,
          width: contentWidth / 2,
          height: 6,
          text: 'Ref: {{identifier}}',
          style: defaultTextStyle({ fontSize: 9, color: '#475467' })
        }),
        createElement('text', {
          x: 22 + contentWidth / 2,
          y: 49,
          width: contentWidth / 2,
          height: 6,
          text: 'Date: {{printDate}}',
          style: defaultTextStyle({ fontSize: 9, color: '#475467', align: 'right' })
        })
      ]
    },
    footer: {
      enabled: true,
      height: 26,
      background: '',
      elements: [
        createElement('text', {
          x: width - 22 - 70,
          y: 2,
          width: 70,
          height: 12,
          text: '____________________\nAuthorised signatory',
          editable: true,
          style: defaultTextStyle({ fontSize: 9, align: 'center', color: '#344054', lineHeight: 1.5 })
        }),
        createElement('line', { x: 22, y: 17, width: contentWidth, height: 0, stroke: '#d0d5dd', strokeWidth: 0.3 }),
        createElement('text', {
          x: 22,
          y: 19,
          width: contentWidth,
          height: 5,
          text: '{{workspace}} · Page {{pageNumber}} of {{totalPages}}',
          style: defaultTextStyle({ fontSize: 7.5, color: '#667085', align: 'center' })
        })
      ]
    },
    typography: {
      ...defaultTypography(),
      body: defaultTextStyle({ fontSize: 11.5, lineHeight: 1.6, align: 'justify' }),
      paragraphSpacing: 8
    }
  }
}

function createHandbookDesign (): TemplateDesign {
  const page: PageSetup = { ...defaultPageSetup(), margins: { top: 25, right: 20, bottom: 22, left: 25 } }
  const { width, height } = getPageDimensions(page)
  const accent = '#3730a3'
  const cover = createPage('Cover', 'before', [
    createElement('shape', { x: 0, y: 0, width, height, fill: accent, stroke: accent }),
    createElement('image', { name: 'Logo', x: 25, y: 25, width: 40, height: 18 }),
    createElement('text', {
      x: 25,
      y: 110,
      width: width - 50,
      height: 10,
      text: 'HANDBOOK',
      style: defaultTextStyle({ fontSize: 12, fontWeight: 700, color: '#c7d2fe', letterSpacing: 4 })
    }),
    createElement('text', {
      x: 25,
      y: 122,
      width: width - 50,
      height: 50,
      text: '{{title}}',
      editable: true,
      style: defaultTextStyle({ fontSize: 34, fontWeight: 700, color: '#ffffff', lineHeight: 1.15 })
    }),
    createElement('text', {
      x: 25,
      y: height - 40,
      width: width - 50,
      height: 14,
      text: '{{workspace}}\nVersion {{version}} · {{printDate}}',
      style: defaultTextStyle({ fontSize: 10, color: '#e0e7ff', lineHeight: 1.6 })
    })
  ])
  const about = createPage('About this handbook', 'before', [
    createElement('text', {
      x: 25,
      y: 30,
      width: width - 45,
      height: 12,
      text: 'About this handbook',
      style: defaultTextStyle({ fontSize: 20, fontWeight: 700, color: accent })
    }),
    createElement('text', {
      x: 25,
      y: 48,
      width: width - 45,
      height: 60,
      text:
        'This handbook describes the policies and practices of {{workspace}}.\n\n' +
        'Owner: {{author}}\nVersion: {{version}}\nStatus: {{status}}\nLast updated: {{modifiedOn}}',
      editable: true,
      style: defaultTextStyle({ fontSize: 11, lineHeight: 1.7 })
    })
  ])
  const back = createPage('Back cover', 'after', [
    createElement('shape', { x: 0, y: 0, width, height, fill: accent, stroke: accent }),
    createElement('text', {
      x: 25,
      y: height / 2 - 6,
      width: width - 50,
      height: 12,
      text: '{{workspace}}',
      style: defaultTextStyle({ fontSize: 14, color: '#ffffff', align: 'center' })
    })
  ])
  const typography = defaultTypography()
  typography.numberHeadings = true
  typography.headings.h1 = { ...typography.headings.h1, color: accent, pageBreakBefore: true, fontSize: 24 }
  typography.headings.h2 = { ...typography.headings.h2, color: accent }
  typography.quoteBorderColor = accent
  return {
    version: TEMPLATE_DESIGN_VERSION,
    overlay: defaultOverlay(),
    headerAlternates: [],
    footerAlternates: [],
    numbering: defaultNumbering(),
    page,
    pages: [cover, about, back],
    header: {
      enabled: true,
      height: 16,
      background: '',
      elements: [
        createElement('text', {
          x: 25,
          y: 7,
          width: width - 45,
          height: 6,
          text: '{{title}}',
          style: defaultTextStyle({ fontSize: 8, color: accent, align: 'right' })
        })
      ]
    },
    footer: pageNumberFooter(page, '{{workspace}} · Version {{version}}'),
    typography
  }
}
