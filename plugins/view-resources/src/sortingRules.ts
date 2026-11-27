// SPDX-License-Identifier: EPL-2.0

import { type SortingOrder, type SortingRules } from '@hcengineering/core'

/**
 * Build sorting rules which order values by their position in sortedValues.
 * Values not listed are placed after all listed ones (for ascending order).
 * @public
 */
export function buildSortingRules<T> (order: SortingOrder, sortedValues: T[]): SortingRules<T> {
  return {
    order,
    default: sortedValues.length,
    cases: sortedValues.map((value, index) => ({ query: value as any, index }))
  }
}
