//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { categoryKey, groupByCustomField } from '../columns'
import { buildBoardGrid, gridOrder, toggleLane } from '../swimlanes'

interface Item {
  id: string
  customFields?: Record<string, unknown>
}
const item = (id: string, customFields?: Record<string, unknown>): Item => ({ id, customFields })

const items = [
  item('1', { stage: 'todo', team: 'a' }),
  item('2', { stage: 'doing', team: 'a' }),
  item('3', { stage: 'todo', team: 'b' }),
  item('4', { team: 'b' }),
  item('5', { stage: 'done' })
]

const input = {
  items,
  lanes: ['a', 'b', undefined],
  columns: [undefined, 'todo', 'doing'],
  bucketLanes: (list: readonly Item[]) => groupByCustomField(list, 'team'),
  bucketColumns: (list: readonly Item[]) => groupByCustomField(list, 'stage'),
  showEmptyLanes: false
}

const ids = (list: Item[]): string[] => list.map((i) => i.id)

describe('buildBoardGrid', () => {
  it('lays the items out as swimlanes of columns', () => {
    const grid = buildBoardGrid(input)
    expect(grid.lanes.map((l) => l.key)).toEqual(['a', 'b', 'undefined'])
    const a = grid.lanes[0]
    expect(a.cells.map((c) => c.columnKey)).toEqual(['undefined', 'todo', 'doing'])
    expect(a.cells.map((c) => ids(c.items))).toEqual([[], ['1'], ['2']])
    const b = grid.lanes[1]
    expect(b.cells.map((c) => ids(c.items))).toEqual([['4'], ['3'], []])
    const none = grid.lanes[2]
    expect(none.cells.map((c) => ids(c.items))).toEqual([[], [], []])
    expect(ids(none.items)).toEqual(['5'])
  })

  it('counts the items of a swimlane in the visible columns only', () => {
    const grid = buildBoardGrid(input)
    expect(grid.lanes.map((l) => l.count)).toEqual([2, 2, 0])
    // Item 5 is in a hidden column ("done") of the No team swimlane
    expect(grid.lanes[2].items).toHaveLength(1)
  })

  it('counts the items of a column over all swimlanes', () => {
    const grid = buildBoardGrid(input)
    expect(grid.columnTotals.get('todo')).toBe(2)
    expect(grid.columnTotals.get('doing')).toBe(1)
    expect(grid.columnTotals.get('undefined')).toBe(1)
    expect(grid.columnTotals.get('done')).toBe(1)
    expect(grid.columnTotals.get('nope')).toBeUndefined()
  })

  it('puts every item in exactly one cell of the visible columns', () => {
    const all = { ...input, columns: [undefined, 'todo', 'doing', 'done'] }
    const grid = buildBoardGrid(all)
    const seen = grid.lanes.flatMap((l) => l.cells.flatMap((c) => ids(c.items)))
    expect(seen.sort()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('drops empty swimlanes unless asked to show them', () => {
    const lanes = ['a', 'empty', 'b']
    expect(buildBoardGrid({ ...input, lanes }).lanes.map((l) => l.key)).toEqual(['a', 'b'])
    const shown = buildBoardGrid({ ...input, lanes, showEmptyLanes: true })
    expect(shown.lanes.map((l) => l.key)).toEqual(['a', 'empty', 'b'])
    expect(shown.lanes[1].cells.map((c) => c.items.length)).toEqual([0, 0, 0])
  })

  it('works with category objects of built-in fields', () => {
    const status = { name: 'Todo', values: [{ _id: 's1', space: 'p' }] }
    const grid = buildBoardGrid({
      items: ['x', 'y'],
      lanes: [{ name: 'L', values: [] }],
      columns: [status],
      bucketLanes: (list) => ({ L: [...list] }),
      bucketColumns: (list) => ({ [categoryKey(status)]: list.filter((i) => i === 'y') }),
      showEmptyLanes: false
    })
    expect(grid.lanes[0].cells[0].items).toEqual(['y'])
    expect(grid.lanes[0].key).toBe('L')
  })

  it('has no swimlanes for no items', () => {
    const grid = buildBoardGrid({ ...input, items: [] })
    expect(grid.lanes).toEqual([])
    expect(grid.columnTotals.size).toBe(0)
  })
})

describe('toggleLane', () => {
  it('collapses and expands a swimlane without changing the set it was given', () => {
    const none = new Set<string>()
    const one = toggleLane(none, 'a')
    expect([...one]).toEqual(['a'])
    expect(none.size).toBe(0)
    expect([...toggleLane(one, 'b')].sort()).toEqual(['a', 'b'])
    expect(toggleLane(one, 'a').size).toBe(0)
  })
})

describe('gridOrder', () => {
  it('goes swimlane by swimlane, column by column', () => {
    const grid = buildBoardGrid({ ...input, columns: [undefined, 'todo', 'doing', 'done'] })
    expect(ids(gridOrder(grid, new Set()))).toEqual(['1', '2', '4', '3', '5'])
  })

  it('skips collapsed swimlanes', () => {
    const grid = buildBoardGrid(input)
    expect(ids(gridOrder(grid, new Set(['a'])))).toEqual(['4', '3'])
  })
})
