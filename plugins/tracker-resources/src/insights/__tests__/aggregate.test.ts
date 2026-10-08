//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  aggregateCell,
  bucketDayRange,
  bucketStart,
  CHART_ALL,
  CHART_NONE,
  computeChart,
  formatBucketLabel,
  MAX_FILLED_DATE_BUCKETS,
  nextBucketStart,
  type CategoryDimension,
  type DateDimension
} from '../aggregate'

interface Doc {
  status?: string
  tags?: string[]
  team?: string
  points?: unknown
  due?: number
}

function category (
  options: Array<[string, string]>,
  read: (doc: Doc) => string[],
  includeEmpty: boolean = false
): CategoryDimension {
  return {
    kind: 'category',
    options: options.map(([id, label]) => ({ id, label })),
    includeEmpty,
    ids: read,
    noneLabel: 'No field'
  }
}

const status = category(
  [
    ['todo', 'Todo'],
    ['doing', 'Doing'],
    ['done', 'Done']
  ],
  (d) => (d.status !== undefined ? [d.status] : [])
)
const team = category(
  [
    ['a', 'Team A'],
    ['b', 'Team B']
  ],
  (d) => (d.team !== undefined ? [d.team] : [])
)
const tags = category(
  [
    ['bug', 'bug'],
    ['ui', 'ui']
  ],
  (d) => d.tags ?? []
)

const docs: Doc[] = [
  { status: 'todo', team: 'a', points: 3 },
  { status: 'todo', team: 'b', points: 5 },
  { status: 'done', team: 'a', points: 2 },
  { status: 'done', team: 'a' },
  { team: 'b', points: 'x' }
]

describe('computeChart: buckets and series', () => {
  it('counts by the options of the X field in their order, "No <field>" last', () => {
    const res = computeChart({ docs, x: status, measure: { type: 'count' } })
    expect(res.categories.map((c) => c.label)).toEqual(['Todo', 'Done', 'No field'])
    expect(res.categories.map((c) => c.none)).toEqual([false, false, true])
    expect(res.series).toEqual([{ id: CHART_ALL, label: '', none: false }])
    expect(res.values).toEqual([[2, 2, 1]])
    expect(res.counts).toEqual([[2, 2, 1]])
    expect(res.items).toBe(5)
  })

  it('lists the options no item has when the field asks for it, and no empty "No <field>"', () => {
    const all = { ...status, includeEmpty: true }
    const res = computeChart({ docs: docs.filter((d) => d.status !== undefined), x: all, measure: { type: 'count' } })
    expect(res.categories.map((c) => c.label)).toEqual(['Todo', 'Doing', 'Done'])
    expect(res.values).toEqual([[2, 0, 2]])
  })

  it('makes a series for every used option of the group field and a "No <field>" series last', () => {
    const res = computeChart({ docs, x: status, group: team, measure: { type: 'count' } })
    expect(res.series.map((s) => s.label)).toEqual(['Team A', 'Team B'])
    expect(res.values).toEqual([
      [1, 2, 0], // Team A: todo, done, none
      [1, 0, 1]
    ])
    const withNone = computeChart({
      docs: [...docs, { status: 'todo' }],
      x: status,
      group: team,
      measure: { type: 'count' }
    })
    expect(withNone.series.map((s) => [s.label, s.none])).toEqual([
      ['Team A', false],
      ['Team B', false],
      ['No field', true]
    ])
    expect(withNone.values[2]).toEqual([1, 0, 0])
  })

  it('counts an item with several values in each of them', () => {
    const res = computeChart({
      docs: [{ tags: ['bug', 'ui'] }, { tags: ['bug'] }, { tags: [] }],
      x: tags,
      measure: { type: 'count' }
    })
    expect(res.categories.map((c) => c.label)).toEqual(['bug', 'ui', 'No field'])
    expect(res.values).toEqual([[2, 1, 1]])
    expect(res.items).toBe(3)
  })

  it('crosses two multi valued fields', () => {
    const res = computeChart({
      docs: [{ tags: ['bug', 'ui'], team: 'a' }],
      x: tags,
      group: team,
      measure: { type: 'count' }
    })
    expect(res.values).toEqual([[1, 1]])
  })

  it('has nothing to draw without items', () => {
    const res = computeChart({ docs: [], x: status, group: team, measure: { type: 'count' } })
    expect(res).toEqual({ categories: [], series: [], values: [], counts: [], items: 0 })
  })
})

describe('computeChart: Y aggregates', () => {
  const measure = (type: 'sum' | 'avg' | 'min' | 'max'): any => ({ type, read: (d: Doc) => d.points })

  it('sums the numbers of a bucket and ignores values that are not numbers', () => {
    const res = computeChart({ docs, x: status, measure: measure('sum') })
    // Todo 3 + 5, Done 2 (the item without points adds nothing), No status: "x" is not a number
    expect(res.values).toEqual([[8, 2, 0]])
    // The item counts are still the items
    expect(res.counts).toEqual([[2, 2, 1]])
  })

  it('averages over the items that have a number, with no value for a bucket that has none', () => {
    const res = computeChart({ docs, x: status, measure: measure('avg') })
    expect(res.values).toEqual([[4, 2, null]])
  })

  it('takes the minimum and the maximum', () => {
    expect(computeChart({ docs, x: status, measure: measure('min') }).values).toEqual([[3, 2, null]])
    expect(computeChart({ docs, x: status, measure: measure('max') }).values).toEqual([[5, 2, null]])
  })

  it('handles negative numbers and decimals without float noise', () => {
    const items: Doc[] = [{ points: -2 }, { points: 0.1 }, { points: 0.2 }]
    const res = computeChart({ docs: items, x: status, measure: measure('sum') })
    expect(res.values).toEqual([[-1.7]])
    expect(computeChart({ docs: items, x: status, measure: measure('min') }).values).toEqual([[-2]])
  })

  it('treats a cell without items as 0 for count and sum and as no value for the rest', () => {
    expect(aggregateCell('count', undefined)).toBe(0)
    expect(aggregateCell('sum', undefined)).toBe(0)
    expect(aggregateCell('avg', undefined)).toBeNull()
    expect(aggregateCell('min', undefined)).toBeNull()
    expect(aggregateCell('max', { count: 2, numbers: [] })).toBeNull()
  })

  it('fills the cells of a grouped chart', () => {
    const res = computeChart({ docs, x: status, group: team, measure: measure('sum') })
    expect(res.values).toEqual([
      [3, 2, 0],
      [5, 0, 0]
    ])
  })
})

describe('date buckets', () => {
  // 2026-10-05 is a Monday
  const day = (y: number, m: number, d: number, h: number = 12): number => new Date(y, m - 1, d, h).getTime()

  it('buckets a timestamp by day, week (Monday) and month in local time', () => {
    const ts = day(2026, 10, 8, 15) // Thursday
    expect(bucketStart(ts, 'day')).toBe(day(2026, 10, 8, 0))
    expect(bucketStart(ts, 'week')).toBe(day(2026, 10, 5, 0))
    expect(bucketStart(day(2026, 10, 11, 23), 'week')).toBe(day(2026, 10, 5, 0)) // Sunday
    expect(bucketStart(ts, 'month')).toBe(day(2026, 10, 1, 0))
  })

  it('steps to the next bucket across month and year ends', () => {
    expect(nextBucketStart(day(2026, 12, 31, 0), 'day')).toBe(day(2027, 1, 1, 0))
    expect(nextBucketStart(day(2026, 12, 28, 0), 'week')).toBe(day(2027, 1, 4, 0))
    expect(nextBucketStart(day(2026, 12, 1, 0), 'month')).toBe(day(2027, 1, 1, 0))
  })

  it('labels and ranges buckets', () => {
    expect(formatBucketLabel(day(2026, 10, 5, 0), 'week')).toBe('2026-10-05')
    expect(formatBucketLabel(day(2026, 10, 1, 0), 'month')).toBe('2026-10')
    expect(bucketDayRange(day(2026, 10, 5, 0), 'week')).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(bucketDayRange(day(2026, 2, 1, 0), 'month')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  const due = (bucket: DateDimension['bucket']): DateDimension => ({
    kind: 'date',
    bucket,
    read: (d: Doc) => d.due,
    noneLabel: 'No due'
  })

  it('fills in the buckets between the first and the last item', () => {
    const items: Doc[] = [{ due: day(2026, 10, 1) }, { due: day(2026, 10, 1, 18) }, { due: day(2026, 10, 4) }]
    const res = computeChart({ docs: items, x: due('day'), measure: { type: 'count' } })
    expect(res.categories.map((c) => c.label)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(res.values).toEqual([[2, 0, 0, 1]])
    expect(res.categories[0].start).toBe(day(2026, 10, 1, 0))
    expect(res.categories[0].end).toBe(day(2026, 10, 2, 0) - 1)
  })

  it('keeps the items without a date in a last "No <field>" bucket', () => {
    const items: Doc[] = [{ due: day(2026, 10, 1) }, {}, { due: Number.NaN }]
    const res = computeChart({ docs: items, x: due('month'), measure: { type: 'count' } })
    expect(res.categories.map((c) => [c.label, c.none])).toEqual([
      ['2026-10', false],
      ['No due', true]
    ])
    expect(res.values).toEqual([[1, 2]])
  })

  it('does not fill in a range of more than the cap, it draws the buckets that have items', () => {
    const items: Doc[] = [{ due: day(2020, 1, 1) }, { due: day(2026, 1, 1) }]
    const res = computeChart({ docs: items, x: due('day'), measure: { type: 'count' } })
    expect(res.categories).toHaveLength(2)
    expect(MAX_FILLED_DATE_BUCKETS).toBeGreaterThan(0)
  })

  it('groups a date axis by series', () => {
    const items: Doc[] = [
      { due: day(2026, 10, 1), team: 'a' },
      { due: day(2026, 10, 2), team: 'b' }
    ]
    const res = computeChart({ docs: items, x: due('day'), group: team, measure: { type: 'count' } })
    expect(res.values).toEqual([
      [1, 0],
      [0, 1]
    ])
  })
})

describe('computeChart: options', () => {
  it('drops an item whose value is not an option of a field (a removed status counts as no value)', () => {
    const strict = category([['a', 'A']], (d) => (d.status === 'a' ? ['a'] : []))
    const res = computeChart({ docs: [{ status: 'a' }, { status: 'gone' }], x: strict, measure: { type: 'count' } })
    expect(res.categories.map((c) => c.id)).toEqual(['a', CHART_NONE])
  })
})
