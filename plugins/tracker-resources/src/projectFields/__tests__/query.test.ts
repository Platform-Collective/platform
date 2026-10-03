//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType, type ProjectField } from '@hcengineering/tracker'
import {
  activeFilterCount,
  buildFieldComparator,
  buildFieldPredicate,
  buildFiltersPredicate,
  buildGroupCategories,
  endOfDay,
  startOfDay,
  isGroupableType,
  isSortableType,
  isFilterableType,
  resolveIterationValues,
  type IterationContext,
  DEFAULT_CUSTOM_FIELD_SCAN_LIMIT,
  exceedsScanLimit,
  isFilterComplete,
  operatorsFor,
  parseCustomFieldViewKey,
  resolveScanLimit,
  toCustomFieldViewKey,
  type CustomFieldFilter
} from '../query'

function field (key: string, type: ProjectFieldType, options?: Array<[string, string]>): ProjectField {
  return {
    key,
    type,
    options: options?.map(([value, label]) => ({ value, label }))
  } as unknown as ProjectField
}

const text = field('note', ProjectFieldType.Text)
const num = field('points', ProjectFieldType.Number)
const date = field('due', ProjectFieldType.Date)
const single = field('size', ProjectFieldType.SingleSelect, [
  ['s', 'Small'],
  ['m', 'Medium'],
  ['l', 'Large']
])
const multi = field('tags', ProjectFieldType.MultiSelect, [
  ['a', 'A'],
  ['b', 'B'],
  ['c', 'C']
])

const day = 24 * 3600 * 1000

describe('custom field filter predicates', () => {
  it('text contains is case insensitive and ignores non-strings', () => {
    const p = buildFieldPredicate(text, { operator: 'contains', value: 'Foo' })
    expect(p({ note: 'a fOo b' })).toBe(true)
    expect(p({ note: 'bar' })).toBe(false)
    expect(p({})).toBe(false)
    expect(p(undefined)).toBe(false)
  })

  it('number comparisons', () => {
    const ctx = (op: any, v: number) => buildFieldPredicate(num, { operator: op, value: v })
    expect(ctx('eq', 3)({ points: 3 })).toBe(true)
    expect(ctx('eq', 3)({ points: 4 })).toBe(false)
    expect(ctx('gt', 3)({ points: 3 })).toBe(false)
    expect(ctx('gte', 3)({ points: 3 })).toBe(true)
    expect(ctx('lt', 3)({ points: 2 })).toBe(true)
    expect(ctx('lte', 3)({ points: 4 })).toBe(false)
    // zero is a real value, not empty
    expect(ctx('eq', 0)({ points: 0 })).toBe(true)
    expect(ctx('lt', 5)({})).toBe(false)
  })

  it('number and date ranges support open ends and are inclusive', () => {
    const range = buildFieldPredicate(num, { operator: 'between', value: { from: 2, to: 5 } })
    expect(range({ points: 2 })).toBe(true)
    expect(range({ points: 5 })).toBe(true)
    expect(range({ points: 6 })).toBe(false)
    const open = buildFieldPredicate(date, { operator: 'between', value: { from: 10 * day } })
    expect(open({ due: 12 * day })).toBe(true)
    expect(open({ due: 8 * day })).toBe(false)
    expect(open({})).toBe(false)
  })

  it('date bounds are whole calendar days', () => {
    const d = new Date(2026, 5, 10, 15, 30).getTime()
    const before = buildFieldPredicate(date, { operator: 'before', value: d })
    const after = buildFieldPredicate(date, { operator: 'after', value: d })
    // Any time on the bound day is neither before nor after it
    expect(before({ due: d })).toBe(false)
    expect(after({ due: d })).toBe(false)
    expect(before({ due: startOfDay(d) })).toBe(false)
    expect(after({ due: endOfDay(d) })).toBe(false)
    expect(before({ due: startOfDay(d) - 1 })).toBe(true)
    expect(after({ due: endOfDay(d) + 1 })).toBe(true)
    const between = buildFieldPredicate(date, { operator: 'between', value: { from: d, to: d } })
    expect(between({ due: startOfDay(d) })).toBe(true)
    expect(between({ due: endOfDay(d) })).toBe(true)
    expect(between({ due: endOfDay(d) + 1 })).toBe(false)
  })

  it('select any-of works for single and multi select and ignores stale options', () => {
    const s = buildFieldPredicate(single, { operator: 'anyOf', value: ['s', 'l'] })
    expect(s({ size: 'l' })).toBe(true)
    expect(s({ size: 'm' })).toBe(false)
    expect(s({ size: 'removed' })).toBe(false)
    const m = buildFieldPredicate(multi, { operator: 'anyOf', value: ['b'] })
    expect(m({ tags: ['a', 'b'] })).toBe(true)
    expect(m({ tags: ['a', 'c'] })).toBe(false)
    expect(m({})).toBe(false)
  })

  it('is-empty and is-not-empty treat missing, null, stale and empty array as empty', () => {
    const empty = buildFieldPredicate(single, { operator: 'isEmpty' })
    expect(empty({})).toBe(true)
    expect(empty({ size: null })).toBe(true)
    expect(empty({ size: 'removed' })).toBe(true)
    expect(empty({ size: 'm' })).toBe(false)
    const notEmpty = buildFieldPredicate(multi, { operator: 'isNotEmpty' })
    expect(notEmpty({ tags: [] })).toBe(false)
    expect(notEmpty({ tags: ['a'] })).toBe(true)
    expect(buildFieldPredicate(num, { operator: 'isEmpty' })({ points: 0 })).toBe(false)
  })

  it('incomplete rules do not restrict the result', () => {
    expect(isFilterComplete({ operator: 'contains', value: '  ' })).toBe(false)
    expect(isFilterComplete({ operator: 'anyOf', value: [] })).toBe(false)
    expect(isFilterComplete({ operator: 'between', value: {} })).toBe(false)
    expect(isFilterComplete({ operator: 'isEmpty' })).toBe(true)
    expect(buildFieldPredicate(text, { operator: 'contains', value: '' })({ note: 'x' })).toBe(true)
  })

  it('combines rules with AND and a rule on a missing field matches nothing', () => {
    const byKey = new Map([
      ['points', num],
      ['size', single]
    ])
    const filters: CustomFieldFilter[] = [
      { id: '1', fieldKey: 'points', operator: 'gte', value: 3 },
      { id: '2', fieldKey: 'size', operator: 'anyOf', value: ['m'] }
    ]
    const pred = buildFiltersPredicate(byKey, filters)
    expect(pred({ customFields: { points: 5, size: 'm' } })).toBe(true)
    expect(pred({ customFields: { points: 1, size: 'm' } })).toBe(false)
    expect(pred({ customFields: { points: 5, size: 's' } })).toBe(false)
    expect(pred({})).toBe(false)
    expect(buildFiltersPredicate(byKey, [])({})).toBe(true)
    const stale = buildFiltersPredicate(byKey, [{ id: '3', fieldKey: 'gone', operator: 'isEmpty' }])
    expect(stale({ customFields: {} })).toBe(false)
    expect(activeFilterCount([...filters, { id: '4', fieldKey: 'size', operator: 'anyOf', value: [] }])).toBe(2)
  })

  it('lists operators per type', () => {
    expect(operatorsFor(ProjectFieldType.Text)).toContain('contains')
    expect(operatorsFor(ProjectFieldType.Number)).toContain('between')
    expect(operatorsFor(ProjectFieldType.Date)).toContain('before')
    expect(operatorsFor(ProjectFieldType.MultiSelect)).toContain('anyOf')
    expect(operatorsFor(ProjectFieldType.Iteration)).toEqual(['anyOf', 'isEmpty', 'isNotEmpty'])
  })
})

describe('custom field sorting', () => {
  const sortIds = (f: ProjectField, dir: 1 | -1, items: Array<{ id: string, customFields?: Record<string, unknown> }>) =>
    [...items].sort(buildFieldComparator(f, dir)).map((i) => i.id)

  it('sorts text with locale compare and puts empty last in both directions', () => {
    const items = [
      { id: 'b', customFields: { note: 'beta' } },
      { id: 'none' },
      { id: 'a', customFields: { note: 'Alpha' } },
      { id: 'c', customFields: { note: 'gamma' } }
    ]
    expect(sortIds(text, 1, items)).toEqual(['a', 'b', 'c', 'none'])
    expect(sortIds(text, -1, items)).toEqual(['c', 'b', 'a', 'none'])
  })

  it('sorts numbers numerically (not as strings) and keeps zero', () => {
    const items = [
      { id: '10', customFields: { points: 10 } },
      { id: '2', customFields: { points: 2 } },
      { id: '0', customFields: { points: 0 } },
      { id: 'none', customFields: {} }
    ]
    expect(sortIds(num, 1, items)).toEqual(['0', '2', '10', 'none'])
    expect(sortIds(num, -1, items)).toEqual(['10', '2', '0', 'none'])
  })

  it('sorts dates chronologically', () => {
    const items = [
      { id: 'late', customFields: { due: 9 * day } },
      { id: 'early', customFields: { due: 1 * day } },
      { id: 'none' }
    ]
    expect(sortIds(date, 1, items)).toEqual(['early', 'late', 'none'])
    expect(sortIds(date, -1, items)).toEqual(['late', 'early', 'none'])
  })

  it('sorts single select by option order', () => {
    const items = [
      { id: 'l', customFields: { size: 'l' } },
      { id: 's', customFields: { size: 's' } },
      { id: 'm', customFields: { size: 'm' } },
      { id: 'stale', customFields: { size: 'removed' } }
    ]
    expect(sortIds(single, 1, items)).toEqual(['s', 'm', 'l', 'stale'])
    expect(sortIds(single, -1, items)).toEqual(['l', 'm', 's', 'stale'])
  })
})

describe('custom field grouping', () => {
  const docs = [
    { customFields: { size: 'l' } },
    { customFields: { size: 's' } },
    {},
    { customFields: { size: 'weird' } }
  ]

  it('orders groups by option order with stray values and the empty group last', () => {
    expect(buildGroupCategories(single, docs, false)).toEqual(['s', 'l', 'weird', undefined])
  })

  it('omits the empty group when every issue has a value', () => {
    expect(buildGroupCategories(single, [{ customFields: { size: 'm' } }], false)).toEqual(['m'])
  })

  it('lists empty options and the empty group when asked to', () => {
    expect(buildGroupCategories(single, [{ customFields: { size: 'm' } }], true)).toEqual(['s', 'm', 'l', undefined])
  })
})

describe('scan limit and view keys', () => {
  it('resolves the configured limit', () => {
    expect(resolveScanLimit(undefined)).toBe(DEFAULT_CUSTOM_FIELD_SCAN_LIMIT)
    expect(resolveScanLimit('123')).toBe(123)
    expect(resolveScanLimit(-5)).toBe(DEFAULT_CUSTOM_FIELD_SCAN_LIMIT)
    expect(resolveScanLimit('abc')).toBe(DEFAULT_CUSTOM_FIELD_SCAN_LIMIT)
    expect(resolveScanLimit(1.5)).toBe(DEFAULT_CUSTOM_FIELD_SCAN_LIMIT)
  })

  it('flags only scans that exceed the limit', () => {
    expect(exceedsScanLimit(5000, 5000)).toBe(false)
    expect(exceedsScanLimit(5001, 5000)).toBe(true)
  })

  it('round-trips view keys', () => {
    expect(toCustomFieldViewKey('size')).toBe('customFields.size')
    expect(parseCustomFieldViewKey('customFields.size')).toBe('size')
    expect(parseCustomFieldViewKey('customFields.')).toBeUndefined()
    expect(parseCustomFieldViewKey('status')).toBeUndefined()
  })
})

describe('iteration fields', () => {
  const sprint = field('sprint', ProjectFieldType.Iteration)
  // Oct 5 - 11, Oct 12 - 18, Oct 19 - 25; the break Oct 26 - Nov 1 is not assignable
  const day = (m: number, d: number): number => new Date(2026, m - 1, d).getTime()
  const mk = (id: string, number: number, start: number, isBreak = false): any => ({
    _id: id,
    number,
    startDate: start,
    duration: 7,
    ...(isBreak ? { isBreak } : {})
  })
  const list = [mk('c', 3, day(10, 19)), mk('a', 1, day(10, 5)), mk('b', 2, day(10, 12)), mk('brk', 0, day(10, 26), true)]
  const ctx = (now: number): IterationContext => ({ iterations: () => list, now })
  const now = new Date(2026, 9, 14, 12).getTime()
  const cf = (value?: string): Record<string, unknown> => (value === undefined ? {} : { sprint: value })

  it('can be filtered, sorted and grouped', () => {
    expect(isFilterableType(ProjectFieldType.Iteration)).toBe(true)
    expect(isSortableType(ProjectFieldType.Iteration)).toBe(true)
    expect(isGroupableType(ProjectFieldType.Iteration)).toBe(true)
    expect(isGroupableType(ProjectFieldType.MultiSelect)).toBe(false)
  })

  it('resolves keywords to iteration ids', () => {
    expect(resolveIterationValues('sprint', ['@current'], ctx(now))).toEqual(['b'])
    expect(resolveIterationValues('sprint', ['@next', '@previous'], ctx(now))).toEqual(['c', 'a'])
    expect(resolveIterationValues('sprint', ['@current+1', '@current-1', 'x'], ctx(now))).toEqual(['c', 'a', 'x'])
    // No iteration at that offset, and keywords need a context
    expect(resolveIterationValues('sprint', ['@current+5'], ctx(now))).toEqual([])
    expect(resolveIterationValues('sprint', ['@current', 'a'], undefined)).toEqual(['a'])
  })

  it('has no current iteration during a break', () => {
    const duringBreak = new Date(2026, 9, 28, 12).getTime()
    expect(resolveIterationValues('sprint', ['@current'], ctx(duringBreak))).toEqual([])
    expect(resolveIterationValues('sprint', ['@previous'], ctx(duringBreak))).toEqual(['c'])
  })

  it('filters by picked iterations and by keywords', () => {
    const picked = buildFieldPredicate(sprint, { operator: 'anyOf', value: ['a', 'c'] }, ctx(now))
    expect([picked(cf('a')), picked(cf('b')), picked(cf('c')), picked(cf())]).toEqual([true, false, true, false])
    const current = buildFieldPredicate(sprint, { operator: 'anyOf', value: ['@current'] }, ctx(now))
    expect([current(cf('a')), current(cf('b')), current(cf())]).toEqual([false, true, false])
    // A keyword with nothing behind it matches nothing
    const none = buildFieldPredicate(sprint, { operator: 'anyOf', value: ['@current'] }, ctx(new Date(2027, 0, 1).getTime()))
    expect(none(cf('b'))).toBe(false)
    const empty = buildFieldPredicate(sprint, { operator: 'isEmpty' }, ctx(now))
    expect([empty(cf('a')), empty(cf())]).toEqual([false, true])
  })

  it('combines with other rules through the registry predicate', () => {
    const rules: CustomFieldFilter[] = [{ id: '1', fieldKey: 'sprint', operator: 'anyOf', value: ['@next'] }]
    const predicate = buildFiltersPredicate(new Map([['sprint', sprint]]), rules, ctx(now))
    expect(predicate({ customFields: cf('c') })).toBe(true)
    expect(predicate({ customFields: cf('b') })).toBe(false)
  })

  it('sorts by the start of the iteration with empty values last', () => {
    const items = [
      { id: 'x1', customFields: cf('c') },
      { id: 'x2', customFields: cf() },
      { id: 'x3', customFields: cf('a') },
      { id: 'x4', customFields: cf('gone') },
      { id: 'x5', customFields: cf('b') }
    ]
    const asc = [...items].sort(buildFieldComparator(sprint, 1, ctx(now))).map((i) => i.id)
    expect(asc).toEqual(['x3', 'x5', 'x1', 'x4', 'x2'])
    const desc = [...items].sort(buildFieldComparator(sprint, -1, ctx(now))).map((i) => i.id)
    expect(desc.slice(-1)).toEqual(['x2'])
    expect(desc.slice(0, 4)).toEqual(['x4', 'x1', 'x5', 'x3'])
  })
})
