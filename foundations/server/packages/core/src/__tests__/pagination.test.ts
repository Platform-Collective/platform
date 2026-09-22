//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core, { toFindResult, type Doc, type FindResult, type Ref } from '@hcengineering/core'
import { PlatformError } from '@hcengineering/platform'
import {
  buildCursorPayload,
  calculatePageQueryHash,
  checkCursorPayload,
  filterByPagination,
  findPage,
  plainCursorCodec,
  preparePageProjection,
  preparePaginationFields
} from '../pagination'
import type { FindPagination } from '../types'

interface TestDoc extends Doc {
  name: string
  flag?: boolean
}

const testClass = core.class.Doc as Ref<any>

function doc (id: string, name: string, flag?: boolean): TestDoc {
  return {
    _id: id as Ref<TestDoc>,
    _class: testClass,
    space: core.space.Space,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    name,
    flag
  }
}

describe('pagination fields', () => {
  it('appends _id as a tie breaker', () => {
    expect(preparePaginationFields(testClass, { name: 1 })).toEqual([
      { field: 'name', order: 1 },
      { field: '_id', order: 1 }
    ])
  })

  it('keeps an explicit _id order', () => {
    expect(preparePaginationFields(testClass, { _id: -1 })).toEqual([{ field: '_id', order: -1 }])
  })

  it.each([{ '$lookup.space.name': 1 }, { 'nested.field': 1 }, { name: 5 as any }])(
    'rejects an unsupported sort %p',
    (sort) => {
      expect(() => preparePaginationFields(testClass, sort as any)).toThrow(PlatformError)
    }
  )
})

describe('cursor payload', () => {
  const fields = preparePaginationFields(testClass, { name: 1 })
  const hash = calculatePageQueryHash(testClass, { name: 'a' }, fields, undefined)

  it('survives a round trip', () => {
    const payload = buildCursorPayload(testClass, hash, fields, doc('id-1', 'a'))
    const decoded = plainCursorCodec.decode(plainCursorCodec.encode(payload))
    expect(checkCursorPayload(decoded, testClass, hash, fields)).toEqual(['a', 'id-1'])
  })

  it('is rejected when the query changes', () => {
    const payload = buildCursorPayload(testClass, hash, fields, doc('id-1', 'a'))
    const otherHash = calculatePageQueryHash(testClass, { name: 'b' }, fields, undefined)
    expect(() => checkCursorPayload(payload, testClass, otherHash, fields)).toThrow(PlatformError)
  })

  it('is rejected when the sort changes', () => {
    const payload = buildCursorPayload(testClass, hash, fields, doc('id-1', 'a'))
    const otherFields = preparePaginationFields(testClass, { name: -1 })
    expect(() => checkCursorPayload(payload, testClass, hash, otherFields)).toThrow(PlatformError)
  })

  it('does not accept a foreign cursor', () => {
    expect(() => plainCursorCodec.decode('not-a-cursor')).toThrow()
  })
})

describe('in memory keyset filter', () => {
  const docs = [doc('a', 'one'), doc('b', 'two'), doc('c', 'three')]

  it('keeps documents after the cursor position', () => {
    const pagination: FindPagination = {
      fields: [{ field: '_id', order: 1 }],
      values: ['a']
    }
    expect(filterByPagination(docs, pagination).map(({ _id }) => _id)).toEqual(['b', 'c'])
  })

  it('follows a descending order', () => {
    const pagination: FindPagination = {
      fields: [{ field: '_id', order: -1 }],
      values: ['c']
    }
    expect(filterByPagination(docs, pagination).map(({ _id }) => _id)).toEqual(['a', 'b'])
  })

  it('uses the next field once the previous one is equal', () => {
    const sameName = [doc('a', 'one'), doc('b', 'one'), doc('c', 'two')]
    const pagination: FindPagination = {
      fields: [
        { field: 'name', order: 1 },
        { field: '_id', order: 1 }
      ],
      values: ['one', 'a']
    }
    expect(filterByPagination(sameName, pagination).map(({ _id }) => _id)).toEqual(['b', 'c'])
  })

  it('places nulls first for an ascending order', () => {
    const withNulls = [doc('a', 'one'), doc('b', 'two', false), doc('c', 'three', true)]
    const pagination: FindPagination = {
      fields: [{ field: 'flag', order: 1 }],
      values: [undefined]
    }
    expect(filterByPagination(withNulls, pagination).map(({ _id }) => _id)).toEqual(['b', 'c'])
  })

  it.each([1, -1] as const)('follows the in memory sort order, order %i', (order) => {
    // resultSort compares strings with localeCompare, which differs from a code point order for mixed case
    // values. A keyset predicate built on a different order would skip documents between pages.
    const names = [
      'Default Test Management',
      'Default Trainings',
      'Default teamspace type',
      'Default drive type',
      'Default product type',
      'Spaces'
    ]
    const sorted = names
      .map((name, index) => doc(`id-${index}`, name))
      .sort((left, right) => left.name.localeCompare(right.name) * order)

    const collected: string[] = []
    let values: unknown[] | undefined
    for (let page = 0; page <= names.length; page++) {
      const rest = filterByPagination(sorted, { fields: [{ field: 'name', order }], values })
      if (rest.length === 0) {
        break
      }
      collected.push(rest[0].name)
      values = [rest[0].name]
    }
    expect(collected).toEqual(sorted.map(({ name }) => name))
  })

  it('places nulls last for a descending order', () => {
    const withNulls = [doc('a', 'one'), doc('b', 'two', false), doc('c', 'three', true)]
    const pagination: FindPagination = {
      fields: [{ field: 'flag', order: -1 }],
      values: [true]
    }
    expect(filterByPagination(withNulls, pagination).map(({ _id }) => _id)).toEqual(['a', 'b'])
  })
})

describe('page projection', () => {
  const fields = preparePaginationFields(testClass, { name: 1 })

  it('adds cursor fields to an inclusion projection', () => {
    const { projection, added } = preparePageProjection<TestDoc>({ flag: 1 } as any, fields)
    expect(projection).toEqual({ flag: 1, name: 1, _id: 1 })
    expect([...added]).toEqual(['name', '_id'])
  })

  it('removes cursor fields from an exclusion projection', () => {
    const { projection, added } = preparePageProjection<TestDoc>({ name: 0, flag: 0 } as any, fields)
    expect(projection).toEqual({ flag: 0 })
    expect([...added]).toEqual(['name'])
  })
})

describe('findPage', () => {
  const docs = [doc('a', 'one'), doc('b', 'two'), doc('c', 'three'), doc('d', 'four'), doc('e', 'five')]

  async function fetchPages (limit: number): Promise<{ pages: number, ids: string[] }> {
    const ids: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await findPage<TestDoc>(
        testClass,
        {},
        { limit, cursor },
        async (pagination, sort, projection, pageLimit): Promise<FindResult<TestDoc>> => {
          const sorted = [...docs].sort((left, right) => left._id.localeCompare(right._id))
          const filtered = filterByPagination(sorted, pagination)
          return toFindResult(filtered.slice(0, pageLimit), filtered.length)
        }
      )
      ids.push(...page.docs.map(({ _id }) => _id))
      cursor = page.nextCursor
      pages++
    } while (cursor !== undefined)
    return { pages, ids }
  }

  it('walks all pages without gaps or duplicates', async () => {
    await expect(fetchPages(2)).resolves.toEqual({ pages: 3, ids: ['a', 'b', 'c', 'd', 'e'] })
  })

  it('returns a single page when everything fits', async () => {
    await expect(fetchPages(5)).resolves.toEqual({ pages: 1, ids: ['a', 'b', 'c', 'd', 'e'] })
  })

  it.each([0, -1, 1.5, 1001])('rejects limit %p', async (limit) => {
    await expect(fetchPages(limit)).rejects.toThrow(PlatformError)
  })

  it('rejects lookup based filters', async () => {
    await expect(
      findPage<TestDoc>(testClass, { '$lookup.space.name': 'x' } as any, { limit: 10 }, async () => toFindResult([]))
    ).rejects.toThrow(PlatformError)
  })

  it('rejects a cursor issued for another query', async () => {
    const first = await findPage<TestDoc>(testClass, {}, { limit: 2 }, async (pagination, sort, projection, limit) =>
      toFindResult(filterByPagination(docs, pagination).slice(0, limit), docs.length)
    )
    expect(first.nextCursor).toBeDefined()
    await expect(
      findPage<TestDoc>(testClass, { name: 'other' }, { limit: 2, cursor: first.nextCursor }, async () =>
        toFindResult([])
      )
    ).rejects.toThrow(PlatformError)
  })
})
