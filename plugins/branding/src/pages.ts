// SPDX-License-Identifier: EPL-2.0

/**
 * Which pages a header, footer, overlay or element is shown on.
 * Positions in `custom` count within the scope: "1, 3-5, 8-" (open ranges run to the end, "-1" is the last page).
 * @public
 */
export interface PageRule {
  scope: PageScope
  pages: PageSelection
  custom?: string
}

/**
 * content: pages of the document body; template: cover, info and back pages; all: every page.
 * @public
 */
export type PageScope = 'content' | 'template' | 'all'

/** @public */
export type PageSelection = 'all' | 'first' | 'notFirst' | 'last' | 'notLast' | 'odd' | 'even' | 'custom'

/** @public */
export const PAGE_SELECTIONS: PageSelection[] = ['all', 'first', 'notFirst', 'last', 'notLast', 'odd', 'even', 'custom']

/** @public */
export interface PageNumbering {
  // Cover and other template pages take part in page numbers and totals
  countTemplatePages: boolean
  // Number shown on the first numbered page
  start: number
}

/** @public */
export function defaultPageRule (scope: PageScope = 'content'): PageRule {
  return { scope, pages: 'all' }
}

/** @public */
export function defaultNumbering (): PageNumbering {
  return { countTemplatePages: false, start: 1 }
}

/**
 * Place of a physical page in the printed document.
 * @public
 */
export interface PagePosition {
  // 1-based position in the whole document
  index: number
  total: number
  kind: 'template' | 'content'
  // 1-based position among pages of the same kind, and their count
  kindIndex: number
  kindTotal: number
}

/**
 * Positions of all pages: template pages before the content, content pages, template pages after.
 * @public
 */
export function describePages (before: number, content: number, after: number): PagePosition[] {
  const total = before + content + after
  const templateTotal = before + after
  const result: PagePosition[] = []
  for (let i = 0; i < total; i++) {
    const isContent = i >= before && i < before + content
    result.push({
      index: i + 1,
      total,
      kind: isContent ? 'content' : 'template',
      kindIndex: isContent ? i - before + 1 : i < before ? i + 1 : i - content + 1,
      kindTotal: isContent ? content : templateTotal
    })
  }
  return result
}

/**
 * Parse "1, 3-5, 8-, -1" into a membership test for 1-based positions within `count` pages.
 * @public
 */
export function parsePageRanges (spec: string, count: number): (n: number) => boolean {
  const ranges: Array<[number, number]> = []
  for (const part of spec.split(',').map((p) => p.trim()).filter((p) => p !== '')) {
    if (/^-\d+$/.test(part)) {
      // Counted from the end: -1 is the last page
      const n = count + 1 - parseInt(part.slice(1), 10)
      ranges.push([n, n])
      continue
    }
    const match = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part)
    if (match === null) continue
    const from = match[1] !== undefined ? parseInt(match[1], 10) : 1
    const to = match[2] !== undefined ? (match[3] !== undefined ? parseInt(match[3], 10) : count) : from
    ranges.push([Math.min(from, to), Math.max(from, to)])
  }
  return (n) => ranges.some(([from, to]) => n >= from && n <= to)
}

/**
 * Odd and even follow the physical page, so double-sided printouts keep left and right pages apart.
 * @public
 */
export function ruleMatches (rule: PageRule | undefined, pos: PagePosition): boolean {
  const effective = rule ?? defaultPageRule()
  if (effective.scope !== 'all' && effective.scope !== pos.kind) return false
  const n = effective.scope === 'all' ? pos.index : pos.kindIndex
  const count = effective.scope === 'all' ? pos.total : pos.kindTotal
  switch (effective.pages) {
    case 'all':
      return true
    case 'first':
      return n === 1
    case 'notFirst':
      return n !== 1
    case 'last':
      return n === count
    case 'notLast':
      return n !== count
    case 'odd':
      return pos.index % 2 === 1
    case 'even':
      return pos.index % 2 === 0
    case 'custom':
      return parsePageRanges(effective.custom ?? '', count)(n)
  }
  // Unknown selections never match
  return false
}

/**
 * Page number shown on the page, empty for pages excluded from numbering.
 * @public
 */
export function pageNumberFor (pos: PagePosition, numbering: PageNumbering | undefined): string {
  const { countTemplatePages, start } = numbering ?? defaultNumbering()
  if (countTemplatePages) return String(pos.index + start - 1)
  return pos.kind === 'content' ? String(pos.kindIndex + start - 1) : ''
}

/** @public */
export function totalPagesFor (pos: PagePosition, numbering: PageNumbering | undefined): string {
  const { countTemplatePages, start } = numbering ?? defaultNumbering()
  const count = countTemplatePages ? pos.total : pos.kind === 'content' ? pos.kindTotal : countContent(pos)
  return String(count + start - 1)
}

function countContent (pos: PagePosition): number {
  // On template pages the content count is the rest of the document
  return pos.total - pos.kindTotal
}

/**
 * A decoration drawn on pages: shown where every `match` rule applies and no `exclude` rule does.
 * The HTML is absolutely positioned page content and may hold page markers
 * (`<span class="pageNumber"></span>`, `<span class="totalPages"></span>`).
 * @public
 */
export interface PageLayer {
  html: string
  match: PageRule[]
  exclude: PageRule[]
}

/** @public */
export function layerApplies (layer: PageLayer, pos: PagePosition): boolean {
  return layer.match.every((r) => ruleMatches(r, pos)) && !layer.exclude.some((r) => ruleMatches(r, pos))
}

/**
 * Transparent document with one page per document page, holding the decorations of each page.
 * The print service stamps page N of it over page N of the document.
 * @public
 */
export function renderDecorationDocument (
  page: { width: number, height: number },
  css: string,
  pages: string[]
): string {
  const size = `${page.width}mm ${page.height}mm`
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"/><style>',
    `@page{size:${size};margin:0}`,
    'html,body{margin:0;padding:0;background:transparent}',
    '*{box-sizing:border-box}',
    'body{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    `.page{position:relative;width:${page.width}mm;height:${page.height}mm;overflow:hidden;break-after:page}`,
    '.page:last-child{break-after:auto}',
    css,
    '</style></head><body>',
    ...pages.map((html) => `<div class="page">${html}</div>`),
    '</body></html>'
  ].join('')
}

/**
 * Markup of all layers shown on the page with page numbers filled in.
 * @public
 */
export function renderLayersForPage (layers: PageLayer[], pos: PagePosition, numbering: PageNumbering | undefined): string {
  const number = pageNumberFor(pos, numbering)
  const total = totalPagesFor(pos, numbering)
  return layers
    .filter((layer) => layerApplies(layer, pos))
    .map((layer) =>
      layer.html
        .replace(/<span class="pageNumber"><\/span>/g, number)
        .replace(/<span class="totalPages"><\/span>/g, total)
    )
    .join('')
}
