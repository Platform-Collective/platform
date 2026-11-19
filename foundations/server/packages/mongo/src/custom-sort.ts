// SPDX-License-Identifier: EPL-2.0

import type { SortQuerySelector, SortingRules } from '@hcengineering/core'

export function buildCustomSortBranches<T> (
  rules: SortingRules<T>,
  key: string
): Array<{ case: unknown, then: string | number }> {
  return rules.cases.map((selector) => {
    if (selector.query === null) {
      return {
        case: { $or: [{ $eq: [`$${key}`, null] }, { $eq: [{ $type: `$${key}` }, 'missing'] }] },
        then: selector.index
      }
    }
    if (typeof selector.query === 'object') {
      const q = selector.query as SortQuerySelector<T>
      if (q.$in !== undefined) {
        return { case: { $in: [`$${key}`, q.$in] }, then: selector.index }
      }
      if (q.$nin !== undefined) {
        return { case: { $not: { $in: [`$${key}`, q.$nin] } }, then: selector.index }
      }
      if (q.$ne !== undefined) {
        return { case: { $ne: [`$${key}`, q.$ne] }, then: selector.index }
      }
    }
    return { case: { $eq: [`$${key}`, selector.query] }, then: selector.index }
  })
}
