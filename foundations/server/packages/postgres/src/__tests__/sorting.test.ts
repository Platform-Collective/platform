// SPDX-License-Identifier: EPL-2.0

import core, {
  type Domain,
  Hierarchy,
  type MeasureContext,
  MeasureMetricsContext,
  type SessionData,
  SortingOrder
} from '@hcengineering/core'
import { buildSortingRules } from '../sorting'
import { PostgresAdapter } from '../storage'

describe('SQL sorting rules', () => {
  it.each([SortingOrder.Ascending, SortingOrder.Descending])('ranks all five priorities in direction %s', (order) => {
    const params: Array<string | number> = []
    const value = (v: string | number): string => {
      params.push(v)
      return `$${params.length}`
    }
    const sorting = buildSortingRules(
      { order, cases: [1, 2, 3, 4, 0].map((query, index) => ({ query, index: index + 1 })) },
      (query) => `data#>>'{priority}' = ${value(String(query))}`,
      value
    )

    expect(sorting).toBe(
      "CASE WHEN data#>>'{priority}' = $1 THEN $2 WHEN data#>>'{priority}' = $3 THEN $4 " +
        "WHEN data#>>'{priority}' = $5 THEN $6 WHEN data#>>'{priority}' = $7 THEN $8 " +
        `WHEN data#>>'{priority}' = $9 THEN $10 ELSE $11 END ${order === SortingOrder.Ascending ? 'ASC' : 'DESC'}`
    )
    expect(params).toEqual(['1', 1, '2', 2, '3', 3, '4', 4, '0', 5, 5])
  })

  it('parameterizes string ranks and the explicit fallback', () => {
    const value = jest.fn((v: string | number) => '?')
    expect(
      buildSortingRules(
        { order: SortingOrder.Ascending, cases: [{ query: 0, index: "a'b" }], default: 9 },
        () => 'priority = 0',
        value
      )
    ).toBe('CASE WHEN priority = 0 THEN ? ELSE ? END ASC')
    expect(value.mock.calls).toEqual([["a'b"], [9]])
  })

  it('handles rules without cases', () => {
    expect(buildSortingRules({ order: SortingOrder.Descending, cases: [] }, () => undefined, String)).toBe('0 DESC')
  })

  it('rejects untranslatable conditions', () => {
    expect(() =>
      buildSortingRules({ order: SortingOrder.Ascending, cases: [{ query: 1, index: 1 }] }, () => undefined, String)
    ).toThrow('Unsupported sorting rule query')
  })
})

describe('SQL adapter priority sorting', () => {
  it.each([SortingOrder.Ascending, SortingOrder.Descending])('orders before LIMIT in direction %s', async (order) => {
    const hierarchy = new Hierarchy()
    jest.spyOn(hierarchy, 'getDomain').mockReturnValue('task' as Domain)
    jest.spyOn(hierarchy, 'findAttribute').mockReturnValue(undefined)
    jest.spyOn(hierarchy, 'isMixin').mockReturnValue(false)
    const execute = jest.fn(async (_sql: string, _params: unknown[]) => Object.assign([], { count: 0 }))
    const adapter: PostgresAdapter = Object.assign(Object.create(PostgresAdapter.prototype), {
      hierarchy,
      workspaceId: 'workspace',
      mgrId: 'test',
      mgr: {
        retry: async (
          _ctx: unknown,
          _id: unknown,
          operation: (connection: { execute: typeof execute }) => Promise<unknown>
        ) => await operation({ execute })
      }
    })
    const options = {
      sort: { priority: { order, cases: [1, 2, 3, 4, 0].map((query, index) => ({ query, index: index + 1 })) } },
      limit: 2
    }

    const ctx = new MeasureMetricsContext('', {}) as MeasureContext<SessionData>
    await adapter.findAll(ctx, core.class.Doc, {}, { ...options, skipClass: true })
    await adapter.rawFindAll('task' as Domain, {}, options)

    expect(execute).toHaveBeenCalledTimes(2)
    for (const [sql, params] of execute.mock.calls) {
      expect(sql).toContain('ORDER BY CASE WHEN')
      expect(sql).toContain(`END ${order === SortingOrder.Ascending ? 'ASC' : 'DESC'} LIMIT 2`)
      expect(params).toEqual(['workspace', '1', 1, '2', 2, '3', 3, '4', 4, '0', 5])
      expect(sql).toContain('THEN $3::numeric')
    }
  })
})
