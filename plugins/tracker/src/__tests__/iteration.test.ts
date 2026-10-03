//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  addDays,
  buildIterationGroupCategories,
  daysBetween,
  daysToDuration,
  durationToDays,
  findOverlap,
  formatIterationRange,
  generateInitialIterations,
  getAssignableIterations,
  getIterationState,
  groupIterationsByState,
  iterationEnd,
  iterationEndExclusive,
  planAddIteration,
  planIterationChange,
  planMoveItems,
  replaceIterationValue,
  resolveRelativeIteration,
  sortIterations,
  stripIterationValues,
  toIterationRanges
} from '../iteration'

// Local calendar days, so that the tests do not depend on the time zone of the machine
const day = (m: number, d: number, y = 2026): number => new Date(y, m - 1, d).getTime()
const noon = (m: number, d: number): number => new Date(2026, m - 1, d, 12, 0, 0).getTime()

interface It {
  _id: any
  label: string
  number: number
  startDate: number
  duration: number
  isBreak?: boolean
}

function mk (id: string, number: number, start: number, duration = 7, isBreak = false): It {
  return { _id: id, label: id, number, startDate: start, duration, ...(isBreak ? { isBreak } : {}) }
}

// Oct 5 - Oct 11, Oct 12 - Oct 18, Oct 19 - Oct 25
const three = (): It[] => [mk('a', 1, day(10, 5)), mk('b', 2, day(10, 12)), mk('c', 3, day(10, 19))]

describe('date math', () => {
  it('adds calendar days across a month end', () => {
    expect(addDays(day(10, 30), 3)).toBe(day(11, 2))
    expect(addDays(day(3, 1), -1)).toBe(day(2, 28))
  })

  it('counts calendar days', () => {
    expect(daysBetween(day(10, 5), day(10, 12))).toBe(7)
    expect(daysBetween(noon(10, 5), day(10, 6))).toBe(1)
    expect(daysBetween(day(10, 12), day(10, 5))).toBe(-7)
  })

  it('computes the end of an iteration', () => {
    const a = mk('a', 1, day(10, 5))
    expect(iterationEndExclusive(a)).toBe(day(10, 12))
    expect(iterationEnd(a)).toBe(day(10, 12) - 1)
    expect(new Date(iterationEnd(a)).getDate()).toBe(11)
  })
})

describe('getIterationState', () => {
  const a = mk('a', 1, day(10, 5))
  it('is planned before the first day', () => {
    expect(getIterationState(a, day(10, 5) - 1)).toBe('planned')
  })
  it('is current on the first and on the last day', () => {
    expect(getIterationState(a, day(10, 5))).toBe('current')
    expect(getIterationState(a, noon(10, 11))).toBe('current')
    expect(getIterationState(a, day(10, 12) - 1)).toBe('current')
  })
  it('is completed after the last day', () => {
    expect(getIterationState(a, day(10, 12))).toBe('completed')
  })
})

describe('ordering helpers', () => {
  it('sorts by start date and drops breaks from the assignable list', () => {
    const list = [mk('c', 3, day(10, 19)), mk('brk', 0, day(10, 12), 3, true), mk('a', 1, day(10, 5))]
    expect(sortIterations(list).map((x) => x._id)).toEqual(['a', 'brk', 'c'])
    expect(getAssignableIterations(list).map((x) => x._id)).toEqual(['a', 'c'])
  })

  it('exposes the assignable iterations as grammar ranges', () => {
    const ranges = toIterationRanges([...three(), mk('brk', 0, day(10, 26), 3, true)])
    expect(ranges.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(ranges[0]).toEqual({ id: 'a', title: 'a', start: day(10, 5), end: day(10, 12) - 1 })
  })
})

describe('resolveRelativeIteration', () => {
  const list = three()
  const id = (x: ReturnType<typeof resolveRelativeIteration>): string | undefined => (x as It | undefined)?._id

  it('resolves current, next and previous', () => {
    const now = noon(10, 14)
    expect(id(resolveRelativeIteration(list, 'current', 0, now))).toBe('b')
    expect(id(resolveRelativeIteration(list, 'next', 0, now))).toBe('c')
    expect(id(resolveRelativeIteration(list, 'previous', 0, now))).toBe('a')
  })

  it('supports arithmetic', () => {
    const now = noon(10, 7)
    expect(id(resolveRelativeIteration(list, 'current', 1, now))).toBe('b')
    expect(id(resolveRelativeIteration(list, 'current', 2, now))).toBe('c')
    expect(id(resolveRelativeIteration(list, 'current', 3, now))).toBeUndefined()
    expect(id(resolveRelativeIteration(list, 'current', -1, now))).toBeUndefined()
    expect(id(resolveRelativeIteration(list, 'next', 1, now))).toBe('c')
    expect(id(resolveRelativeIteration(list, 'previous', 0, noon(10, 20)))).toBe('b')
    expect(id(resolveRelativeIteration(list, 'previous', -1, noon(10, 20)))).toBe('a')
  })

  it('has no current iteration before, after or during a break', () => {
    expect(id(resolveRelativeIteration(list, 'current', 0, noon(9, 1)))).toBeUndefined()
    expect(id(resolveRelativeIteration(list, 'current', 0, noon(11, 20)))).toBeUndefined()
    const withBreak = [mk('a', 1, day(10, 5)), mk('brk', 0, day(10, 12), 7, true), mk('c', 2, day(10, 19))]
    const now = noon(10, 14)
    expect(id(resolveRelativeIteration(withBreak, 'current', 0, now))).toBeUndefined()
    // The break is skipped: next is the iteration after it, previous the one before it
    expect(id(resolveRelativeIteration(withBreak, 'next', 0, now))).toBe('c')
    expect(id(resolveRelativeIteration(withBreak, 'previous', 0, now))).toBe('a')
  })

  it('finds the neighbours of today when nothing is running', () => {
    expect(id(resolveRelativeIteration(list, 'next', 0, noon(9, 1)))).toBe('a')
    expect(id(resolveRelativeIteration(list, 'previous', 0, noon(11, 20)))).toBe('c')
    expect(id(resolveRelativeIteration(list, 'previous', 0, noon(9, 1)))).toBeUndefined()
  })
})

describe('groupIterationsByState', () => {
  it('splits into completed, current and planned', () => {
    const list = [...three(), mk('brk', 0, day(10, 26), 7, true)]
    const res = groupIterationsByState(list, noon(10, 13))
    expect(res.completed.map((x) => x._id)).toEqual(['a'])
    expect(res.current?._id).toBe('b')
    expect(res.planned.map((x) => x._id)).toEqual(['c', 'brk'])
  })

  it('has no current iteration between iterations', () => {
    const res = groupIterationsByState([mk('a', 1, day(10, 5)), mk('b', 2, day(10, 20))], noon(10, 15))
    expect(res.current).toBeUndefined()
    expect(res.completed).toHaveLength(1)
    expect(res.planned).toHaveLength(1)
  })
})

describe('duration units', () => {
  it('converts weeks and days', () => {
    expect(durationToDays(2, 'weeks')).toBe(14)
    expect(durationToDays(5, 'days')).toBe(5)
    expect(daysToDuration(14)).toEqual({ amount: 2, unit: 'weeks' })
    expect(daysToDuration(10)).toEqual({ amount: 10, unit: 'days' })
    expect(daysToDuration(7)).toEqual({ amount: 1, unit: 'weeks' })
    expect(daysToDuration(3)).toEqual({ amount: 3, unit: 'days' })
  })
})

describe('generateInitialIterations', () => {
  it('creates three consecutive one-week iterations starting today', () => {
    const res = generateInitialIterations({ now: noon(10, 3) })
    expect(res).toHaveLength(3)
    expect(res.map((x) => x.label)).toEqual(['Iteration 1', 'Iteration 2', 'Iteration 3'])
    expect(res.map((x) => x.number)).toEqual([1, 2, 3])
    expect(res.map((x) => x.duration)).toEqual([7, 7, 7])
    expect(res[0].startDate).toBe(day(10, 3))
    expect(res[1].startDate).toBe(day(10, 10))
    expect(res[2].startDate).toBe(day(10, 17))
    expect(findOverlap(res.map((x, i) => ({ ...x, _id: String(i) as any })))).toBeUndefined()
  })

  it('honours the duration, start date, count and titles', () => {
    const res = generateInitialIterations({
      now: noon(10, 3),
      duration: 14,
      startDate: noon(10, 5),
      count: 2,
      labelOf: (n) => `Sprint ${n}`
    })
    expect(res.map((x) => x.label)).toEqual(['Sprint 1', 'Sprint 2'])
    expect(res.map((x) => x.startDate)).toEqual([day(10, 5), day(10, 19)])
  })

  it('falls back to a week for an invalid duration', () => {
    expect(generateInitialIterations({ now: day(10, 3), duration: 0 })[0].duration).toBe(7)
  })
})

describe('findOverlap', () => {
  it('detects overlapping ranges and allows gaps', () => {
    expect(findOverlap(three())).toBeUndefined()
    expect(findOverlap([mk('a', 1, day(10, 5)), mk('b', 2, day(10, 20))])).toBeUndefined()
    expect(findOverlap([mk('a', 1, day(10, 5)), mk('b', 2, day(10, 11))])).toEqual(['a', 'b'])
  })
})

describe('planIterationChange', () => {
  const apply = (list: It[], updates: Array<{ id: string, update: any }>): It[] =>
    list.map((x) => ({ ...x, ...(updates.find((u) => u.id === x._id)?.update ?? {}) }))

  it('only renames without shifting', () => {
    const res = planIterationChange(three(), 'b' as any, { label: '  Sprint  ' })
    expect(res).toEqual({ ok: true, updates: [{ id: 'b', update: { label: 'Sprint' } }] })
  })

  it('shifts the following iterations when the duration grows', () => {
    const res = planIterationChange(three(), 'a' as any, { duration: 14 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const next = apply(three(), res.updates as any)
    expect(next.map((x) => x.startDate)).toEqual([day(10, 5), day(10, 19), day(10, 26)])
    expect(findOverlap(next)).toBeUndefined()
  })

  it('shifts back when the duration shrinks and keeps gaps', () => {
    const list = [mk('a', 1, day(10, 5)), mk('b', 2, day(10, 14)), mk('c', 3, day(10, 25))]
    const res = planIterationChange(list, 'a' as any, { duration: 3 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const next = apply(list, res.updates as any)
    expect(next.map((x) => x.startDate)).toEqual([day(10, 5), day(10, 10), day(10, 21)])
  })

  it('moves the following iterations with a later start date', () => {
    const res = planIterationChange(three(), 'b' as any, { startDate: noon(10, 14) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const next = apply(three(), res.updates as any)
    expect(next.map((x) => x.startDate)).toEqual([day(10, 5), day(10, 14), day(10, 21)])
  })

  it('rejects a start date that runs into the previous iteration', () => {
    expect(planIterationChange(three(), 'b' as any, { startDate: day(10, 10) })).toEqual({
      ok: false,
      error: 'overlap'
    })
  })

  it('allows an earlier start right after the previous iteration', () => {
    const list = [mk('a', 1, day(10, 5)), mk('b', 2, day(10, 14))]
    const res = planIterationChange(list, 'b' as any, { startDate: day(10, 12) })
    expect(res.ok).toBe(true)
  })

  it('rejects invalid input', () => {
    expect(planIterationChange(three(), 'a' as any, { duration: 0 })).toEqual({ ok: false, error: 'invalidDuration' })
    expect(planIterationChange(three(), 'a' as any, { duration: 1.5 })).toEqual({ ok: false, error: 'invalidDuration' })
    expect(planIterationChange(three(), 'a' as any, { label: '  ' })).toEqual({ ok: false, error: 'emptyLabel' })
    expect(planIterationChange(three(), 'zzz' as any, { label: 'x' })).toEqual({ ok: false, error: 'unknown' })
  })

  it('shifts across breaks as well', () => {
    const list = [mk('a', 1, day(10, 5)), mk('brk', 0, day(10, 12), 7, true), mk('c', 2, day(10, 19))]
    const res = planIterationChange(list, 'a' as any, { duration: 8 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const next = apply(list, res.updates as any)
    expect(next.map((x) => x.startDate)).toEqual([day(10, 5), day(10, 13), day(10, 20)])
    expect(findOverlap(next)).toBeUndefined()
  })
})

describe('planAddIteration', () => {
  it('appends after the last iteration with its duration', () => {
    const res = planAddIteration(three(), { now: day(10, 3) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.updates).toEqual([])
    expect(res.draft).toEqual({ label: 'Iteration 4', number: 4, startDate: day(10, 26), duration: 7 })
  })

  it('starts the first iteration today', () => {
    const res = planAddIteration([], { now: noon(10, 3) })
    expect(res.ok && res.draft.startDate).toBe(day(10, 3))
    expect(res.ok && res.draft.number).toBe(1)
  })

  it('inserts a break and shifts what follows', () => {
    const res = planAddIteration(three(), { afterId: 'a' as any, isBreak: true, duration: 3, label: 'Holiday', now: day(10, 3) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft).toEqual({ label: 'Holiday', number: 0, startDate: day(10, 12), duration: 3, isBreak: true })
    expect(res.updates).toEqual([
      { id: 'b', update: { startDate: day(10, 15) } },
      { id: 'c', update: { startDate: day(10, 22) } }
    ])
  })

  it('names a break and numbers iterations without counting breaks', () => {
    const list = [...three(), mk('brk', 0, day(10, 26), 7, true)]
    const brk = planAddIteration(list, { isBreak: true, now: day(10, 3) })
    expect(brk.ok && brk.draft.label).toBe('Break')
    const next = planAddIteration(list, { now: day(10, 3) })
    expect(next.ok && next.draft.number).toBe(4)
    // The duration is the one of the last iteration, not of the break
    expect(next.ok && next.draft.duration).toBe(7)
  })

  it('rejects an unknown anchor and an invalid duration', () => {
    expect(planAddIteration(three(), { afterId: 'zzz' as any, now: day(10, 3) })).toEqual({ ok: false, error: 'unknown' })
    expect(planAddIteration(three(), { duration: -1, now: day(10, 3) })).toEqual({ ok: false, error: 'invalidDuration' })
  })
})

describe('moving items between iterations', () => {
  const issues = [
    { _id: '1', customFields: { sprint: 'a', other: 1 } },
    { _id: '2', customFields: { sprint: 'b' } },
    { _id: '3', customFields: { other: 2 } },
    { _id: '4' }
  ]

  it('replaces or removes the value', () => {
    expect(replaceIterationValue({ sprint: 'a', other: 1 }, 'sprint', 'a', 'b')).toEqual({ sprint: 'b', other: 1 })
    expect(replaceIterationValue({ sprint: 'a', other: 1 }, 'sprint', 'a', null)).toEqual({ other: 1 })
    expect(replaceIterationValue({ sprint: 'b' }, 'sprint', 'a', null)).toBeUndefined()
    expect(replaceIterationValue(undefined, 'sprint', 'a', null)).toBeUndefined()
  })

  it('plans the move of all items of one iteration', () => {
    const plan = planMoveItems(issues, 'sprint', 'a', 'b')
    expect(plan.map((p) => p.issue._id)).toEqual(['1'])
    expect(plan[0].customFields).toEqual({ sprint: 'b', other: 1 })
  })

  it('moves to no iteration and ignores a move onto itself', () => {
    expect(planMoveItems(issues, 'sprint', 'b', null)[0].customFields).toEqual({})
    expect(planMoveItems(issues, 'sprint', 'a', 'a')).toEqual([])
  })
})

describe('stripIterationValues', () => {
  const dropped = new Map([
    ['sprint', new Set(['a'])],
    ['release', new Set(['x', 'y'])]
  ])

  it('removes only the values of deleted iterations', () => {
    expect(stripIterationValues({ sprint: 'a', release: 'z', size: 3 }, dropped)).toEqual({ release: 'z', size: 3 })
    expect(stripIterationValues({ sprint: 'a', release: 'y' }, dropped)).toEqual({})
  })

  it('does not touch the input and reports no change as undefined', () => {
    const input = { sprint: 'a' }
    stripIterationValues(input, dropped)
    expect(input).toEqual({ sprint: 'a' })
    expect(stripIterationValues({ sprint: 'b', size: 1 }, dropped)).toBeUndefined()
    expect(stripIterationValues({ size: 1 }, dropped)).toBeUndefined()
    expect(stripIterationValues(undefined, dropped)).toBeUndefined()
  })
})

describe('buildIterationGroupCategories', () => {
  const iterations = [...three(), mk('brk', 0, day(10, 26), 7, true)]

  it('orders groups by start date, with the empty group last', () => {
    const docs = [
      { customFields: { sprint: 'c' } },
      { customFields: { sprint: 'a' } },
      { customFields: {} },
      { customFields: { sprint: 'gone' } }
    ]
    expect(buildIterationGroupCategories(iterations, docs, 'sprint', false)).toEqual(['a', 'c', 'gone', undefined])
  })

  it('lists unused iterations only on request and never lists breaks', () => {
    const docs = [{ customFields: { sprint: 'b' } }]
    expect(buildIterationGroupCategories(iterations, docs, 'sprint', false)).toEqual(['b'])
    expect(buildIterationGroupCategories(iterations, docs, 'sprint', true)).toEqual(['a', 'b', 'c', undefined])
  })
})

describe('formatIterationRange', () => {
  it('shows the first and the last day', () => {
    const text = formatIterationRange(mk('a', 1, day(10, 5)), noon(10, 6), 'en-US')
    expect(text).toBe('Oct 5 – Oct 11')
  })

  it('adds the year when it differs from the current one', () => {
    const text = formatIterationRange(mk('a', 1, day(12, 28)), noon(10, 6), 'en-US')
    expect(text).toBe('Dec 28, 2026 – Jan 3, 2027')
    expect(formatIterationRange(mk('a', 1, day(10, 5, 2025)), noon(10, 6), 'en-US')).toBe('Oct 5, 2025 – Oct 11, 2025')
  })
})
