// SPDX-License-Identifier: EPL-2.0

export interface DragRect {
  top: number
  bottom: number
  left: number
  right: number
}

export function isPointInside (rect: DragRect, x: number, y: number): boolean {
  return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom
}

function isUpperHalf (rect: DragRect, y: number): boolean {
  return y - rect.top < (rect.bottom - rect.top) / 2
}

export function getCategoryDropIndex (event: MouseEvent, itemCount: number, collapsed: boolean): number {
  if (itemCount === 0 || collapsed) return 0
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return isUpperHalf(rect, event.clientY) ? 0 : itemCount
}

export function removeDragPreview<T extends { _id: string }> (items: T[], previewId: string | undefined): T[] {
  if (previewId === undefined) return items
  return items.filter((item) => item._id !== previewId)
}
