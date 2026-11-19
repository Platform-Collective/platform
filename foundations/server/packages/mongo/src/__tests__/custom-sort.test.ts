// SPDX-License-Identifier: EPL-2.0

import { type SortingRules, SortingOrder } from '@hcengineering/core'
import { buildCustomSortBranches } from '../custom-sort'

describe('Mongo custom sorting', () => {
  it('uses the $nin values in a negated aggregation $in expression', () => {
    const rules: SortingRules<string> = {
      order: SortingOrder.Ascending,
      cases: [{ query: { $nin: ['archived', 'deleted'] }, index: 0 }]
    }

    expect(buildCustomSortBranches(rules, 'status')).toEqual([
      { case: { $not: { $in: ['$status', ['archived', 'deleted']] } }, then: 0 }
    ])
  })

  it('builds aggregation expressions for inclusion and null or missing values', () => {
    const rules: SortingRules<string> = {
      order: SortingOrder.Ascending,
      cases: [{ query: { $in: ['open', 'active'] }, index: 0 }, { query: null, index: 1 }]
    }

    expect(buildCustomSortBranches(rules, 'status')).toEqual([
      { case: { $in: ['$status', ['open', 'active']] }, then: 0 },
      {
        case: { $or: [{ $eq: ['$status', null] }, { $eq: [{ $type: '$status' }, 'missing'] }] },
        then: 1
      }
    ])
  })
})
