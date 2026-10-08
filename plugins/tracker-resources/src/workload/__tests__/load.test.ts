//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { loadProjection, readLoad } from '../load'

describe('readLoad', () => {
  const issue = { estimation: 12, remainingTime: 5, customFields: { points: 3, text: 'x', bad: Number.NaN, neg: -4, str: '2.5' } }

  it('reads the estimate, the remaining time, the count and a number field', () => {
    expect(readLoad(issue, 'estimate')).toBe(12)
    expect(readLoad(issue, 'remaining')).toBe(5)
    expect(readLoad(issue, 'count')).toBe(1)
    expect(readLoad(issue, 'field', 'points')).toBe(3)
  })

  it('counts an item even when it has no values', () => {
    expect(readLoad({}, 'count')).toBe(1)
  })

  it('gives no load for what is not a usable number', () => {
    expect(readLoad({}, 'estimate')).toBe(0)
    expect(readLoad({ estimation: null }, 'estimate')).toBe(0)
    expect(readLoad({ estimation: Number.NaN }, 'estimate')).toBe(0)
    expect(readLoad({ remainingTime: Infinity }, 'remaining')).toBe(0)
    expect(readLoad({ estimation: -2 }, 'estimate')).toBe(0)
    expect(readLoad(issue, 'field', 'text')).toBe(0)
    expect(readLoad(issue, 'field', 'bad')).toBe(0)
    expect(readLoad(issue, 'field', 'neg')).toBe(0)
    expect(readLoad(issue, 'field', 'missing')).toBe(0)
    expect(readLoad(issue, 'field')).toBe(0)
    expect(readLoad({ estimation: 3 }, 'field', 'points')).toBe(0)
  })

  it('accepts a number that was stored as text', () => {
    expect(readLoad(issue, 'field', 'str')).toBe(2.5)
  })

  it('names the properties it reads', () => {
    expect(loadProjection('estimate')).toEqual(['estimation'])
    expect(loadProjection('remaining')).toEqual(['remainingTime'])
    expect(loadProjection('count')).toEqual([])
    expect(loadProjection('field')).toEqual(['customFields'])
  })
})
