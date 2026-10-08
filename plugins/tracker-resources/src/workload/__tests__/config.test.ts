//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import path from 'path'
import { NO_DATE_SOURCE } from '../../calendar/config'
import {
  DEFAULT_CAPACITY_PER_DAY,
  DEFAULT_WORKLOAD_CONFIG,
  isDefaultWorkloadConfig,
  isLoadMeasure,
  MAX_CAPACITY_PER_DAY,
  normalizeWorkloadConfig,
  readWorkloadConfig,
  sanitizeWorkloadConfig,
  validCapacity,
  withWorkloadConfig,
  workloadSelection,
  WORKLOAD_OPTION_KEY
} from '../config'

// The saved views logic is a pure module of view-resources. The path is built at run time so that the type
// checkers do not pull view-resources sources into this package.
const { isViewDirty } = require(path.resolve(__dirname, '../../../../view-resources/src/savedViews')) as {
  isViewDirty: (baseline: Record<string, unknown>, current: Record<string, unknown>) => boolean
}

describe('defaults', () => {
  it('is a week view of the estimate with 8 hours a day on the dates of the roadmap', () => {
    expect(DEFAULT_WORKLOAD_CONFIG).toEqual({
      start: 'issue:startDate',
      target: 'issue:dueDate',
      zoom: 'week',
      measure: 'estimate',
      capacity: 8
    })
    expect(DEFAULT_CAPACITY_PER_DAY).toBe(8)
  })
})

describe('validCapacity', () => {
  it('accepts a finite number above zero, also as text', () => {
    expect(validCapacity(6)).toBe(6)
    expect(validCapacity(7.5)).toBe(7.5)
    expect(validCapacity(' 6.25 ')).toBe(6.25)
    expect(validCapacity(0.126)).toBe(0.13)
    expect(validCapacity(MAX_CAPACITY_PER_DAY)).toBe(MAX_CAPACITY_PER_DAY)
  })

  it('refuses zero, negative, huge, not finite and not numbers', () => {
    for (const bad of [0, -1, MAX_CAPACITY_PER_DAY + 1, Number.NaN, Infinity, '', 'abc', null, undefined, {}, [], true]) {
      expect(validCapacity(bad)).toBeUndefined()
    }
  })
})

describe('normalizeWorkloadConfig', () => {
  it('gives the defaults for nothing or garbage', () => {
    expect(normalizeWorkloadConfig(undefined)).toEqual(DEFAULT_WORKLOAD_CONFIG)
    expect(normalizeWorkloadConfig(null)).toEqual(DEFAULT_WORKLOAD_CONFIG)
    expect(normalizeWorkloadConfig('x')).toEqual(DEFAULT_WORKLOAD_CONFIG)
    expect(
      normalizeWorkloadConfig({ start: 5, target: 'nope', zoom: 'year', measure: 'hours', capacity: -2, field: 4 })
    ).toEqual(DEFAULT_WORKLOAD_CONFIG)
  })

  it('keeps valid values, a switched off date field included', () => {
    const config = {
      start: NO_DATE_SOURCE,
      target: 'field:release',
      zoom: 'month',
      measure: 'field',
      field: 'points',
      capacity: 6
    }
    expect(normalizeWorkloadConfig(config)).toEqual(config)
    expect(normalizeWorkloadConfig({ measure: 'count', zoom: 'day', capacity: 3 })).toEqual({
      ...DEFAULT_WORKLOAD_CONFIG,
      measure: 'count',
      zoom: 'day',
      capacity: 3
    })
  })

  it('needs a field for the measure number field', () => {
    expect(normalizeWorkloadConfig({ measure: 'field' }).measure).toBe('estimate')
    expect(normalizeWorkloadConfig({ measure: 'field', field: '' }).measure).toBe('estimate')
  })

  it('drops a field that no measure uses', () => {
    expect(normalizeWorkloadConfig({ measure: 'remaining', field: 'points' })).toEqual({
      ...DEFAULT_WORKLOAD_CONFIG,
      measure: 'remaining'
    })
  })

  it('needs one date field: two switched off give the default pair and keep the rest', () => {
    expect(normalizeWorkloadConfig({ start: 'none', target: 'none', zoom: 'day', capacity: 5 })).toEqual({
      ...DEFAULT_WORKLOAD_CONFIG,
      zoom: 'day',
      capacity: 5
    })
  })

  it('recognises the measures', () => {
    expect(isLoadMeasure('count')).toBe(true)
    expect(isLoadMeasure('points')).toBe(false)
  })

  it('does not share state with the defaults', () => {
    const res = normalizeWorkloadConfig(undefined)
    res.start = 'x'
    expect(DEFAULT_WORKLOAD_CONFIG.start).toBe('issue:startDate')
  })
})

describe('storing the config in the view options', () => {
  const options = { groupBy: ['#no_category'], orderBy: ['rank', 1] }

  it('stores a customized config and reads it back next to the other options', () => {
    const config = { ...DEFAULT_WORKLOAD_CONFIG, zoom: 'month' as const, capacity: 7 }
    const stored = withWorkloadConfig(options, config)
    expect(stored.groupBy).toEqual(options.groupBy)
    expect(readWorkloadConfig(stored)).toEqual(config)
  })

  it('does not store the default config and removes a stored one that returns to it', () => {
    const custom = withWorkloadConfig(options, { ...DEFAULT_WORKLOAD_CONFIG, measure: 'count' })
    expect(WORKLOAD_OPTION_KEY in custom).toBe(true)
    const back = withWorkloadConfig(custom, { ...DEFAULT_WORKLOAD_CONFIG })
    expect(WORKLOAD_OPTION_KEY in back).toBe(false)
    expect(back).toEqual(options)
  })

  it('does not store a field for a measure that does not use it', () => {
    const stored = withWorkloadConfig(options, { ...DEFAULT_WORKLOAD_CONFIG, measure: 'count', field: 'points' })
    expect((stored as any)[WORKLOAD_OPTION_KEY].field).toBeUndefined()
  })

  it('does not modify the options it is given', () => {
    const frozen = Object.freeze({ ...options })
    expect(() => withWorkloadConfig(frozen, { ...DEFAULT_WORKLOAD_CONFIG, zoom: 'day' })).not.toThrow()
  })

  it('does not collide with the roadmap, board or calendar settings', () => {
    const stored = withWorkloadConfig(
      { roadmap: { zoom: 'year' }, board: { columnField: 'x' }, calendar: { mode: 'week' } },
      { ...DEFAULT_WORKLOAD_CONFIG, zoom: 'day' }
    )
    expect(stored.roadmap).toEqual({ zoom: 'year' })
    expect(stored.board).toEqual({ columnField: 'x' })
    expect(stored.calendar).toEqual({ mode: 'week' })
  })

  it('tells the default from a changed config', () => {
    expect(isDefaultWorkloadConfig(normalizeWorkloadConfig(undefined))).toBe(true)
    expect(isDefaultWorkloadConfig({ ...DEFAULT_WORKLOAD_CONFIG, capacity: 6 })).toBe(false)
    expect(isDefaultWorkloadConfig({ ...DEFAULT_WORKLOAD_CONFIG, start: NO_DATE_SOURCE })).toBe(false)
  })

  it('makes a saved view dirty only when the workload settings changed', () => {
    const saved = { viewOptions: withWorkloadConfig(options, DEFAULT_WORKLOAD_CONFIG) as any }
    expect(isViewDirty(saved, { viewOptions: withWorkloadConfig(options, DEFAULT_WORKLOAD_CONFIG) as any })).toBe(false)
    const week = withWorkloadConfig(options, { ...DEFAULT_WORKLOAD_CONFIG, capacity: 6 })
    expect(isViewDirty(saved, { viewOptions: week as any })).toBe(true)
    // Changing the setting and changing it back is not a change
    const again = withWorkloadConfig(week, { ...DEFAULT_WORKLOAD_CONFIG })
    expect(isViewDirty(saved, { viewOptions: again as any })).toBe(false)
    // A view saved with a workload config is clean while it is unchanged
    const customSaved = { viewOptions: week as any }
    expect(isViewDirty(customSaved, { viewOptions: withWorkloadConfig(options, readWorkloadConfig(week)) as any })).toBe(false)
    // Every setting is a change
    for (const change of [{ zoom: 'day' }, { measure: 'remaining' }, { target: 'field:x' }, { start: 'none' }]) {
      const changed = withWorkloadConfig(options, normalizeWorkloadConfig({ ...DEFAULT_WORKLOAD_CONFIG, ...change }))
      expect(isViewDirty(saved, { viewOptions: changed as any })).toBe(true)
    }
  })
})

describe('workloadSelection', () => {
  it('gives the date sources of the view', () => {
    expect(workloadSelection({ ...DEFAULT_WORKLOAD_CONFIG, target: 'field:x' })).toEqual({
      start: 'issue:startDate',
      target: 'field:x'
    })
  })
})

describe('sanitizeWorkloadConfig', () => {
  const available = { sourceIds: new Set(['issue:startDate', 'issue:dueDate', 'field:release']), numberFieldKeys: new Set(['points']) }

  it('keeps a config that is fully available', () => {
    const config = { ...DEFAULT_WORKLOAD_CONFIG, start: NO_DATE_SOURCE, target: 'field:release', measure: 'field' as const, field: 'points' }
    expect(sanitizeWorkloadConfig(config, available)).toEqual(config)
  })

  it('falls back for a date field that is gone', () => {
    const res = sanitizeWorkloadConfig({ ...DEFAULT_WORKLOAD_CONFIG, start: 'field:deleted', target: 'field:release' }, available)
    expect(workloadSelection(res)).toEqual({ start: 'issue:startDate', target: 'field:release' })
  })

  it('falls back to the default measure for a number field that is gone', () => {
    const res = sanitizeWorkloadConfig({ ...DEFAULT_WORKLOAD_CONFIG, measure: 'field', field: 'deleted' }, available)
    expect(res.measure).toBe('estimate')
    expect(res.field).toBeUndefined()
  })

  it('does not end up with no date field at all', () => {
    const res = sanitizeWorkloadConfig(
      { ...DEFAULT_WORKLOAD_CONFIG, start: NO_DATE_SOURCE, target: 'field:deleted' },
      { sourceIds: new Set(['issue:startDate']), numberFieldKeys: new Set() }
    )
    expect(res.start === NO_DATE_SOURCE && res.target === NO_DATE_SOURCE).toBe(false)
  })
})
