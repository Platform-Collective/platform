//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { formatColumnCount, limitState, parseLimitInput } from '../limits'

describe('limitState', () => {
  it('is none without a limit', () => {
    expect(limitState(10, undefined)).toBe('none')
    expect(limitState(10, 0)).toBe('none')
    expect(limitState(10, -1)).toBe('none')
  })

  it('compares the count with the limit', () => {
    expect(limitState(0, 3)).toBe('within')
    expect(limitState(2, 3)).toBe('within')
    expect(limitState(3, 3)).toBe('reached')
    expect(limitState(4, 3)).toBe('exceeded')
  })
})

describe('formatColumnCount', () => {
  it('shows the count alone or against the limit', () => {
    expect(formatColumnCount(3, undefined)).toBe('3')
    expect(formatColumnCount(3, 5)).toBe('3/5')
    expect(formatColumnCount(7, 5)).toBe('7/5')
    expect(formatColumnCount(0, 5)).toBe('0/5')
    expect(formatColumnCount(2, 0)).toBe('2')
  })
})

describe('parseLimitInput', () => {
  it('reads a number', () => {
    expect(parseLimitInput(4)).toEqual({ ok: true, limit: 4 })
    expect(parseLimitInput(' 12 ')).toEqual({ ok: true, limit: 12 })
  })

  it('takes empty and zero as no limit', () => {
    expect(parseLimitInput(undefined)).toEqual({ ok: true, limit: undefined })
    expect(parseLimitInput(null)).toEqual({ ok: true, limit: undefined })
    expect(parseLimitInput('')).toEqual({ ok: true, limit: undefined })
    expect(parseLimitInput('  ')).toEqual({ ok: true, limit: undefined })
    expect(parseLimitInput(0)).toEqual({ ok: true, limit: undefined })
    expect(parseLimitInput('0')).toEqual({ ok: true, limit: undefined })
  })

  it('rejects what is not a positive whole number', () => {
    expect(parseLimitInput(-3)).toEqual({ ok: false })
    expect(parseLimitInput(2.5)).toEqual({ ok: false })
    expect(parseLimitInput('abc')).toEqual({ ok: false })
    expect(parseLimitInput(NaN)).toEqual({ ok: false })
    expect(parseLimitInput({})).toEqual({ ok: false })
  })
})
