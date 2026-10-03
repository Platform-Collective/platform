//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  compareViews,
  duplicateViewName,
  getEffectiveViewConfig,
  isViewDirty,
  nextOrder,
  nextViewName,
  orderForMove,
  parseStoredFilters,
  sortViews
} from '../savedViews'

const opts = (groupBy: string): any => ({ groupBy: [groupBy], orderBy: ['modifiedOn', -1] })

describe('getEffectiveViewConfig', () => {
  it('falls back to defaults when nothing else is set', () => {
    const res = getEffectiveViewConfig({
      defaults: { viewletId: 'list', viewOptions: opts('status'), config: ['a'] }
    })
    expect(res.viewletId).toBe('list')
    expect(res.config).toEqual(['a'])
    expect(res.viewOptions).toEqual(opts('status'))
    expect(res.filters).toBe('[]')
  })

  it('global preference overrides defaults for columns', () => {
    const res = getEffectiveViewConfig({ defaults: { config: ['a'] }, preference: ['b'] })
    expect(res.config).toEqual(['b'])
  })

  it('saved view overrides the global preference', () => {
    const res = getEffectiveViewConfig({ preference: ['b'], saved: { config: ['c'], filters: '[1]' } })
    expect(res.config).toEqual(['c'])
    expect(res.filters).toBe('[1]')
  })

  it('local edits override the saved view', () => {
    const res = getEffectiveViewConfig({
      preference: ['b'],
      saved: { config: ['c'], viewOptions: opts('status'), filters: '[1]', extra: 'x' },
      local: { config: ['d'], viewOptions: opts('priority'), filters: '[2]', extra: 'y' }
    })
    expect(res.config).toEqual(['d'])
    expect(res.viewOptions).toEqual(opts('priority'))
    expect(res.filters).toBe('[2]')
    expect(res.extra).toBe('y')
  })

  it('merges field by field', () => {
    const res = getEffectiveViewConfig({
      saved: { config: ['c'], viewOptions: opts('status') },
      local: { filters: '[2]' }
    })
    expect(res.config).toEqual(['c'])
    expect(res.viewOptions).toEqual(opts('status'))
    expect(res.filters).toBe('[2]')
  })

  it('treats an empty column list as not specified', () => {
    const res = getEffectiveViewConfig({ preference: ['b'], saved: { config: [] }, local: { config: [] } })
    expect(res.config).toEqual(['b'])
  })

  it('ignores layout specific parts of layers authored for another layout', () => {
    const res = getEffectiveViewConfig({
      preference: ['b'],
      saved: { viewletId: 'list', config: ['c'], viewOptions: opts('status'), filters: '[1]' },
      currentViewletId: 'kanban'
    })
    expect(res.config).toEqual(['b'])
    expect(res.viewOptions).toBeUndefined()
    expect(res.filters).toBe('[1]')
  })

  it('keeps layers when the displayed layout matches', () => {
    const res = getEffectiveViewConfig({
      saved: { viewletId: 'list', config: ['c'] },
      currentViewletId: 'list'
    })
    expect(res.config).toEqual(['c'])
  })
})

describe('isViewDirty', () => {
  const base = { viewletId: 'list', filters: '[]', viewOptions: opts('status'), config: ['a'] }

  it('is clean for an identical state', () => {
    expect(isViewDirty(base, { ...base, viewOptions: opts('status'), config: ['a'] })).toBe(false)
  })

  it('normalizes absent and empty values', () => {
    expect(isViewDirty({ viewletId: null }, { filters: '', config: [], extra: '[]', filterQuery: '  ' })).toBe(false)
  })

  it('detects a change of each part', () => {
    expect(isViewDirty(base, { ...base, viewletId: 'kanban' })).toBe(true)
    expect(isViewDirty(base, { ...base, filters: '[1]' })).toBe(true)
    expect(isViewDirty(base, { ...base, viewOptions: opts('priority') })).toBe(true)
    expect(isViewDirty(base, { ...base, config: ['a', 'b'] })).toBe(true)
    expect(isViewDirty(base, { ...base, extra: '[{"k":1}]' })).toBe(true)
    expect(isViewDirty(base, { ...base, filterQuery: 'status:Done' })).toBe(true)
  })

  it('ignores whitespace around the filter string only', () => {
    const q = { ...base, filterQuery: 'status:Done' }
    expect(isViewDirty(q, { ...base, filterQuery: ' status:Done ' })).toBe(false)
    expect(isViewDirty(q, { ...base, filterQuery: 'status:Todo' })).toBe(true)
    expect(isViewDirty(q, base)).toBe(true)
  })

  it('detects column reorder', () => {
    expect(isViewDirty({ config: ['a', 'b'] }, { config: ['b', 'a'] })).toBe(true)
  })
})

describe('view naming', () => {
  it('names new views View N', () => {
    expect(nextViewName([])).toBe('View 1')
    expect(nextViewName(['View 1'])).toBe('View 2')
  })

  it('skips taken numbers', () => {
    expect(nextViewName(['View 2', 'Other'])).toBe('View 3')
    expect(nextViewName(['View 1', 'view 3'])).toBe('View 4')
  })

  it('duplicates as X (copy)', () => {
    expect(duplicateViewName('Bugs', ['Bugs'])).toBe('Bugs (copy)')
  })

  it('numbers repeated duplicates', () => {
    expect(duplicateViewName('Bugs', ['Bugs', 'Bugs (copy)'])).toBe('Bugs (copy 2)')
    expect(duplicateViewName('Bugs', ['Bugs', 'Bugs (copy)', 'Bugs (copy 2)'])).toBe('Bugs (copy 3)')
  })
})

describe('view order', () => {
  const v = (_id: string, order?: number, createdOn?: number): any => ({ _id, order, createdOn })

  it('sorts by order, unordered last, ties by creation', () => {
    const sorted = sortViews([v('c'), v('b', 1), v('a', 0), v('d', 1, -5)])
    expect(sorted.map((it) => it._id)).toEqual(['a', 'd', 'b', 'c'])
    expect(compareViews(v('x', 1), v('y', 2))).toBeLessThan(0)
  })

  it('appends after the last order', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder([v('a', 0), v('b', 4), v('c')])).toBe(5)
  })

  it('places a moved view between its new neighbours', () => {
    const views = [v('a', 0), v('b', 1), v('c', 2)]
    expect(orderForMove(views, 'c', 1)).toBe(0.5)
    expect(orderForMove(views, 'a', 1)).toBe(1.5)
  })

  it('handles the ends', () => {
    const views = [v('a', 0), v('b', 1), v('c', 2)]
    expect(orderForMove(views, 'c', 0)).toBe(-1)
    expect(orderForMove(views, 'a', 2)).toBe(3)
    expect(orderForMove(views, 'a', 99)).toBe(3)
  })

  it('returns undefined when the position does not change or the view is unknown', () => {
    const views = [v('a', 0), v('b', 1)]
    expect(orderForMove(views, 'a', 0)).toBeUndefined()
    expect(orderForMove(views, 'zz', 0)).toBeUndefined()
  })

  it('keeps the resulting order consistent after repeated moves', () => {
    let views = [v('a', 0), v('b', 1), v('c', 2)]
    const moved = orderForMove(views, 'c', 0) as number
    views = views.map((it) => (it._id === 'c' ? { ...it, order: moved } : it))
    expect(sortViews(views).map((it) => it._id)).toEqual(['c', 'a', 'b'])
    const moved2 = orderForMove(views, 'c', 1) as number
    views = views.map((it) => (it._id === 'c' ? { ...it, order: moved2 } : it))
    expect(sortViews(views).map((it) => it._id)).toEqual(['a', 'c', 'b'])
  })
})

describe('parseStoredFilters', () => {
  it('parses arrays and tolerates garbage', () => {
    expect(parseStoredFilters('[{"a":1}]')).toEqual([{ a: 1 }])
    expect(parseStoredFilters(undefined)).toEqual([])
    expect(parseStoredFilters('{bad')).toEqual([])
    expect(parseStoredFilters('{"a":1}')).toEqual([])
  })
})

describe('getEffectiveViewConfig filterQuery', () => {
  it('is empty by default and for old views without a filter string', () => {
    expect(getEffectiveViewConfig({}).filterQuery).toBe('')
    expect(getEffectiveViewConfig({ saved: { filters: '[]' } }).filterQuery).toBe('')
  })

  it('prefers local edits over the saved view over defaults', () => {
    expect(getEffectiveViewConfig({ defaults: { filterQuery: 'a' }, saved: { filterQuery: 'b' } }).filterQuery).toBe('b')
    expect(
      getEffectiveViewConfig({ saved: { filterQuery: 'b' }, local: { filterQuery: '' } }).filterQuery
    ).toBe('')
  })
})
