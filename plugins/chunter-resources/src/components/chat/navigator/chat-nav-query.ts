// SPDX-License-Identifier: EPL-2.0

import core from '@hcengineering/core'
import type { Doc, DocumentQuery, FindOptions, Ref } from '@hcengineering/core'

/** Builds the object query and display options for a chat sidebar section. */
export function getChatNavQuery (
  ids: Ref<Doc>[],
  isSpace: boolean,
  limit: number
): { query: DocumentQuery<Doc>, options: FindOptions<Doc> } {
  return {
    query: {
      _id: { $in: ids },
      ...(isSpace ? { space: core.space.Space, archived: false } : {})
    },
    options: { total: true, ...(limit !== -1 ? { limit } : {}) }
  }
}
