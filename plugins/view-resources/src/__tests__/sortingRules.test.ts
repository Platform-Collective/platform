// SPDX-License-Identifier: EPL-2.0

import { SortingOrder } from '@hcengineering/core'
import { buildSortingRules } from '../sortingRules'

describe('buildSortingRules', () => {
  it('maps each value to its position', () => {
    expect(buildSortingRules(SortingOrder.Ascending, ['backlog', 'todo', 'done'])).toEqual({
      order: SortingOrder.Ascending,
      default: 3,
      cases: [
        { query: 'backlog', index: 0 },
        { query: 'todo', index: 1 },
        { query: 'done', index: 2 }
      ]
    })
  })

  it('keeps the requested order', () => {
    const rules = buildSortingRules(SortingOrder.Descending, ['a'])
    expect(rules.order).toBe(SortingOrder.Descending)
    expect(rules.default).toBe(1)
  })

  it('handles an empty list', () => {
    expect(buildSortingRules(SortingOrder.Ascending, [])).toEqual({
      order: SortingOrder.Ascending,
      default: 0,
      cases: []
    })
  })
})
