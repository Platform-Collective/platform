// SPDX-License-Identifier: EPL-2.0

import type { Doc, Ref, Space } from '@hcengineering/core'
import { getChatNavQuery } from './chat-nav-query'

jest.mock(
  '@hcengineering/core',
  () => ({
    __esModule: true,
    default: { space: { Space: 'core-space' } }
  }),
  { virtual: true }
)

const ids = Array.from({ length: 60 }, (_, index) => `document-${index}` as Ref<Doc>)

function findDocuments (
  contextIds: Ref<Doc>[],
  limit: number,
  availableIds = contextIds
): {
  docs: Ref<Doc>[]
  total: number
} {
  const { query, options } = getChatNavQuery(contextIds, false, limit)
  const filter = query._id as { $in: Ref<Doc>[] }
  const matches = availableIds.filter((id) => filter.$in.includes(id))
  const docs = options.limit === undefined ? matches : matches.slice(0, options.limit)

  expect(options.total).toBe(true)
  return { docs, total: matches.length }
}

describe('chat sidebar section queries', () => {
  it('keeps six eligible documents in the total so Show More is available', () => {
    const result = findDocuments(ids.slice(0, 6), 5)

    expect(result.docs).toEqual(ids.slice(0, 5))
    expect(result.total).toBe(6)
    expect(result.total > result.docs.length).toBe(true)

    const expanded = findDocuments(ids.slice(0, 6), 55)
    expect(expanded.docs).toEqual(ids.slice(0, 6))
    expect(expanded.total > expanded.docs.length).toBe(false)
  })

  it('retains the total while Show More increases the limit by 50', () => {
    for (const limit of [5, 55, 105]) {
      const result = findDocuments(ids, limit)

      expect(result.docs).toEqual(ids.slice(0, limit))
      expect(result.total).toBe(60)
      expect(result.total > result.docs.length).toBe(limit < ids.length)
    }
  })

  it('fills the section even when the first context IDs no longer resolve to documents', () => {
    const result = findDocuments(ids.slice(0, 11), 5, ids.slice(5, 11))

    expect(result.docs).toEqual(ids.slice(5, 10))
    expect(result.total).toBe(6)
  })

  it('does not offer Show More when all matching documents fit', () => {
    const result = findDocuments(ids.slice(0, 5), 5)

    expect(result.docs).toEqual(ids.slice(0, 5))
    expect(result.total > result.docs.length).toBe(false)
  })

  it('leaves space queries unlimited and keeps the active-space filters', () => {
    expect(getChatNavQuery(ids, true, -1)).toEqual({
      query: { _id: { $in: ids }, space: 'core-space' as Ref<Space>, archived: false },
      options: { total: true }
    })
  })
})
