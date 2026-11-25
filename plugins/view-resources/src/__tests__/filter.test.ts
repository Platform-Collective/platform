// SPDX-License-Identifier: EPL-2.0

import type { Doc, Ref } from '@hcengineering/core'
import { createQuery, getClient } from '@hcengineering/presentation'
import type { Filter } from '@hcengineering/view'
import { get } from 'svelte/store'
import { FilterQuery, filterStore, nestedMatchResult, setFilters, updateFilter } from '../filter'

jest.mock('@hcengineering/presentation', () => ({ createQuery: jest.fn(), getClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))
jest.mock('@hcengineering/ui', () => ({}))

function mockFilter (index: number): Filter {
  return {
    key: {
      _class: 'test:class:Doc' as Filter['key']['_class'],
      key: 'value',
      attribute: undefined as unknown as Filter['key']['attribute'],
      label: 'test:string:Value' as Filter['key']['label'],
      component: 'test:component:Filter' as Filter['key']['component']
    },
    mode: 'test:filter:Mode' as Filter['mode'],
    modes: [],
    value: [],
    index
  }
}

describe('filter indexes', () => {
  afterEach(() => {
    setFilters([])
  })

  it('assigns unique indexes to duplicate saved filters', () => {
    setFilters([mockFilter(2), mockFilter(1), mockFilter(2), mockFilter(1)])

    expect(get(filterStore).map((filter) => filter.index)).toEqual([2, 1, 3, 4])
  })

  it('keeps reindexed filters independently addressable', () => {
    setFilters([mockFilter(1), mockFilter(1)])
    const replacement = { ...mockFilter(2), value: ['test:doc:Replacement' as Ref<Doc>] }

    updateFilter(replacement)

    expect(get(filterStore)).toEqual([mockFilter(1), replacement])
  })

  it('does not recreate a query when a removed filter resolves late', async () => {
    const filter = { ...mockFilter(1), nested: mockFilter(1) }
    setFilters([filter])
    setFilters([])
    jest.mocked(createQuery).mockClear()

    await expect(nestedMatchResult(filter, jest.fn())).resolves.toEqual({ $in: [] })
    expect(createQuery).not.toHaveBeenCalled()
    expect(getClient).not.toHaveBeenCalled()
  })

  it('disposes the previous generation when saved filters replace it', () => {
    setFilters([mockFilter(1)])
    const unsubscribe = jest.fn()
    const query = { unsubscribe } as unknown as ReturnType<typeof createQuery>
    jest.mocked(createQuery).mockReturnValue(query)
    FilterQuery.getLiveQuery(1)
    FilterQuery.results.set(1, ['test:doc:Stale' as Ref<Doc>])

    setFilters([mockFilter(1)])

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(FilterQuery.queries.size).toBe(0)
    expect(FilterQuery.results.size).toBe(0)
    expect(FilterQuery.scopedResults.size).toBe(0)
  })
})
