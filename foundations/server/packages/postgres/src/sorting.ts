// SPDX-License-Identifier: EPL-2.0

import { SortingOrder, type SortRuleQueryType, type SortingRules } from '@hcengineering/core'

/** Translate sorting rules to a parameterized SQL CASE expression. */
export function buildSortingRules<T> (
  rules: SortingRules<T>,
  condition: (query: SortRuleQueryType<T>) => string | undefined,
  value: (value: string | number) => string
): string {
  const branches = rules.cases.map(({ query, index }) => {
    const predicate = condition(query)
    if (predicate === undefined) {
      throw new Error('Unsupported sorting rule query')
    }
    return `WHEN ${predicate} THEN ${value(index)}`
  })
  const fallback = value(rules.default ?? rules.cases.length)
  const expression = branches.length === 0 ? fallback : `CASE ${branches.join(' ')} ELSE ${fallback} END`
  return `${expression} ${rules.order === SortingOrder.Ascending ? 'ASC' : 'DESC'}`
}
