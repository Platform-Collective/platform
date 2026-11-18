// SPDX-License-Identifier: EPL-2.0

import activity, { type ActivityMessage } from '@hcengineering/activity'
import { type FindOptions, SortingOrder } from '@hcengineering/core'

export function getActivityRepliesQueryOptions (showAll: boolean): FindOptions<ActivityMessage> {
  return {
    limit: showAll ? undefined : 3,
    sort: { createdOn: SortingOrder.Descending },
    lookup: { _id: { reactions: activity.class.Reaction } },
    showArchived: true
  }
}
