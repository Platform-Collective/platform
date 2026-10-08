//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  containsGlob,
  endOfDay,
  matchGlob,
  parseDateScalar,
  parseIterationScalar,
  resolveDate,
  resolveIteration,
  startOfDay
} from '../values'
import { ITERATIONS, NOW } from './fixtures'

function date (text: string): number {
  const s = parseDateScalar(text)
  if (s?.kind !== 'date') throw new Error(`not a date: ${text}`)
  return resolveDate(s, NOW)
}

describe('dates', () => {
  it('parses absolute dates and rejects non-existing ones', () => {
    expect(date('2026-02-03')).toBe(new Date(2026, 1, 3).getTime())
    expect(parseDateScalar('2026-02-30')).toBeUndefined()
    expect(parseDateScalar('2026-13-01')).toBeUndefined()
    expect(parseDateScalar('yesterday')).toBeUndefined()
  })

  it('resolves @today to the start of the current day', () => {
    expect(date('@today')).toBe(startOfDay(NOW))
  })

  it('applies day, week, month and year offsets', () => {
    expect(date('@today-7d')).toBe(new Date(2026, 5, 10).getTime())
    expect(date('@today+1w')).toBe(new Date(2026, 5, 24).getTime())
    expect(date('@today-1m')).toBe(new Date(2026, 4, 17).getTime())
    expect(date('@today+1y')).toBe(new Date(2027, 5, 17).getTime())
  })

  it('clamps month arithmetic to the end of a shorter month', () => {
    const jan31 = new Date(2026, 0, 31, 12).getTime()
    const s = parseDateScalar('@today+1m')
    expect(s?.kind === 'date' && resolveDate(s, jan31)).toBe(new Date(2026, 1, 28).getTime())
  })

  it('rejects an offset without unit', () => {
    expect(parseDateScalar('@today-7')).toBeUndefined()
  })

  it('day bounds cover the whole day', () => {
    expect(endOfDay(NOW) - startOfDay(NOW)).toBe(24 * 60 * 60 * 1000 - 1)
  })
})

describe('iterations', () => {
  const resolve = (text: string): string | undefined => {
    const s = parseIterationScalar(text)
    if (s?.kind !== 'iteration') throw new Error(text)
    return resolveIteration(s, ITERATIONS, NOW)?.id
  }

  it('parses keywords with arithmetic', () => {
    expect(parseIterationScalar('@current')).toEqual({ kind: 'iteration', keyword: 'current', offset: 0 })
    expect(parseIterationScalar('@current+1')).toEqual({ kind: 'iteration', keyword: 'current', offset: 1 })
    expect(parseIterationScalar('@next-2')).toEqual({ kind: 'iteration', keyword: 'next', offset: -2 })
    expect(parseIterationScalar('@soon')).toBeUndefined()
  })

  it('resolves current, next and previous', () => {
    expect(resolve('@current')).toBe('it2')
    expect(resolve('@next')).toBe('it3')
    expect(resolve('@previous')).toBe('it1')
  })

  it('resolves arithmetic', () => {
    expect(resolve('@current+1')).toBe('it3')
    expect(resolve('@current+2')).toBe('it4')
    expect(resolve('@current-1')).toBe('it1')
    expect(resolve('@next+1')).toBe('it4')
  })

  it('returns undefined past the ends', () => {
    expect(resolve('@current+3')).toBeUndefined()
    expect(resolve('@current-2')).toBeUndefined()
    expect(resolve('@previous-1')).toBeUndefined()
  })

  it('handles a gap between iterations', () => {
    const gap = new Date(2026, 5, 14, 12).getTime() // between it1 end (14th 23:59) -> inside; use list without it2
    const list = ITERATIONS.filter((i) => i.id !== 'it2')
    const now = new Date(2026, 5, 20).getTime()
    const at = (kw: 'current' | 'next' | 'previous'): string | undefined =>
      resolveIteration({ kind: 'iteration', keyword: kw, offset: 0 }, list, now)?.id
    expect(gap).toBeGreaterThan(0)
    expect(at('current')).toBeUndefined()
    expect(at('next')).toBe('it3')
    expect(at('previous')).toBe('it1')
  })

  it('returns undefined without iterations', () => {
    expect(resolveIteration({ kind: 'iteration', keyword: 'current', offset: 0 }, [], NOW)).toBeUndefined()
  })
})

describe('globs', () => {
  it('matches whole labels case-insensitively without wildcard', () => {
    expect(matchGlob('done', 'Done')).toBe(true)
    expect(matchGlob('don', 'Done')).toBe(false)
  })

  it('supports wildcards at any position', () => {
    expect(matchGlob('in*', 'In Progress')).toBe(true)
    expect(matchGlob('*gress', 'In Progress')).toBe(true)
    expect(matchGlob('i*s', 'In Progress')).toBe(true)
    expect(matchGlob('a*a', 'a')).toBe(false)
    expect(matchGlob('*', '')).toBe(true)
  })

  it('contains is a substring match', () => {
    expect(containsGlob('login', 'Fix Login bug')).toBe(true)
    expect(containsGlob('fix*bug', 'Fix login bug')).toBe(true)
    expect(containsGlob('bug*fix', 'Fix login bug')).toBe(false)
  })
})
