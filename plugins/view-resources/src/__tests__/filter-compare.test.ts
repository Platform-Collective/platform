/* eslint-disable @typescript-eslint/no-explicit-any */
import view, { type Filter } from '@hcengineering/view'
import { filtersKey, sameFilters } from '../filter/compare'

const filter = (key: string, mode: string, value: unknown[], extra: Partial<Filter> = {}): Filter => ({
  key: {
    _class: 'tracker:class:Issue' as any,
    key,
    attribute: undefined as any,
    label: '' as any,
    component: '' as any
  },
  mode: mode as any,
  modes: [],
  value: value as any,
  index: 1,
  ...extra
})

describe('sameFilters', () => {
  it('ignores the order of "is" values (a value unticked and ticked again)', () => {
    const saved = [filter('milestone', view.filter.FilterObjectIn, ['otp', 'ferna', 'paw'])]
    const now = [filter('milestone', view.filter.FilterObjectIn, ['ferna', 'paw', 'otp'])]
    expect(sameFilters(JSON.stringify(saved), now)).toBe(true)
  })

  it('ignores value order for every set-like mode, including "Not selected"', () => {
    for (const mode of [
      view.filter.FilterObjectNin,
      view.filter.FilterValueIn,
      view.filter.FilterValueNin,
      view.filter.FilterArrayAll,
      view.filter.FilterArrayAny
    ]) {
      expect(sameFilters([filter('k', mode, [undefined, 'b', 'a'])], [filter('k', mode, ['a', undefined, 'b'])])).toBe(
        true
      )
    }
  })

  it('treats "Not selected" the same in stored JSON and live filters', () => {
    const saved = JSON.stringify([filter('k', view.filter.FilterObjectIn, [undefined, 'b', 'a'])])
    expect(sameFilters(saved, [filter('k', view.filter.FilterObjectIn, ['a', undefined, 'b'])])).toBe(true)
  })

  it('ignores the order of raw values behind a "Value is" label', () => {
    for (const mode of [view.filter.FilterValueIn, view.filter.FilterValueNin]) {
      const saved = JSON.stringify([filter('k', mode, [['Open', ['s2', 's1']], ['Done', ['s3']]])])
      expect(sameFilters(saved, [filter('k', mode, [['Done', ['s3']], ['Open', ['s1', 's2']]])])).toBe(true)
      expect(sameFilters(saved, [filter('k', mode, [['Done', ['s3']], ['Open', ['s1']]])])).toBe(false)
    }
  })

  it('still sees a different value, a missing value and a different mode', () => {
    const base = [filter('milestone', view.filter.FilterObjectIn, ['a', 'b'])]
    expect(sameFilters(base, [filter('milestone', view.filter.FilterObjectIn, ['a', 'c'])])).toBe(false)
    expect(sameFilters(base, [filter('milestone', view.filter.FilterObjectIn, ['a'])])).toBe(false)
    expect(sameFilters(base, [filter('milestone', view.filter.FilterObjectNin, ['b', 'a'])])).toBe(false)
  })

  it('keeps the order for modes where it can matter', () => {
    const a = [filter('dueDate', view.filter.FilterDateBetween, [1, 2])]
    const b = [filter('dueDate', view.filter.FilterDateBetween, [2, 1])]
    expect(sameFilters(a, b)).toBe(false)
  })

  it('normalises nested filters', () => {
    const a = [
      filter('component', view.filter.FilterNestedMatch, [], {
        nested: filter('lead', view.filter.FilterObjectIn, ['x', 'y'])
      })
    ]
    const b = [
      filter('component', view.filter.FilterNestedMatch, [], {
        nested: filter('lead', view.filter.FilterObjectIn, ['y', 'x'])
      })
    ]
    expect(sameFilters(a, b)).toBe(true)
  })

  it('does not change the filters it is given', () => {
    const now = [filter('milestone', view.filter.FilterObjectIn, ['b', 'a'])]
    filtersKey(now)
    expect(now[0].value).toEqual(['b', 'a'])
  })

  it('compares unreadable stored JSON as plain text, as before', () => {
    expect(sameFilters('not json', 'not json')).toBe(true)
    expect(sameFilters('not json', [])).toBe(false)
  })
})
