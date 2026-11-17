// SPDX-License-Identifier: EPL-2.0

export function isDragAtBorder (event: MouseEvent, direction: 'top' | 'bottom'): boolean {
  const target = event.currentTarget as HTMLElement
  return Math.abs(event.clientY - target.getBoundingClientRect()[direction]) < 5
}

export function getCategoryDropIndex (event: MouseEvent, itemCount: number, collapsed: boolean): number | undefined {
  if (itemCount === 0 || collapsed || isDragAtBorder(event, 'top')) return 0
  if (isDragAtBorder(event, 'bottom')) return itemCount
  return undefined
}
