// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import { SortingOrder } from '@hcengineering/core'
import { getActivityRepliesQueryOptions } from '../components/activity-message/activity-replies'

describe('activity reply preview', () => {
  it('loads the three newest replies with their reactions', () => {
    expect(getActivityRepliesQueryOptions(false)).toEqual({
      limit: 3,
      sort: { createdOn: SortingOrder.Descending },
      lookup: { _id: { reactions: activity.class.Reaction } },
      showArchived: true
    })
  })

  it('removes only the limit when all replies are requested', () => {
    const options = getActivityRepliesQueryOptions(true)

    expect(options.limit).toBeUndefined()
    expect(options.sort).toEqual({ createdOn: SortingOrder.Descending })
    expect(options.lookup).toEqual({ _id: { reactions: activity.class.Reaction } })
    expect(options.showArchived).toBe(true)
  })
})
