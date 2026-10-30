// SPDX-License-Identifier: EPL-2.0

import core, { type AnyAttribute, type Class, type Doc, Hierarchy, SortingOrder } from '@hcengineering/core'
import { type ClassSortFuncs } from '@hcengineering/view'
import { getListSorting } from '../components/list/sorting'

describe('list query sorting', () => {
  const rules = { cases: [1, 2, 3, 4, 0].map((query, index) => ({ query, index: index + 1 })) }
  let hierarchy: Hierarchy

  beforeEach(() => {
    hierarchy = new Hierarchy()
    jest
      .spyOn(hierarchy, 'findAttribute')
      .mockReturnValue({ type: { _class: core.class.TypeNumber } } as unknown as AnyAttribute)
    jest.spyOn(hierarchy, 'getClass').mockReturnValue({ _id: core.class.TypeNumber } as unknown as Class<Doc>)
    jest.spyOn(hierarchy, 'as').mockReturnValue({ sortingRules: rules } as unknown as ClassSortFuncs)
  })

  it.each([SortingOrder.Ascending, SortingOrder.Descending])('uses type rules with direction %s', (order) => {
    expect(getListSorting(hierarchy, core.class.Doc, ['priority', order])).toEqual({ priority: { ...rules, order } })
    expect(rules).not.toHaveProperty('order')
  })

  it('preserves ordinary sorting when the type has no query rules', () => {
    jest.spyOn(hierarchy, 'as').mockReturnValue({} as unknown as ClassSortFuncs)
    expect(getListSorting(hierarchy, core.class.Doc, ['modifiedOn', SortingOrder.Descending])).toEqual({
      modifiedOn: SortingOrder.Descending
    })
  })

  it('preserves sorting for keys without an attribute', () => {
    const getClass = jest.spyOn(hierarchy, 'getClass')
    jest.spyOn(hierarchy, 'findAttribute').mockReturnValue(undefined)
    expect(getListSorting(hierarchy, core.class.Doc, ['$lookup.status.rank', SortingOrder.Ascending])).toEqual({
      '$lookup.status.rank': SortingOrder.Ascending
    })
    expect(getClass).not.toHaveBeenCalled()
  })
})
