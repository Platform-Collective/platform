// SPDX-License-Identifier: EPL-2.0

import core, { type Doc, Hierarchy, ModelDb, resultSort, SortingOrder } from '@hcengineering/core'
import { IssuePriority, issuePrioritySorting } from '../index'

describe('issue priority query sorting', () => {
  const expected = [
    IssuePriority.Urgent,
    IssuePriority.High,
    IssuePriority.Medium,
    IssuePriority.Low,
    IssuePriority.NoPriority
  ]

  it.each([SortingOrder.Ascending, SortingOrder.Descending])('orders all five priorities in direction %s', (order) => {
    const hierarchy = new Hierarchy()
    jest.spyOn(hierarchy, 'findAttribute').mockReturnValue(undefined)
    const docs = [
      IssuePriority.Low,
      IssuePriority.NoPriority,
      IssuePriority.High,
      IssuePriority.Urgent,
      IssuePriority.Medium
    ].map((priority) => ({ priority }) as unknown as Doc & { priority: IssuePriority })

    const sort = { priority: { ...issuePrioritySorting, order } }
    resultSort(docs, sort, core.class.Doc, hierarchy, new ModelDb(hierarchy))

    expect(docs.map(({ priority }) => priority)).toEqual(
      order === SortingOrder.Ascending ? expected : [...expected].reverse()
    )
  })

  it('keeps the persisted enum values unchanged', () => {
    expect([
      IssuePriority.NoPriority,
      IssuePriority.Urgent,
      IssuePriority.High,
      IssuePriority.Medium,
      IssuePriority.Low
    ]).toEqual([0, 1, 2, 3, 4])
  })
})
