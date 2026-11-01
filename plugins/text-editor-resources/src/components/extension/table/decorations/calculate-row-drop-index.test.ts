// SPDX-License-Identifier: EPL-2.0

import { calculateRowDropIndex } from './calculate-row-drop-index'

describe('calculateRowDropIndex', () => {
  const equalRows = [
    { topPx: 0, heightPx: 40 },
    { topPx: 40, heightPx: 40 },
    { topPx: 80, heightPx: 40 }
  ]
  const unequalRows = [
    { topPx: 0, heightPx: 20 },
    { topPx: 20, heightPx: 100 },
    { topPx: 120, heightPx: 40 }
  ]

  it.each([
    ['equal', equalRows],
    ['unequal', unequalRows]
  ])('keeps each %s-height row in place without movement', (_name, rows) => {
    rows.forEach((row, index) => {
      expect(calculateRowDropIndex(index, rows, row.topPx)).toBe(index)
    })
  })

  it.each([
    ['downward', 0, 39, 0],
    ['downward', 0, 40, 1],
    ['downward', 0, 41, 1],
    ['upward', 2, 39, 1],
    ['upward', 2, 40, 2],
    ['upward', 2, 41, 2]
  ])('handles %s movement of equal-height row %i at top %i', (_direction, row, top, expected) => {
    expect(calculateRowDropIndex(row, equalRows, top)).toBe(expected)
  })

  it.each([
    ['downward', 0, 59, 0],
    ['downward', 0, 60, 1],
    ['downward', 0, 61, 1],
    ['upward', 2, 49, 1],
    ['upward', 2, 50, 2],
    ['upward', 2, 51, 2],
    ['upward', 1, -41, 0],
    ['upward', 1, -40, 1],
    ['upward', 1, -39, 1],
    ['downward', 1, 89, 1],
    ['downward', 1, 90, 2],
    ['downward', 1, 91, 2]
  ])('handles %s movement of unequal-height row %i at top %i', (_direction, row, top, expected) => {
    expect(calculateRowDropIndex(row, unequalRows, top)).toBe(expected)
  })

  it.each([
    [0, -100, 0],
    [2, -100, 0],
    [0, 200, 2],
    [2, 200, 2]
  ])('handles table boundaries for row %i at top %i', (row, top, expected) => {
    expect(calculateRowDropIndex(row, unequalRows, top)).toBe(expected)
  })

  it.each([-100, 0, 100])('keeps a single row in place at top %i', (top) => {
    expect(calculateRowDropIndex(0, [{ topPx: 0, heightPx: 40 }], top)).toBe(0)
  })
})
