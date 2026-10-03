//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType, type ProjectField } from '@hcengineering/tracker'
import {
  buildSummableFields,
  ESTIMATION_SUM_KEY,
  FIELD_SUMS_OPTION_KEY,
  normalizeFieldSums,
  readFieldSums,
  resolveFieldSums,
  sumProjection,
  toggleFieldSum,
  withFieldSums
} from '../config'
import {
  computeFieldSums,
  computeFieldSumsByGroup,
  formatFieldSums,
  formatSumValue,
  sumNumbers,
  toSummable
} from '../sum'

const fields = [
  { key: 'points', label: 'Story points', type: ProjectFieldType.Number },
  { key: 'notes', label: 'Notes', type: ProjectFieldType.Text },
  { key: 'hours', label: 'Hours', type: ProjectFieldType.Number }
] as unknown as ProjectField[]

const summable = buildSummableFields(fields, 'Estimation')

describe('toSummable', () => {
  it('accepts finite numbers and numeric text', () => {
    expect(toSummable(5)).toBe(5)
    expect(toSummable(-2.5)).toBe(-2.5)
    expect(toSummable('7')).toBe(7)
    expect(toSummable(' 1.5 ')).toBe(1.5)
    expect(toSummable(0)).toBe(0)
  })

  it('ignores everything else', () => {
    for (const v of [NaN, Infinity, -Infinity, '', '  ', 'abc', '5kg', null, undefined, {}, [], true, ['1']]) {
      expect(toSummable(v)).toBeUndefined()
    }
  })
})

describe('sumNumbers', () => {
  it('sums an empty list to zero', () => {
    expect(sumNumbers([])).toEqual({ sum: 0, count: 0 })
  })

  it('ignores values that are not numbers and counts the ones that are', () => {
    expect(sumNumbers([1, NaN, undefined, null, 'x', 2, '3'])).toEqual({ sum: 6, count: 3 })
  })

  it('is not poisoned by NaN or Infinity', () => {
    const { sum } = sumNumbers([1, NaN, Infinity, -Infinity, 2])
    expect(sum).toBe(3)
  })

  it('does not accumulate float error', () => {
    expect(sumNumbers([0.1, 0.2]).sum).toBeCloseTo(0.3, 12)
    expect(sumNumbers(new Array(10).fill(0.1)).sum).toBe(1)
  })

  it('is exact for a large list', () => {
    const values = new Array(200000).fill(0.1)
    const { sum, count } = sumNumbers(values)
    expect(count).toBe(200000)
    expect(Math.abs(sum - 20000)).toBeLessThan(1e-6)
    const ints = Array.from({ length: 100000 }, (_, i) => i + 1)
    expect(sumNumbers(ints).sum).toBe(5000050000)
  })

  it('keeps a sum that overflows infinite instead of NaN', () => {
    const res = sumNumbers([1e308, 1e308, 5, -1e308])
    expect(res.sum).toBe(Infinity)
    expect(res.count).toBe(4)
  })

  it('handles negative values and cancellation', () => {
    expect(sumNumbers([5, -5]).sum).toBe(0)
    expect(sumNumbers([1e16, 1, -1e16]).sum).toBe(1)
  })
})

describe('computeFieldSums', () => {
  const docs = [
    { estimation: 2, customFields: { points: 3, hours: 1.5 } },
    { estimation: 0, customFields: { points: 5 } },
    { estimation: 4 },
    { customFields: { points: 'n/a', hours: NaN } }
  ]

  it('sums every field over the documents', () => {
    const res = computeFieldSums(docs, summable.filter((f) => f.key !== 'customFields.hours'))
    expect(res).toEqual([
      { key: 'estimation', label: 'Estimation', sum: 6, count: 3 },
      { key: 'customFields.points', label: 'Story points', sum: 8, count: 2 }
    ])
  })

  it('gives zero for no documents', () => {
    expect(computeFieldSums([], summable).map((r) => r.sum)).toEqual([0, 0, 0])
  })

  it('gives no results for no fields', () => {
    expect(computeFieldSums(docs, [])).toEqual([])
  })

  it('sums the documents of a view that stay after the filter, nothing else', () => {
    // A document that is filtered out of the list is not passed in, so it does not count
    const shown = docs.filter((d) => (d.estimation ?? 0) > 0)
    expect(computeFieldSums(shown, [summable[0]])[0].sum).toBe(6)
    expect(computeFieldSums(docs.slice(1, 2), [summable[0]])[0].sum).toBe(0)
  })

  it('sums per group, a document in one group only', () => {
    const items = [
      { g: 'a', estimation: 1 },
      { g: 'b', estimation: 10 },
      { g: 'a', estimation: 2 },
      { g: 'c' }
    ]
    const res = computeFieldSumsByGroup(items, [summable[0]], (d) => d.g)
    expect(res.get('a')?.[0].sum).toBe(3)
    expect(res.get('b')?.[0].sum).toBe(10)
    expect(res.get('c')?.[0]).toMatchObject({ sum: 0, count: 0 })
    // The groups add up to the total
    const total = [...res.values()].reduce((acc, r) => acc + r[0].sum, 0)
    expect(total).toBe(computeFieldSums(items, [summable[0]])[0].sum)
    expect(res.has('d')).toBe(false)
  })
})

describe('formatting', () => {
  it('prints at most two decimals without trailing zeros', () => {
    expect(formatSumValue(12)).toBe('12')
    expect(formatSumValue(12.5)).toBe('12.5')
    expect(formatSumValue(1.005)).toBe('1')
    expect(formatSumValue(0.1 + 0.2)).toBe('0.3')
    expect(formatSumValue(-0.001)).toBe('0')
    expect(formatSumValue(1e21)).toBe('1000000000000000000000')
    expect(formatSumValue(Infinity)).toBe('∞')
  })

  it('formats a line of sums', () => {
    const res = computeFieldSums([{ estimation: 2, customFields: { points: 3 } }], summable.slice(0, 2))
    expect(formatFieldSums(res)).toBe('Estimation: 2 · Story points: 3')
    expect(formatFieldSums(res, false)).toBe('2 · 3')
    expect(formatFieldSums([])).toBeUndefined()
  })
})

describe('config', () => {
  it('offers the estimation and the Number fields only', () => {
    expect(summable.map((f) => f.key)).toEqual(['estimation', 'customFields.points', 'customFields.hours'])
    expect(summable.map((f) => f.label)).toEqual(['Estimation', 'Story points', 'Hours'])
  })

  it('reads whatever is stored defensively', () => {
    expect(normalizeFieldSums(undefined)).toEqual([])
    expect(normalizeFieldSums('estimation')).toEqual([])
    expect(normalizeFieldSums(['a', '', 'a', 5, 'b'])).toEqual(['a', 'b'])
    expect(readFieldSums({ [FIELD_SUMS_OPTION_KEY]: ['estimation'] })).toEqual(['estimation'])
    expect(readFieldSums(undefined)).toEqual([])
  })

  it('stores nothing for an empty list, so that the view stays clean', () => {
    const opts = { groupBy: ['status'], [FIELD_SUMS_OPTION_KEY]: ['estimation'] }
    expect(FIELD_SUMS_OPTION_KEY in withFieldSums(opts, [])).toBe(false)
    expect(withFieldSums({ groupBy: ['status'] }, [])).toEqual({ groupBy: ['status'] })
    expect(withFieldSums(opts, ['estimation', 'customFields.points'])[FIELD_SUMS_OPTION_KEY]).toEqual([
      'estimation',
      'customFields.points'
    ])
    // The options that were passed are not changed
    expect(opts[FIELD_SUMS_OPTION_KEY]).toEqual(['estimation'])
  })

  it('toggles a field', () => {
    expect(toggleFieldSum([], 'estimation')).toEqual(['estimation'])
    expect(toggleFieldSum(['estimation'], 'customFields.points')).toEqual(['estimation', 'customFields.points'])
    expect(toggleFieldSum(['estimation', 'customFields.points'], 'estimation')).toEqual(['customFields.points'])
  })

  it('leaves out a field that no longer exists', () => {
    const res = resolveFieldSums(['customFields.hours', 'customFields.gone', ESTIMATION_SUM_KEY], summable)
    expect(res.map((f) => f.key)).toEqual(['customFields.hours', 'estimation'])
  })

  it('knows what has to be loaded', () => {
    expect(sumProjection([])).toEqual([])
    expect(sumProjection(['estimation'])).toEqual(['estimation'])
    expect(sumProjection(['customFields.a', 'customFields.b'])).toEqual(['customFields'])
    expect(sumProjection(['estimation', 'customFields.a', 'unknown']).sort()).toEqual(['customFields', 'estimation'])
  })
})
