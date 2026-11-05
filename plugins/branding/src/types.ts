// SPDX-License-Identifier: EPL-2.0

import type { Blob, Class, Doc, Ref } from '@hcengineering/core'

import type { PageNumbering, PageRule } from './pages'

/**
 * All geometry in a template design is expressed in millimetres,
 * font sizes are expressed in points.
 * @public
 */
export type PageSizeName = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'Custom'

/** @public */
export type PageOrientation = 'portrait' | 'landscape'

/** @public */
export interface PageMargins {
  top: number
  right: number
  bottom: number
  left: number
}

/** @public */
export interface PageSetup {
  size: PageSizeName
  // Portrait dimensions; orientation swaps them when rendering
  width: number
  height: number
  orientation: PageOrientation
  // Distance from the page edge to the document content
  margins: PageMargins
}

/** @public */
export type TextAlign = 'left' | 'center' | 'right' | 'justify'

/** @public */
export type VerticalAlign = 'top' | 'middle' | 'bottom'

/** @public */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize'

/** @public */
export interface TextStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  underline: boolean
  color: string
  align: TextAlign
  lineHeight: number
  letterSpacing: number
  textTransform: TextTransform
}

/** @public */
export type ElementKind = 'text' | 'image' | 'shape' | 'line'

/** @public */
export interface ElementBase {
  id: string
  kind: ElementKind
  name?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  locked?: boolean
  hidden?: boolean
  // Elements of headers, footers and overlays can be limited to some pages
  showOn?: PageRule
}

/**
 * Text supports field placeholders: `{{title}}`, `{{author}}`, `{{attr:someKey}}` etc.
 * Header/footer bands also support `{{pageNumber}}` and `{{totalPages}}`.
 * @public
 */
export interface TextElement extends ElementBase {
  kind: 'text'
  text: string
  style: TextStyle
  verticalAlign: VerticalAlign
  background?: string
  padding: number
  // Text can be changed in the print preview before the PDF is produced
  editable: boolean
}

/** @public */
export type ImageFit = 'contain' | 'cover' | 'fill'

/** @public */
export interface ImageElement extends ElementBase {
  kind: 'image'
  file?: Ref<Blob>
  fit: ImageFit
  borderRadius: number
}

/** @public */
export type ShapeKind = 'rect' | 'ellipse'

/** @public */
export interface ShapeElement extends ElementBase {
  kind: 'shape'
  shape: ShapeKind
  fill: string
  // Second colour of a linear gradient fill
  fill2?: string
  gradientAngle?: number
  stroke: string
  strokeWidth: number
  strokeDash?: LineDash
  borderRadius: number
}

/** @public */
export type LineDash = 'solid' | 'dashed' | 'dotted'

/** @public */
export interface LineElement extends ElementBase {
  kind: 'line'
  stroke: string
  strokeWidth: number
  dash: LineDash
}

/** @public */
export type TemplateElement = TextElement | ImageElement | ShapeElement | LineElement

/** @public */
export interface PageBackground {
  color: string
  // Second colour of a linear gradient background
  color2?: string
  gradientAngle?: number
  file?: Ref<Blob>
  fit: ImageFit
}

/** @public */
export type PagePlacement = 'before' | 'after'

/**
 * A full page added before or after the document content (cover, document info, back cover...).
 * @public
 */
export interface TemplatePage {
  id: string
  name: string
  placement: PagePlacement
  enabled: boolean
  background: PageBackground
  elements: TemplateElement[]
}

/**
 * A header or footer band repeated on every content page.
 * Its elements are positioned relative to the band (top-left corner of the page for the header,
 * bottom-left corner minus band height for the footer).
 * @public
 */
export interface TemplateBand {
  // Alternate bands are identified and named; the main band has neither
  id?: string
  name?: string
  // Pages the band is shown on; alternates replace the main band where they apply
  rule?: PageRule
  enabled: boolean
  height: number
  background: string
  elements: TemplateElement[]
}

/**
 * Elements stamped over every page of the document content: watermarks, logos, borders, side bars.
 * Positioned on the whole page, like a master page.
 * @public
 */
export interface TemplateOverlay {
  enabled: boolean
  // Also stamp the overlay on cover, back cover and other template pages
  onTemplatePages: boolean
  // Pages the overlay is shown on, takes precedence over onTemplatePages
  rule?: PageRule
  elements: TemplateElement[]
}

/** @public */
export interface HeadingStyle extends TextStyle {
  spaceBefore: number
  spaceAfter: number
  borderBottom: boolean
  borderColor: string
  pageBreakBefore: boolean
}

/** @public */
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

/** @public */
export interface TemplateTypography {
  body: TextStyle
  headings: Record<HeadingLevel, HeadingStyle>
  linkColor: string
  tableHeaderBackground: string
  tableBorderColor: string
  // Vertical space between paragraphs, pt
  paragraphSpacing: number
  // Automatic section numbers on H1-H3: 1, 1.1, 1.1.1
  numberHeadings: boolean
  quoteBorderColor: string
  quoteTextColor: string
  codeFontFamily: string
  codeBackground: string
  ruleColor: string
}

/**
 * Kind of deliverable a template is designed for; picks the starter design and groups templates.
 * @public
 */
export type PresetTemplateType =
  | 'letterhead'
  | 'notice'
  | 'handbook'
  | 'report'
  | 'proposal'
  | 'memo'
  | 'presentation'
  | 'other'

/**
 * A preset type or a custom type name entered by the user.
 * @public
 */
export type TemplateType = PresetTemplateType | (string & Record<never, never>)

/** @public */
export const TEMPLATE_TYPES: PresetTemplateType[] = [
  'letterhead',
  'notice',
  'handbook',
  'report',
  'proposal',
  'memo',
  'presentation',
  'other'
]

/** @public */
export function isPresetTemplateType (type: string | undefined): type is PresetTemplateType {
  return TEMPLATE_TYPES.includes(type as PresetTemplateType)
}

/**
 * Type of a stored template; earlier versions used 'letter' for letterheads.
 * @public
 */
export function getTemplateType (template: { templateType?: string }): TemplateType {
  const type = template.templateType ?? 'report'
  return type === 'letter' ? 'letterhead' : type
}

/** @public */
export const TEMPLATE_DESIGN_VERSION = 1

/** @public */
export interface TemplateDesign {
  version: number
  page: PageSetup
  pages: TemplatePage[]
  header: TemplateBand
  footer: TemplateBand
  // Different headers and footers for some pages (first page, odd/even, ranges)
  headerAlternates: TemplateBand[]
  footerAlternates: TemplateBand[]
  numbering: PageNumbering
  overlay: TemplateOverlay
  typography: TemplateTypography
}

/** @public */
export interface PrintTemplate extends Doc {
  name: string
  description?: string
  templateType?: TemplateType
  design: TemplateDesign
  // Used when no template is chosen explicitly for a matching class
  isDefault?: boolean
  // Restricts the classes the template is offered for, empty means any
  targetClasses?: Array<Ref<Class<Doc>>>
}

/** @public */
export type BrandAssetKind = 'image' | 'font'

/** @public */
export interface BrandAsset extends Doc {
  name: string
  kind: BrandAssetKind
  file: Ref<Blob>
  contentType: string
  size: number
  // Font family name the font asset registers in templates
  fontFamily?: string
}

/**
 * Values the template placeholders are replaced with.
 * @public
 */
export type FieldValues = Record<string, string>
