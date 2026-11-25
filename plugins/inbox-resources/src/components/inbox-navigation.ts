// SPDX-License-Identifier: EPL-2.0

import { type Doc, type Ref } from '@hcengineering/core'
import { type DocNotifyContext } from '@hcengineering/notification'
import { type NavigationItem } from '../type'

export interface RemovalSelection {
  items: NavigationItem[]
  selection: number
  nextItem: NavigationItem | undefined
}

export interface NavigationRemovalRequest {
  item: NavigationItem
  fromKeyboard: boolean
}

function getContextId (item: NavigationItem): string {
  return item.type === 'modern' ? item.context.id : item.context._id
}

export function isSameNavigationItem (item: NavigationItem, other: NavigationItem): boolean {
  return item.type === other.type && getContextId(item) === getContextId(other)
}

export function shouldReselectNavigationItem (
  item: NavigationItem,
  fromKeyboard: boolean,
  selectedByRemoval: NavigationItem | undefined,
  doc: Doc | undefined,
  legacyContext: DocNotifyContext | undefined
): boolean {
  return (
    fromKeyboard ||
    (selectedByRemoval != null && isSameNavigationItem(selectedByRemoval, item)) ||
    isOpenedNavigationItem(item, doc, legacyContext)
  )
}

export function isNavigationItemRemovalPending (
  item: NavigationItem,
  removing: NavigationItem | undefined,
  queued: NavigationItem[]
): boolean {
  return (
    (removing != null && isSameNavigationItem(removing, item)) ||
    queued.some((queuedItem) => isSameNavigationItem(queuedItem, item))
  )
}

function clampSelection (selection: number, itemCount: number): number {
  return Math.max(0, Math.min(selection, itemCount - 1))
}

export function isOpenedNavigationItem (
  item: NavigationItem,
  doc: Doc | undefined,
  legacyContext: DocNotifyContext | undefined
): boolean {
  return item.type === 'legacy' && legacyContext != null
    ? item.context._id === legacyContext._id
    : item._id === doc?._id
}

export function getRemovalSelection (
  originalItems: NavigationItem[],
  currentItems: NavigationItem[],
  removedItem: NavigationItem,
  currentSelection: number,
  shouldReselect: boolean
): RemovalSelection {
  const removedIndex = originalItems.findIndex((item) => isSameNavigationItem(item, removedItem))
  if (removedIndex < 0) {
    return {
      items: currentItems,
      selection: clampSelection(currentSelection, currentItems.length),
      nextItem: undefined
    }
  }

  const adjacentItem = originalItems[removedIndex + 1] ?? originalItems[removedIndex - 1]
  const items = currentItems.filter((item) => !isSameNavigationItem(item, removedItem))
  if (!shouldReselect) {
    const selection = removedIndex < currentSelection ? currentSelection - 1 : currentSelection
    return { items, selection: clampSelection(selection, items.length), nextItem: undefined }
  }

  const adjacentIndex = adjacentItem == null ? -1 : items.findIndex((item) => isSameNavigationItem(item, adjacentItem))
  const selection = clampSelection(adjacentIndex < 0 ? removedIndex : adjacentIndex, items.length)
  return { items, selection, nextItem: items[selection] }
}

export function shouldLookupLegacyContext (
  docId: Ref<Doc>,
  queryContext: Ref<DocNotifyContext> | undefined,
  legacyContext: DocNotifyContext | undefined
): boolean {
  return legacyContext?.objectId !== docId || (queryContext != null && legacyContext._id !== queryContext)
}

export class NavigationRemovalQueue {
  private active: NavigationRemovalRequest | undefined
  private readonly pending: NavigationRemovalRequest[] = []

  constructor (
    private readonly remove: (item: NavigationItem, fromKeyboard: boolean) => Promise<void>,
    private readonly onChange: (removing: NavigationItem | undefined, queued: NavigationItem[]) => void
  ) {}

  async enqueue (item: NavigationItem, fromKeyboard: boolean): Promise<void> {
    if (
      (this.active != null && isSameNavigationItem(this.active.item, item)) ||
      this.pending.some((request) => isSameNavigationItem(request.item, item))
    ) {
      return
    }

    this.pending.push({ item, fromKeyboard })
    this.notify()
    if (this.active !== undefined) return

    while (this.pending.length > 0) {
      const request = this.pending.shift()
      if (request == null) break
      this.active = request
      this.notify()
      try {
        await this.remove(request.item, request.fromKeyboard)
      } finally {
        this.active = undefined
        this.notify()
      }
    }
  }

  private notify (): void {
    this.onChange(
      this.active?.item,
      this.pending.map((request) => request.item)
    )
  }
}
