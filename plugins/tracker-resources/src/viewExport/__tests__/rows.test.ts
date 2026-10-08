//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { SortingOrder } from '@hcengineering/core'
import { MAX_EXPORT_ROWS } from '@hcengineering/tracker'

import { loadExportRows, type ExportRowsParams } from '../rows'

const doc = (id: string, props: Record<string, any> = {}): any => ({ _id: id, ...props })

function fakeClient (docs: any[]): { client: any, calls: any[] } {
  const calls: any[] = []
  return {
    calls,
    client: {
      findAll: async (_class: any, query: any, options: any) => {
        calls.push({ query, options })
        return docs
      }
    }
  }
}

const params = (props: Partial<ExportRowsParams> = {}): ExportRowsParams => ({
  query: {},
  groupBy: [],
  getCategories: async () => [undefined],
  ...props
})

describe('loadExportRows', () => {
  it('asks for what the view shows with the sort of the view, without lookups', async () => {
    const f = fakeClient([doc('a')])
    await loadExportRows(
      f.client,
      'cls' as any,
      params({
        query: { status: 's1', '$lookup.attachedTo': 'x' } as any,
        options: { lookup: { attachedTo: 'x' }, limit: 5, sort: { rank: 1 }, projection: { _id: 1 } } as any,
        orderBy: ['dueDate', SortingOrder.Descending]
      })
    )
    expect(f.calls[0].query).toEqual({ status: 's1' })
    expect(f.calls[0].options).toEqual({ sort: { dueDate: SortingOrder.Descending }, limit: MAX_EXPORT_ROWS + 1 })
  })

  it('keeps the order of the server without grouping', async () => {
    const f = fakeClient([doc('b'), doc('a')])
    const res = await loadExportRows(f.client, 'cls' as any, params())
    expect(res.rows.map((r) => r._id)).toEqual(['b', 'a'])
    expect(res.truncated).toBe(false)
  })

  it('shows group after group in the order of the list', async () => {
    const f = fakeClient([doc('1', { priority: 3 }), doc('2', { priority: 1 }), doc('3', { priority: 3 }), doc('4')])
    const res = await loadExportRows(
      f.client,
      'cls' as any,
      params({ groupBy: ['priority'], getCategories: async () => [1, 3, undefined] })
    )
    expect(res.rows.map((r) => r._id)).toEqual(['2', '1', '3', '4'])
  })

  it('groups and sorts by a client side key (a custom field)', async () => {
    const f = fakeClient([
      doc('1', { customFields: { team: 'b', n: 2 } }),
      doc('2', { customFields: { team: 'a', n: 9 } }),
      doc('3', { customFields: { team: 'b', n: 1 } })
    ])
    const res = await loadExportRows(
      f.client,
      'cls' as any,
      params({
        groupBy: ['customFields.team'],
        orderBy: ['customFields.n', SortingOrder.Ascending],
        client: {
          handlesKey: (key) => key.startsWith('customFields.'),
          compare: (key, order) => (a: any, b: any) =>
            (a.customFields.n - b.customFields.n) * (order === SortingOrder.Ascending ? 1 : -1),
          getCategories: () => ['a', 'b']
        }
      })
    )
    expect(res.rows.map((r) => r._id)).toEqual(['2', '3', '1'])
    // The server is not asked to sort by a key it does not know
    expect(f.calls[0].options.sort).toBeUndefined()
  })

  it('cuts a view that is longer than an export can be', async () => {
    const docs = Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => doc(String(i)))
    const f = fakeClient(docs)
    const res = await loadExportRows(f.client, 'cls' as any, params())
    expect(res.rows).toHaveLength(MAX_EXPORT_ROWS)
    expect(res.truncated).toBe(true)
  })
})
