//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { categoryKey, groupByCustomField } from '../columns'
import { buildBoardGrid, cellLanes, gridOrder, toggleLane } from '../swimlanes'

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

describe('sub-lanes', () => {
  const nested = {
    ...input,
    columns: [undefined, 'todo', 'doing', 'done'],
    // the sub-lane field is "kind", kept in customFields like the others
    subLanes: ['bug', 'task', undefined],
    bucketSubLanes: (list: readonly Item[]) => groupByCustomField(list, 'kind')
  }
  const withKinds = [
    item('1', { stage: 'todo', team: 'a', kind: 'bug' }),
    item('2', { stage: 'doing', team: 'a', kind: 'task' }),
    item('3', { stage: 'todo', team: 'b', kind: 'task' }),
    item('4', { team: 'b' }),
    item('5', { stage: 'done', team: 'a', kind: 'bug' })
  ]
  const grid = buildBoardGrid({ ...nested, items: withKinds })

  it('nests a lane per sub-lane value inside every swimlane, without empty sub-lanes', () => {
    expect(grid.lanes.map((l) => l.key)).toEqual(['a', 'b'])
    const a = grid.lanes[0]
    expect(a.subLanes.map((l) => l.category)).toEqual(['bug', 'task'])
    expect(a.subLanes.map((l) => l.depth)).toEqual([1, 1])
    expect(a.subLanes.map((l) => l.path)).toEqual([['a', 'bug'], ['a', 'task']])
    const b = grid.lanes[1]
    // "No kind" is last and only listed where there are items without a kind
    expect(b.subLanes.map((l) => l.category)).toEqual(['task', undefined])
  })

  it('gives every sub-lane a key that is unique over the board', () => {
    const keys = [...grid.lanes.map((l) => l.key), ...grid.lanes.flatMap((l) => l.subLanes.map((s) => s.key))]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('holds the cells in the sub-lanes and every item in exactly one cell', () => {
    const a = grid.lanes[0]
    expect(a.cells).toEqual([])
    expect(cellLanes(grid).every((l) => l.cells.length === 4)).toBe(true)
    const seen = cellLanes(grid).flatMap((l) => l.cells.flatMap((c) => ids(c.items)))
    expect(seen.sort()).toEqual(['1', '2', '3', '4', '5'])
    expect(ids(a.items)).toEqual(['1', '2', '5'])
    expect(a.subLanes[0].cells.map((c) => ids(c.items))).toEqual([[], ['1'], [], ['5']])
  })

  it('counts the items of a swimlane over its sub-lanes in the visible columns', () => {
    const visible = buildBoardGrid({ ...nested, items: withKinds, columns: [undefined, 'todo', 'doing'] })
    expect(visible.lanes.map((l) => l.count)).toEqual([2, 2])
    expect(visible.lanes[0].subLanes.map((l) => l.count)).toEqual([1, 1])
    expect(visible.lanes[0].items).toHaveLength(3)
  })

  it('keeps the column totals over all swimlanes and sub-lanes', () => {
    expect(grid.columnTotals.get('todo')).toBe(2)
    expect(grid.columnTotals.get('done')).toBe(1)
  })

  it('shows empty swimlanes with "show empty groups" but never empty sub-lanes', () => {
    const shown = buildBoardGrid({ ...nested, items: withKinds, lanes: ['a', 'empty', 'b'], showEmptyLanes: true })
    expect(shown.lanes.map((l) => l.key)).toEqual(['a', 'empty', 'b'])
    expect(shown.lanes[1].subLanes).toEqual([])
    // an empty swimlane draws its own (empty) cells, like a board without sub-lanes
    expect(shown.lanes[1].cells).toHaveLength(4)
  })

  it('is the plain grid without sub-lanes', () => {
    const plain = buildBoardGrid({ ...input, items: withKinds })
    expect(plain.lanes.every((l) => l.subLanes.length === 0 && l.depth === 0)).toBe(true)
    expect(plain.lanes[0].path).toEqual(['a'])
    expect(cellLanes(plain)).toEqual(plain.lanes)
  })

  it('moves the keyboard lane by lane, sub-lane by sub-lane, and skips collapsed ones', () => {
    expect(ids(gridOrder(grid, new Set()))).toEqual(['1', '5', '2', '3', '4'])
    // collapse the swimlane "a"
    expect(ids(gridOrder(grid, new Set(['a'])))).toEqual(['3', '4'])
    // collapse one sub-lane of "a"
    expect(ids(gridOrder(grid, new Set([grid.lanes[0].subLanes[0].key])))).toEqual(['2', '3', '4'])
  })

  it('groups 50k items on two levels quickly', () => {
    const teams = ['a', 'b', 'c', 'd']
    const kinds = ['bug', 'task', 'epic']
    const stages = ['todo', 'doing', 'done']
    const big: Item[] = []
    for (let n = 0; n < 50000; n++) {
      big.push(item(String(n), { team: teams[n % 4], kind: kinds[n % 3], stage: stages[n % 3 === 0 ? 0 : n % 5 % 3] }))
    }
    const started = Date.now()
    const result = buildBoardGrid({
      items: big,
      lanes: teams,
      columns: stages,
      bucketLanes: (list) => groupByCustomField(list, 'team'),
      bucketColumns: (list) => groupByCustomField(list, 'stage'),
      showEmptyLanes: false,
      subLanes: kinds,
      bucketSubLanes: (list) => groupByCustomField(list, 'kind')
    })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(cellLanes(result).reduce((n, l) => n + l.count, 0)).toBe(50000)
  })
})
