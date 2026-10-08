//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { isViewDirty } from '../savedViews'
import {
  categoriesWithDocs,
  emptyCategoryLast,
  groupByFromRows,
  groupByRows,
  isEmptyCategory,
  NO_GROUPING,
  selectGroupLevel
} from '../nestedGroups'

describe('group-by rows', () => {
  it('offers a row for the next level while the layout allows one', () => {
    expect(groupByRows([NO_GROUPING], 3)).toEqual([NO_GROUPING])
    expect(groupByRows(['status'], 3)).toEqual(['status', NO_GROUPING])
    expect(groupByRows(['status', 'assignee'], 3)).toEqual(['status', 'assignee', NO_GROUPING])
    expect(groupByRows(['status', 'assignee', 'priority'], 3)).toEqual(['status', 'assignee', 'priority'])
    expect(groupByRows(['status'], 1)).toEqual(['status'])
    expect(groupByRows(['status'])).toEqual(['status', NO_GROUPING])
    expect(groupByRows([], 3)).toEqual([NO_GROUPING])
  })

  it('stops at a layout of two levels', () => {
    expect(groupByRows(['status'], 2)).toEqual(['status', NO_GROUPING])
    expect(groupByRows(['status', 'assignee'], 2)).toEqual(['status', 'assignee'])
  })
})

describe('selecting a level', () => {
  it('adds a level and offers the next one up to the depth', () => {
    let rows = groupByRows(['status'], 3)
    rows = selectGroupLevel(rows, 1, 'assignee', 3)
    expect(rows).toEqual(['status', 'assignee', NO_GROUPING])
    expect(groupByFromRows(rows)).toEqual(['status', 'assignee'])
    rows = selectGroupLevel(rows, 2, 'priority', 3)
    // the third level is the last: no fourth row
    expect(rows).toEqual(['status', 'assignee', 'priority'])
    expect(groupByFromRows(rows)).toEqual(['status', 'assignee', 'priority'])
  })

  it('never goes beyond the depth when levels are changed in a popup that stays open', () => {
    let rows = groupByRows(['a'], 3)
    for (const [index, key] of [[1, 'b'], [2, 'c'], [2, 'd'], [1, 'e']] as Array<[number, string]>) {
      rows = selectGroupLevel(rows, index, key, 3)
      expect(groupByFromRows(rows).length).toBeLessThanOrEqual(3)
      expect(rows.length).toBeLessThanOrEqual(3)
    }
  })

  it('ends the levels at "No grouping"', () => {
    const rows = selectGroupLevel(['status', 'assignee', 'priority'], 1, NO_GROUPING, 3)
    expect(rows).toEqual(['status', NO_GROUPING])
    expect(groupByFromRows(rows)).toEqual(['status'])
    expect(groupByFromRows(selectGroupLevel(['status', NO_GROUPING], 0, NO_GROUPING, 3))).toEqual([NO_GROUPING])
  })

  it('keeps the levels below a changed one and drops a repeated key', () => {
    expect(selectGroupLevel(['a', 'b', 'c'], 0, 'x', 3)).toEqual(['x', 'b', 'c'])
    expect(selectGroupLevel(['a', 'b', 'c'], 0, 'c', 3)).toEqual(['c', 'b', NO_GROUPING])
    expect(selectGroupLevel(['a', 'b', NO_GROUPING], 1, 'z', 3)).toEqual(['a', 'z', NO_GROUPING])
  })

  it('works for a layout of one level like it always did', () => {
    expect(selectGroupLevel(['status'], 0, 'assignee', 1)).toEqual(['assignee'])
    expect(selectGroupLevel(['status'], 0, NO_GROUPING, 1)).toEqual([NO_GROUPING])
  })

  it('has no limit without a depth', () => {
    expect(selectGroupLevel(['a', 'b', 'c', 'd'], 3, 'e')).toEqual(['a', 'b', 'c', 'e', NO_GROUPING])
  })
})

describe('group-by and the unsaved changes of a view', () => {
  const saved = (groupBy: string[]): any => ({ viewOptions: { groupBy, orderBy: ['modifiedOn', -1] } })

  it('a stored single group-by stays clean when it is set again', () => {
    const rows = groupByRows(['status'], 3)
    // the controls offer "No grouping" for the next level; choosing nothing leaves the view options as they were
    expect(groupByFromRows(rows)).toEqual(['status'])
    expect(isViewDirty(saved(['status']), saved(groupByFromRows(rows)))).toBe(false)
  })

  it('adding and removing a level changes the view and changing it back cleans it', () => {
    const baseline = saved(['status'])
    const nested = saved(groupByFromRows(selectGroupLevel(['status', NO_GROUPING], 1, 'assignee', 3)))
    expect(isViewDirty(baseline, nested)).toBe(true)
    const back = saved(groupByFromRows(selectGroupLevel(['status', 'assignee', NO_GROUPING], 1, NO_GROUPING, 3)))
    expect(isViewDirty(baseline, back)).toBe(false)
  })

  it('the order of the levels is a change', () => {
    expect(isViewDirty(saved(['status', 'assignee']), saved(['assignee', 'status']))).toBe(true)
  })
})

describe('the group without a value', () => {
  it('is recognised in every form a list uses', () => {
    expect(isEmptyCategory(undefined)).toBe(true)
    expect(isEmptyCategory(null)).toBe(true)
    expect(isEmptyCategory({ name: undefined, values: [] })).toBe(true)
    expect(isEmptyCategory({ name: 'x', values: [] })).toBe(false)
    expect(isEmptyCategory('a')).toBe(false)
    expect(isEmptyCategory(0)).toBe(false)
  })

  it('goes last and the other groups keep their order', () => {
    expect(emptyCategoryLast([undefined, 'a', 'b'])).toEqual(['a', 'b', undefined])
    expect(emptyCategoryLast(['a', undefined, 'b'])).toEqual(['a', 'b', undefined])
    const none = { name: undefined, values: [] }
    const x = { name: 'x', values: [] }
    expect(emptyCategoryLast([none, x])).toEqual([x, none])
  })

  it('returns the same array when nothing has to move', () => {
    const list = ['a', 'b', undefined]
    expect(emptyCategoryLast(list)).toBe(list)
    const noEmpty = ['a', 'b']
    expect(emptyCategoryLast(noEmpty)).toBe(noEmpty)
  })
})

describe('groups below the first level', () => {
  it('keeps the groups that hold documents', () => {
    const counts: Record<string, number> = { a: 2, b: 0, undefined: 1 }
    expect(categoriesWithDocs(['a', 'b', undefined], (c) => counts[String(c)])).toEqual(['a', undefined])
  })
})
