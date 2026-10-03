//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ChartData } from '../aggregate'
import { categoryLabelWidth, computeGeometry, formatTick, niceScale, truncateLabel, valueRange } from '../layout'

function data (values: Array<Array<number | null>>, none: number[] = []): ChartData {
  const n = values[0]?.length ?? 0
  return {
    categories: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: `C${i}`, none: none.includes(i) })),
    series: values.map((_, i) => ({ id: `s${i}`, label: `S${i}`, none: false })),
    values,
    counts: values.map((row) => row.map((v) => v ?? 0)),
    items: 0
  }
}

const size = { width: 400, height: 300 }
const margins = { top: 10, right: 10, bottom: 40, left: 50 } // plot 340 x 250

describe('niceScale', () => {
  it('rounds the bounds and the step', () => {
    expect(niceScale(0, 7)).toMatchObject({ min: 0, max: 8, step: 2, ticks: [0, 2, 4, 6, 8] })
    expect(niceScale(0, 100)).toMatchObject({ max: 100, step: 20 })
    const small = niceScale(0, 0.3)
    expect(small.step).toBeCloseTo(0.1)
    expect(small.ticks[0]).toBe(0)
    expect(small.ticks[1]).toBe(0.1)
    expect(small.max).toBeGreaterThanOrEqual(0.3)
  })

  it('always contains 0 and covers negative values', () => {
    expect(niceScale(5, 9).min).toBe(0)
    const res = niceScale(-30, 10)
    expect(res.min).toBeLessThanOrEqual(-30)
    expect(res.ticks).toContain(0)
  })

  it('turns an empty range into 0..1', () => {
    expect(niceScale(0, 0)).toMatchObject({ min: 0, max: 1 })
    expect(niceScale(Number.NaN, Number.NaN).max).toBe(1)
  })
})

describe('labels', () => {
  it('truncates with an ellipsis and counts characters, not code units', () => {
    expect(truncateLabel('Backend', 10)).toBe('Backend')
    expect(truncateLabel('Backend team', 6)).toBe('Backe…')
    expect(truncateLabel('ab', 1)).toBe('…')
    expect(truncateLabel('ab', 0)).toBe('')
    expect(truncateLabel('😀😀😀', 2)).toBe('😀…')
  })

  it('sizes the margin for the longest label within bounds', () => {
    expect(categoryLabelWidth(['a'])).toBe(40)
    expect(categoryLabelWidth(['x'.repeat(100)])).toBe(180)
    expect(categoryLabelWidth(['x'.repeat(10)])).toBe(Math.ceil(10 * 6.5) + 12)
    expect(formatTick(1.5)).toBe('1.5')
  })
})

describe('valueRange', () => {
  it('uses the largest value for clustered layouts and the largest total for stacked ones', () => {
    const d = data([
      [2, 3],
      [4, 1]
    ])
    expect(valueRange(d, 'column')).toEqual({ min: 0, max: 4 })
    expect(valueRange(d, 'stackedColumn')).toEqual({ min: 0, max: 6 })
    expect(valueRange(d, 'stackedArea')).toEqual({ min: 0, max: 6 })
  })

  it('stacks negative values downwards and ignores gaps', () => {
    const d = data([
      [2, null],
      [-3, -1]
    ])
    expect(valueRange(d, 'stackedColumn')).toEqual({ min: -3, max: 2 })
    expect(valueRange(d, 'line')).toEqual({ min: -3, max: 2 })
  })
})

describe('computeGeometry: columns', () => {
  it('draws columns whose height is proportional to the value, from the baseline up', () => {
    const geometry = computeGeometry(data([[2, 4]]), 'column', size, margins)
    expect(geometry.horizontal).toBe(false)
    expect(geometry.plot).toEqual({ x: 50, y: 10, width: 340, height: 250 })
    // The axis is 0..4 (step 1), the baseline is the bottom of the plot
    expect(geometry.baseline).toBeCloseTo(260)
    expect(geometry.bars).toHaveLength(2)
    const [a, b] = geometry.bars
    expect(b.height).toBeCloseTo(250)
    expect(a.height).toBeCloseTo(125)
    expect(a.y + a.height).toBeCloseTo(260)
    // Two bands of 170, a bar is 70% of its band and centred in it
    expect(a.width).toBeCloseTo(119)
    expect(a.x + a.width / 2).toBeCloseTo(50 + 85)
    expect(b.x + b.width / 2).toBeCloseTo(50 + 255)
  })

  it('puts the series side by side when they are not stacked', () => {
    const geometry = computeGeometry(
      data([
        [1, 1],
        [2, 2]
      ]),
      'column',
      size,
      margins
    )
    const first = geometry.bars.filter((b) => b.category === 0)
    expect(first).toHaveLength(2)
    expect(first[0].width).toBeCloseTo(first[1].width)
    expect(first[1].x).toBeCloseTo(first[0].x + first[0].width)
    expect(first[0].width).toBeCloseTo(119 / 2)
  })

  it('stacks the series on top of each other', () => {
    const geometry = computeGeometry(
      data([
        [1, 1],
        [3, 1]
      ]),
      'stackedColumn',
      size,
      margins
    )
    const first = geometry.bars.filter((b) => b.category === 0)
    // 0..4 axis: 1 and 3 stacked reach the top
    expect(first[0].y).toBeCloseTo(260 - 62.5)
    expect(first[1].y).toBeCloseTo(10)
    expect(first[1].y + first[1].height).toBeCloseTo(first[0].y)
    expect(first[0].x).toBeCloseTo(first[1].x)
  })

  it('stacks negative values below the baseline', () => {
    const geometry = computeGeometry(
      data([
        [2, 0],
        [-2, 0]
      ]),
      'stackedColumn',
      size,
      margins
    )
    const [up, down] = geometry.bars
    expect(up.y + up.height).toBeCloseTo(geometry.baseline)
    expect(down.y).toBeCloseTo(geometry.baseline)
  })

  it('draws no bar for a gap or a zero', () => {
    const geometry = computeGeometry(data([[0, null, 3]]), 'column', size, margins)
    expect(geometry.bars.map((b) => b.category)).toEqual([2])
  })

  it('shows every n-th category label when they would not fit', () => {
    const many = data([Array.from({ length: 40 }, (_, i) => i)])
    const ticks = computeGeometry(many, 'column', size, margins).categoryTicks
    const visible = ticks.filter((t) => t.visible)
    expect(visible.length).toBeLessThan(ticks.length)
    expect(visible[0].index).toBe(0)
    const few = computeGeometry(data([[1, 2, 3]]), 'column', size, margins).categoryTicks
    expect(few.every((t) => t.visible)).toBe(true)
  })
})

describe('computeGeometry: bars', () => {
  it('draws horizontal bars with the categories running down', () => {
    const geometry = computeGeometry(data([[2, 4]]), 'bar', size, margins)
    expect(geometry.horizontal).toBe(true)
    expect(geometry.baseline).toBeCloseTo(50)
    const [a, b] = geometry.bars
    expect(b.width).toBeCloseTo(340)
    expect(a.width).toBeCloseTo(170)
    expect(a.x).toBeCloseTo(50)
    // The first category is at the top
    expect(a.y).toBeLessThan(b.y)
    expect(geometry.categoryTicks[0].center).toBeCloseTo(10 + 62.5)
  })

  it('stacks horizontal bars from left to right', () => {
    const geometry = computeGeometry(
      data([
        [1, 0],
        [1, 0]
      ]),
      'stackedBar',
      size,
      margins
    )
    const [a, b] = geometry.bars
    expect(b.x).toBeCloseTo(a.x + a.width)
  })
})

describe('computeGeometry: lines and areas', () => {
  it('joins the points of a series in one path and breaks it at a gap', () => {
    const geometry = computeGeometry(data([[1, 2, null, 3, 4]]), 'line', size, margins)
    const [line] = geometry.lines
    expect(line.points).toHaveLength(4)
    expect(line.segments).toHaveLength(2)
    expect(line.segments[0].startsWith('M')).toBe(true)
    // The points are at the centres of the bands
    expect(line.points[0].x).toBeCloseTo(50 + 34)
  })

  it('does not join the "No <field>" point to the line', () => {
    const geometry = computeGeometry(data([[1, 2, 3]], [2]), 'line', size, margins)
    const [line] = geometry.lines
    expect(line.points).toHaveLength(3)
    expect(line.segments).toHaveLength(1)
  })

  it('has a marker but no path for a single point', () => {
    const geometry = computeGeometry(data([[3]]), 'line', size, margins)
    expect(geometry.lines[0].points).toHaveLength(1)
    expect(geometry.lines[0].segments).toEqual([])
  })

  it('stacks the areas and closes every path', () => {
    const geometry = computeGeometry(
      data([
        [1, 2],
        [1, 1]
      ]),
      'stackedArea',
      size,
      margins
    )
    expect(geometry.areas).toHaveLength(2)
    for (const area of geometry.areas) {
      expect(area.paths).toHaveLength(1)
      expect(area.paths[0].endsWith('Z')).toBe(true)
    }
    // The axis covers the stacked total 3
    expect(geometry.valueTicks[geometry.valueTicks.length - 1].value).toBeGreaterThanOrEqual(3)
  })

  it('treats a gap as 0 when stacking and draws a lone date as a narrow column', () => {
    const one = computeGeometry(data([[2]]), 'stackedArea', size, margins)
    expect(one.areas[0].paths).toHaveLength(1)
    const withGap = computeGeometry(
      data([
        [1, null],
        [1, 1]
      ]),
      'stackedArea',
      size,
      margins
    )
    expect(withGap.areas[1].paths).toHaveLength(1)
  })

  it('stands the items without a date as a stacked bar next to the area', () => {
    const geometry = computeGeometry(data([[1, 2, 5]], [2]), 'stackedArea', size, margins)
    expect(geometry.bars).toHaveLength(1)
    expect(geometry.bars[0].category).toBe(2)
    expect(geometry.areas[0].paths).toHaveLength(1)
  })
})

describe('computeGeometry: no data', () => {
  it('has an axis and no marks', () => {
    const empty: ChartData = { categories: [], series: [], values: [], counts: [], items: 0 }
    for (const layout of ['bar', 'column', 'stackedArea', 'line'] as const) {
      const geometry = computeGeometry(empty, layout, size, margins)
      expect(geometry.bars).toEqual([])
      expect(geometry.lines).toEqual([])
      expect(geometry.areas).toEqual([])
      expect(geometry.valueTicks.length).toBeGreaterThan(1)
    }
  })

  it('survives a box smaller than its margins', () => {
    const geometry = computeGeometry(data([[1]]), 'column', { width: 20, height: 20 }, margins)
    expect(geometry.plot.width).toBe(1)
    expect(geometry.plot.height).toBe(1)
  })
})
