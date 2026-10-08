//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Finding the cells of the rendered list. A cell has no wrapper element of its own: the presenter is
// bracketed by two comment nodes, `<!--cell:key-->` and `<!--/cell-->`, and the cell is whatever elements
// sit between them. Rows carry `data-row-doc` with the id of the document.

const START_PREFIX = 'cell:'
const END_DATA = '/cell'

export const CELL_END_MARKER = `<!--${END_DATA}-->`
export const ROW_ATTRIBUTE = 'data-row-doc'

/** Markup of the comment that opens a cell of the column `key`. */
export function cellStartMarker (key: string): string {
  return `<!--${START_PREFIX}${encodeURIComponent(key)}-->`
}

/** Column key out of the data of an opening comment; undefined for any other comment. */
export function parseCellMarker (data: string): string | undefined {
  if (!data.startsWith(START_PREFIX)) return undefined
  try {
    return decodeURIComponent(data.slice(START_PREFIX.length))
  } catch {
    return undefined
  }
}

export function isCellEnd (data: string): boolean {
  return data === END_DATA
}

export interface RowCells {
  // Id of the document of the row
  id: string
  element: Element
  // Elements of each cell by column key
  cells: Map<string, Element[]>
}

export interface DomGrid {
  rows: RowCells[]
  // Column keys in the order they appear on screen
  cols: string[]
}

export function isRendered (el: Element): boolean {
  return el.getClientRects().length > 0
}

/**
 * Cells of one row. A row can render a column twice (a compact row repeats some cells in a hidden panel),
 * the cell that is actually on screen wins.
 */
export function collectRowCells (row: Element): { keys: string[], cells: Map<string, Element[]> } {
  const keys: string[] = []
  const cells = new Map<string, Element[]>()
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_COMMENT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const key = parseCellMarker((node as Comment).data)
    if (key === undefined) continue
    const elements: Element[] = []
    for (let sibling = node.nextSibling; sibling !== null; sibling = sibling.nextSibling) {
      if (sibling.nodeType === Node.COMMENT_NODE && isCellEnd((sibling as Comment).data)) break
      if (sibling.nodeType === Node.ELEMENT_NODE) elements.push(sibling as Element)
    }
    const known = cells.get(key)
    if (known === undefined) {
      keys.push(key)
      cells.set(key, elements)
    } else if (!known.some(isRendered) && elements.some(isRendered)) {
      cells.set(key, elements)
    }
  }
  return { keys, cells }
}

/**
 * The visible rows (collapsed groups are skipped) with their cells, in screen order, and the columns.
 */
export function buildGrid (root: ParentNode): DomGrid {
  const rows: RowCells[] = []
  const cols: string[] = []
  const seen = new Set<string>()
  root.querySelectorAll(`[${ROW_ATTRIBUTE}]`).forEach((element) => {
    if (!isRendered(element)) return
    const id = element.getAttribute(ROW_ATTRIBUTE)
    if (id === null) return
    const { keys, cells } = collectRowCells(element)
    // Only the cells that are shown make a column
    const shown = keys.filter((key) => cells.get(key)?.some(isRendered) === true)
    for (const key of shown) {
      if (!seen.has(key)) {
        seen.add(key)
        cols.push(key)
      }
    }
    rows.push({ id, element, cells })
  })
  return { rows, cols }
}

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Screen box of a cell: the width of its elements and the height of its row. */
export function cellBox (row: RowCells, key: string): ScreenRect | undefined {
  const elements = (row.cells.get(key) ?? []).filter(isRendered)
  if (elements.length === 0) return undefined
  const rowRect = row.element.getBoundingClientRect()
  let left = Infinity
  let right = -Infinity
  for (const el of elements) {
    const r = el.getBoundingClientRect()
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
  }
  return { left, right, top: rowRect.top, bottom: rowRect.bottom }
}

export function intersect (a: ScreenRect, b: ScreenRect): ScreenRect | undefined {
  const res = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom)
  }
  return res.right > res.left && res.bottom > res.top ? res : undefined
}

/** The part of the screen in which an element can be seen: the intersection of its clipping ancestors. */
export function visibleArea (el: Element): ScreenRect {
  let area: ScreenRect = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (let parent = el.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const r = parent.getBoundingClientRect()
    const next = intersect(area, { left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    if (next === undefined) return { left: 0, top: 0, right: 0, bottom: 0 }
    area = next
  }
  return area
}

const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], .cursor-pointer, .editable, [tabindex]'

/** Click the part of a cell that opens its editor: the first control, else the cell itself. */
export function activateCell (row: RowCells, key: string): boolean {
  const elements = (row.cells.get(key) ?? []).filter(isRendered)
  for (const el of elements) {
    const control = el.matches(INTERACTIVE) ? el : el.querySelector<HTMLElement>(INTERACTIVE)
    if (control !== null) {
      ;(control as HTMLElement).click()
      return true
    }
  }
  const first = elements[0] as HTMLElement | undefined
  if (first === undefined) return false
  first.click()
  return true
}

/** Plain text of a cell as it is shown. */
export function cellText (row: RowCells, key: string): string {
  return (row.cells.get(key) ?? [])
    .filter(isRendered)
    .map((el) => (el as HTMLElement).innerText ?? el.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
