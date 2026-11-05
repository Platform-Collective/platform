// SPDX-License-Identifier: EPL-2.0

import {
  type PageBackground,
  type TemplateBand,
  type TemplateDesign,
  type TemplateElement,
  generateElementId,
  getPageDimensions
} from '@hcengineering/branding'

export const MM_TO_PX = 96 / 25.4

/**
 * What the editor canvas currently shows.
 */
// variant: id of an alternate header or footer, the main one when undefined
export type SurfaceRef =
  | { kind: 'page', id: string }
  | { kind: 'header', variant?: string }
  | { kind: 'footer', variant?: string }
  | { kind: 'overlay' }

export type EditorSection = SurfaceRef | { kind: 'typography' } | { kind: 'setup' }

export interface Surface {
  width: number
  height: number
  background: PageBackground
  elements: TemplateElement[]
  // Band surfaces show the page content margins as guides
  isBand: boolean
  // Overlay surface: drawn over document pages, shown above a sample page
  isOverlay?: boolean
}

export function isSurface (section: EditorSection): section is SurfaceRef {
  return section.kind === 'page' || section.kind === 'header' || section.kind === 'footer' || section.kind === 'overlay'
}

export function clone<T> (value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export function getSurface (design: TemplateDesign, ref: SurfaceRef): Surface | undefined {
  const { width, height } = getPageDimensions(design.page)
  if (ref.kind === 'page') {
    const page = design.pages.find((p) => p.id === ref.id)
    if (page === undefined) return undefined
    return { width, height, background: page.background, elements: page.elements, isBand: false }
  }
  if (ref.kind === 'overlay') {
    return {
      width,
      height,
      background: { color: '#ffffff', fit: 'cover' },
      elements: design.overlay.elements,
      isBand: false,
      isOverlay: true
    }
  }
  const band = getBand(design, ref)
  if (band === undefined) return undefined
  return {
    width,
    height: band.height,
    background: { color: band.background !== '' ? band.background : '#ffffff', fit: 'cover' },
    elements: band.elements,
    isBand: true
  }
}

export function setSurfaceElements (design: TemplateDesign, ref: SurfaceRef, elements: TemplateElement[]): void {
  if (ref.kind === 'page') {
    const page = design.pages.find((p) => p.id === ref.id)
    if (page !== undefined) page.elements = elements
  } else if (ref.kind === 'overlay') {
    design.overlay.elements = elements
  } else {
    const band = getBand(design, ref)
    if (band !== undefined) band.elements = elements
  }
}

/**
 * The main band, or the alternate with the given id.
 */
export function getBand (
  design: TemplateDesign,
  ref: { kind: 'header' | 'footer', variant?: string }
): TemplateBand | undefined {
  const main = ref.kind === 'header' ? design.header : design.footer
  if (ref.variant === undefined) return main
  const alternates = ref.kind === 'header' ? design.headerAlternates : design.footerAlternates
  return alternates.find((b) => b.id === ref.variant)
}

export function duplicateElement (el: TemplateElement): TemplateElement {
  return { ...clone(el), id: generateElementId(), x: el.x + 5, y: el.y + 5 }
}

export function sameSection (a: EditorSection, b: EditorSection): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'page') return a.id === (b as { id: string }).id
  if (a.kind === 'header' || a.kind === 'footer') {
    return a.variant === (b as { variant?: string }).variant
  }
  return true
}

export interface SnapResult {
  value: number
  guide?: number
}

/**
 * Snap an element edge set (start, center, end) to the nearest guide within threshold.
 */
export function snapAxis (start: number, size: number, guides: number[], threshold: number): SnapResult {
  let best: SnapResult = { value: start }
  let bestDistance = threshold
  for (const offset of [0, size / 2, size]) {
    for (const guide of guides) {
      const distance = Math.abs(start + offset - guide)
      if (distance < bestDistance) {
        bestDistance = distance
        best = { value: guide - offset, guide }
      }
    }
  }
  return best
}

export function round (value: number, step = 0.1): number {
  return Number((Math.round(value / step) * step).toFixed(3))
}

/**
 * Markup for injecting a stylesheet with `{@html}` (a literal style tag in markup is parsed by Svelte).
 */
export function styleTag (css: string): string {
  return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
}

// Copied elements, shared by all surfaces and editor sessions of this browser tab
let clipboard: TemplateElement[] = []

export function copyElements (elements: TemplateElement[]): void {
  clipboard = clone(elements)
}

export function pasteElements (): TemplateElement[] {
  return clipboard.map((el) => ({ ...clone(el), id: generateElementId(), x: el.x + 5, y: el.y + 5 }))
}

export function hasClipboard (): boolean {
  return clipboard.length > 0
}

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'

/**
 * Align elements to each other, or to the surface when only one element is selected.
 */
export function alignElements (
  elements: TemplateElement[],
  ids: Set<string>,
  kind: AlignKind,
  surface: { width: number, height: number }
): TemplateElement[] {
  const selected = elements.filter((el) => ids.has(el.id) && el.locked !== true)
  if (selected.length === 0) return elements
  const bounds =
    selected.length === 1
      ? { left: 0, top: 0, right: surface.width, bottom: surface.height }
      : {
          left: Math.min(...selected.map((el) => el.x)),
          top: Math.min(...selected.map((el) => el.y)),
          right: Math.max(...selected.map((el) => el.x + el.width)),
          bottom: Math.max(...selected.map((el) => el.y + el.height))
        }
  return elements.map((el) => {
    if (!ids.has(el.id) || el.locked === true) return el
    switch (kind) {
      case 'left':
        return { ...el, x: round(bounds.left) }
      case 'hcenter':
        return { ...el, x: round((bounds.left + bounds.right - el.width) / 2) }
      case 'right':
        return { ...el, x: round(bounds.right - el.width) }
      case 'top':
        return { ...el, y: round(bounds.top) }
      case 'vmiddle':
        return { ...el, y: round((bounds.top + bounds.bottom - el.height) / 2) }
      case 'bottom':
        return { ...el, y: round(bounds.bottom - el.height) }
    }
    return el
  })
}

/**
 * Space three or more elements evenly between the outermost ones.
 */
export function distributeElements (
  elements: TemplateElement[],
  ids: Set<string>,
  axis: 'horizontal' | 'vertical'
): TemplateElement[] {
  const selected = elements.filter((el) => ids.has(el.id) && el.locked !== true)
  if (selected.length < 3) return elements
  const pos = (el: TemplateElement): number => (axis === 'horizontal' ? el.x : el.y)
  const size = (el: TemplateElement): number => (axis === 'horizontal' ? el.width : el.height)
  const sorted = [...selected].sort((a, b) => pos(a) - pos(b))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const total = sorted.reduce((sum, el) => sum + size(el), 0)
  const gap = (pos(last) + size(last) - pos(first) - total) / (sorted.length - 1)
  const target = new Map<string, number>()
  let cursor = pos(first)
  for (const el of sorted) {
    target.set(el.id, round(cursor))
    cursor += size(el) + gap
  }
  return elements.map((el) => {
    const value = target.get(el.id)
    if (value === undefined) return el
    return axis === 'horizontal' ? { ...el, x: value } : { ...el, y: value }
  })
}

export type OrderKind = 'front' | 'forward' | 'backward' | 'back'

/**
 * Change stacking order; later elements are drawn on top.
 */
export function reorderElements (elements: TemplateElement[], ids: Set<string>, kind: OrderKind): TemplateElement[] {
  const selected = elements.filter((el) => ids.has(el.id))
  const rest = elements.filter((el) => !ids.has(el.id))
  if (kind === 'front') return [...rest, ...selected]
  if (kind === 'back') return [...selected, ...rest]
  const result = [...elements]
  const step = kind === 'forward' ? 1 : -1
  const indices = result.map((el, i) => (ids.has(el.id) ? i : -1)).filter((i) => i >= 0)
  for (const i of step > 0 ? indices.reverse() : indices) {
    const j = i + step
    if (j < 0 || j >= result.length || ids.has(result[j].id)) continue
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
