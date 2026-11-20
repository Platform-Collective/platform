// SPDX-License-Identifier: EPL-2.0

import type { ActivityMessage } from '@hcengineering/activity'
import { activityMessagesComparator } from '@hcengineering/activity-resources'
import { SortingOrder } from '@hcengineering/core'

interface PinnedActivityMessage extends ActivityMessage {
  isPinned?: boolean
}

export function comparePopupMessages (
  first: PinnedActivityMessage,
  second: PinnedActivityMessage,
  order: SortingOrder
): number {
  const pinned = Number(second.isPinned === true) - Number(first.isPinned === true)
  if (pinned !== 0) return pinned
  return order === SortingOrder.Ascending
    ? activityMessagesComparator(first, second)
    : activityMessagesComparator(second, first)
}
