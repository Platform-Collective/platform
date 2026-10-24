// SPDX-License-Identifier: EPL-2.0

import type { NavigationItem } from './type'

/** Select the following row, or the preceding row when removing the last item. */
export function getSelectionAfterRemoval (
  items: NavigationItem[],
  item: NavigationItem
): { navItem: NavigationItem | undefined, selection: number } {
  const index = items.indexOf(item)
  return {
    navItem: items[index + 1] ?? items[index - 1],
    selection: Math.max(0, Math.min(index, items.length - 2))
  }
}
