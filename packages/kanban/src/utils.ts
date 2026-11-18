// SPDX-License-Identifier: EPL-2.0

import type { Doc, Rank, Ref } from '@hcengineering/core'
import { makeRank } from '@hcengineering/rank'
import type { Item } from './types'

/** Calculate the persisted rank from the final displayed order without mutating the dragged document. */
export function getDropRank (items: Item[], draggedId: Ref<Doc>): Rank | undefined {
  const index = items.findIndex((item) => item._id === draggedId)
  if (index === -1) {
    return undefined
  }
  return makeRank(items[index - 1]?.rank, items[index + 1]?.rank)
}
