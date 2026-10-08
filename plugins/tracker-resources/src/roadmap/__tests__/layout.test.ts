//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  buildRows,
  estimateTextWidth,
  GROUP_ROW_HEIGHT,
  itemShape,
  MARKER_SIZE,
  MIN_BAR_WIDTH,
  placeLabel,
  ROW_HEIGHT,
  UNSCHEDULED_ID,
  visibleRowRange
} from '../layout'
import { createScale } from '../timeScale'

const scale = createScale('month', 100, 500) // 8 px per day

describe('itemShape', () => {
  it('draws a range from the start of its first day to the end of its last day', () => {
    const shape = itemShape({ kind: 'range', start: 110, target: 112, inverted: false }, scale)
    expect(shape).toEqual({ kind: 'bar', x: 80, width: 24, center: 92 })
  })

  it('draws a one day item one day wide', () => {
    const shape = itemShape({ kind: 'range', start: 110, target: 110, inverted: false }, scale)
    expect(shape?.width).toBe(8)
  })

  it('keeps a bar grabbable at the year zoom', () => {
    const year = createScale('year', 0, 1000)
    const shape = itemShape({ kind: 'range', start: 10, target: 10, inverted: false }, year)
    expect(shape?.width).toBe(MIN_BAR_WIDTH)
  })

  it('draws a marker in the middle of its day', () => {
    const shape = itemShape({ kind: 'marker', day: 110, role: 'target' }, scale)
    expect(shape).toEqual({ kind: 'marker', x: 84 - MARKER_SIZE / 2, width: MARKER_SIZE, center: 84 })
  })

  it('has no shape without dates', () => {
    expect(itemShape({ kind: 'unscheduled' }, scale)).toBeUndefined()
  })
})

describe('placeLabel', () => {
  const bar = { kind: 'bar', x: 100, width: 200, center: 200 } as const

  it('puts the text inside a bar that is wide enough', () => {
    expect(placeLabel(bar, 150, 1000)).toBe('inside')
  })

  it('puts it to the right of a narrow bar, to the left when there is no room on the right', () => {
    expect(placeLabel(bar, 300, 1000)).toBe('right')
    expect(placeLabel({ kind: 'bar', x: 400, width: 200, center: 500 }, 300, 650)).toBe('left')
  })

  it('does not put text inside a marker', () => {
    expect(placeLabel({ kind: 'marker', x: 10, width: 12, center: 16 }, 1, 1000)).toBe('right')
  })

  it('falls back to the right when there is room nowhere', () => {
    expect(placeLabel({ kind: 'bar', x: 10, width: 10, center: 15 }, 500, 100)).toBe('right')
  })

  it('estimates the width of a text', () => {
    expect(estimateTextWidth('abcd', 5)).toBe(20)
  })
})

describe('buildRows', () => {
  const idOf = (it: { id: string }): string => it.id
  const item = (id: string): { id: string } => ({ id })

  it('lists the items one under the other without group headers', () => {
    const layout = buildRows({
      groups: [{ id: 'g', items: [item('a'), item('b')] }],
      unscheduled: [],
      idOf,
      collapsed: new Set(),
      showGroupHeaders: false
    })
    expect(layout.rows.map((r) => [r.type, r.y])).toEqual([
      ['item', 0],
      ['item', ROW_HEIGHT]
    ])
    expect(layout.height).toBe(2 * ROW_HEIGHT)
  })

  it('adds a header per group and hides the items of a collapsed group', () => {
    const layout = buildRows({
      groups: [
        { id: 'g1', items: [item('a'), item('b')] },
        { id: 'g2', items: [item('c')] }
      ],
      unscheduled: [],
      idOf,
      collapsed: new Set(['g1']),
      showGroupHeaders: true
    })
    expect(layout.rows.map((r) => (r.type === 'group' ? `group:${r.id}:${r.count}:${r.collapsed}` : r.id))).toEqual([
      'group:g1:2:true',
      'group:g2:1:false',
      'c'
    ])
    expect(layout.height).toBe(2 * GROUP_ROW_HEIGHT + ROW_HEIGHT)
  })

  it('lists items without dates in their own section at the end', () => {
    const layout = buildRows({
      groups: [{ id: 'g', items: [item('a')] }],
      unscheduled: [item('x'), item('y')],
      idOf,
      collapsed: new Set(),
      showGroupHeaders: false
    })
    expect(layout.rows.map((r) => r.type)).toEqual(['item', 'unscheduled', 'item', 'item'])
    const unscheduled = layout.rows.filter((r) => r.type === 'item' && r.unscheduled)
    expect(unscheduled).toHaveLength(2)
    expect(layout.rows[1]).toMatchObject({ id: UNSCHEDULED_ID, count: 2, collapsed: false })
  })

  it('collapses the unscheduled section', () => {
    const layout = buildRows({
      groups: [],
      unscheduled: [item('x')],
      idOf,
      collapsed: new Set([UNSCHEDULED_ID]),
      showGroupHeaders: false
    })
    expect(layout.rows.map((r) => r.type)).toEqual(['unscheduled'])
    expect(layout.height).toBe(GROUP_ROW_HEIGHT)
  })

  it('has no rows and no height when there is nothing', () => {
    expect(buildRows({ groups: [], unscheduled: [], idOf, collapsed: new Set(), showGroupHeaders: true })).toEqual({
      rows: [],
      height: 0
    })
  })

  it('shows an empty group header only when asked for groups', () => {
    const layout = buildRows({
      groups: [{ id: 'g', items: [] }],
      unscheduled: [],
      idOf,
      collapsed: new Set(),
      showGroupHeaders: true
    })
    expect(layout.rows.map((r) => r.type)).toEqual(['group'])
  })
})

describe('buildRows with nested groups', () => {
  const idOf = (it: { id: string }): string => it.id
  const item = (id: string): { id: string } => ({ id })
  const a = item('a')
  const b = item('b')
  const c = item('c')
  const groups = [
    {
      id: 'g1',
      items: [a, b, c],
      children: [
        { id: 'g1/x', items: [a, b] },
        { id: 'g1/y', items: [c] }
      ]
    },
    { id: 'g2', items: [], children: [] }
  ]
  const layoutOf = (collapsed: string[]): ReturnType<typeof buildRows<{ id: string }>> =>
    buildRows({ groups, unscheduled: [], idOf, collapsed: new Set(collapsed), showGroupHeaders: true })
  const describeRows = (rows: ReturnType<typeof layoutOf>['rows']): string[] =>
    rows.map((r) => (r.type === 'group' ? `${r.id}@${r.depth}:${r.count}` : r.id))

  it('draws the headers of the sub groups under their group and the items under the last level', () => {
    expect(describeRows(layoutOf([]).rows)).toEqual(['g1@0:3', 'g1/x@1:2', 'a', 'b', 'g1/y@1:1', 'c', 'g2@0:0'])
  })

  it('hides everything below a collapsed group', () => {
    expect(describeRows(layoutOf(['g1']).rows)).toEqual(['g1@0:3', 'g2@0:0'])
  })

  it('collapses a sub group without touching its siblings', () => {
    expect(describeRows(layoutOf(['g1/x']).rows)).toEqual(['g1@0:3', 'g1/x@1:2', 'g1/y@1:1', 'c', 'g2@0:0'])
  })

  it('stacks the rows without gaps', () => {
    const layout = layoutOf([])
    expect(layout.rows.map((r) => r.y)).toEqual([
      0,
      GROUP_ROW_HEIGHT,
      2 * GROUP_ROW_HEIGHT,
      2 * GROUP_ROW_HEIGHT + ROW_HEIGHT,
      2 * GROUP_ROW_HEIGHT + 2 * ROW_HEIGHT,
      3 * GROUP_ROW_HEIGHT + 2 * ROW_HEIGHT,
      3 * GROUP_ROW_HEIGHT + 3 * ROW_HEIGHT
    ])
    expect(layout.height).toBe(4 * GROUP_ROW_HEIGHT + 3 * ROW_HEIGHT)
  })

  it('lists the items of the last level when there are no headers', () => {
    const layout = buildRows({ groups, unscheduled: [], idOf, collapsed: new Set(['g1']), showGroupHeaders: false })
    expect(layout.rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('visibleRowRange', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ y: i * 10, height: 10 }))

  it('returns the rows that intersect the viewport plus an overscan', () => {
    expect(visibleRowRange(rows, 0, 50, 0)).toEqual([0, 5])
    expect(visibleRowRange(rows, 200, 50, 0)).toEqual([20, 25])
    expect(visibleRowRange(rows, 200, 50, 2)).toEqual([18, 27])
  })

  it('includes a row that is only partly visible', () => {
    expect(visibleRowRange(rows, 205, 10, 0)).toEqual([20, 22])
  })

  it('stays inside the list', () => {
    expect(visibleRowRange(rows, 950, 500, 5)).toEqual([90, 100])
    expect(visibleRowRange(rows, -100, 50, 5)).toEqual([0, 5])
    expect(visibleRowRange([], 0, 100)).toEqual([0, 0])
  })

  it('returns an empty range far below the content', () => {
    const [from, to] = visibleRowRange(rows, 5000, 100, 0)
    expect(from).toBe(to)
  })
})
