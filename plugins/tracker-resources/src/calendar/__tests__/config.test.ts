//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import path from 'path'
import {
  CALENDAR_OPTION_KEY,
  calendarSelection,
  DEFAULT_CALENDAR_CONFIG,
  isDefaultCalendarConfig,
  NO_DATE_SOURCE,
  normalizeCalendarConfig,
  readCalendarConfig,
  sanitizeCalendarConfig,
  withCalendarConfig
} from '../config'

// The saved views logic is a pure module of view-resources. The path is built at run time so that the type
// checkers do not pull view-resources sources into this package.
const { isViewDirty } = require(path.resolve(__dirname, '../../../../view-resources/src/savedViews')) as {
  isViewDirty: (baseline: Record<string, unknown>, current: Record<string, unknown>) => boolean
}

describe('normalizeCalendarConfig', () => {
  it('gives the defaults for nothing or garbage', () => {
    expect(normalizeCalendarConfig(undefined)).toEqual(DEFAULT_CALENDAR_CONFIG)
    expect(normalizeCalendarConfig(null)).toEqual(DEFAULT_CALENDAR_CONFIG)
    expect(normalizeCalendarConfig('x')).toEqual(DEFAULT_CALENDAR_CONFIG)
    expect(normalizeCalendarConfig({ mode: 'year', start: 5, target: 'nope' })).toEqual(DEFAULT_CALENDAR_CONFIG)
  })

  it('keeps valid values, a switched off field included', () => {
    const config = { mode: 'agenda', start: NO_DATE_SOURCE, target: 'field:release' }
    expect(normalizeCalendarConfig(config)).toEqual(config)
    expect(normalizeCalendarConfig({ mode: 'week', start: 'iteration:sprint', target: 'iteration:sprint' })).toEqual({
      mode: 'week',
      start: 'iteration:sprint',
      target: 'iteration:sprint'
    })
  })

  it('needs one date field: two switched off give the default pair and keep the mode', () => {
    expect(normalizeCalendarConfig({ mode: 'week', start: 'none', target: 'none' })).toEqual({
      ...DEFAULT_CALENDAR_CONFIG,
      mode: 'week'
    })
  })

  it('does not share state with the defaults', () => {
    const res = normalizeCalendarConfig(undefined)
    res.start = 'x'
    expect(DEFAULT_CALENDAR_CONFIG.start).toBe('issue:startDate')
  })
})

describe('storing the config in the view options', () => {
  const options = { groupBy: ['#no_category'], orderBy: ['rank', 1] }

  it('stores a customized config and reads it back next to the other options', () => {
    const config = { ...DEFAULT_CALENDAR_CONFIG, mode: 'week' as const, target: 'field:release' }
    const stored = withCalendarConfig(options, config)
    expect(stored.groupBy).toEqual(options.groupBy)
    expect(readCalendarConfig(stored)).toEqual(config)
  })

  it('does not store the default config and removes a stored one that returns to it', () => {
    const custom = withCalendarConfig(options, { ...DEFAULT_CALENDAR_CONFIG, mode: 'agenda' })
    expect(CALENDAR_OPTION_KEY in custom).toBe(true)
    const back = withCalendarConfig(custom, { ...DEFAULT_CALENDAR_CONFIG })
    expect(CALENDAR_OPTION_KEY in back).toBe(false)
    expect(back).toEqual(options)
  })

  it('does not modify the options it is given', () => {
    const frozen = Object.freeze({ ...options })
    expect(() => withCalendarConfig(frozen, { ...DEFAULT_CALENDAR_CONFIG, mode: 'week' })).not.toThrow()
  })

  it('does not collide with the roadmap or board settings', () => {
    const stored = withCalendarConfig({ roadmap: { zoom: 'year' }, board: { columnField: 'x' } }, {
      ...DEFAULT_CALENDAR_CONFIG,
      mode: 'week'
    })
    expect(stored.roadmap).toEqual({ zoom: 'year' })
    expect(stored.board).toEqual({ columnField: 'x' })
  })

  it('tells the default from a changed config', () => {
    expect(isDefaultCalendarConfig(normalizeCalendarConfig(undefined))).toBe(true)
    expect(isDefaultCalendarConfig({ ...DEFAULT_CALENDAR_CONFIG, start: NO_DATE_SOURCE })).toBe(false)
  })

  it('makes a saved view dirty only when the calendar settings changed', () => {
    const saved = { viewOptions: withCalendarConfig(options, DEFAULT_CALENDAR_CONFIG) as any }
    expect(isViewDirty(saved, { viewOptions: withCalendarConfig(options, DEFAULT_CALENDAR_CONFIG) as any })).toBe(false)
    const week = withCalendarConfig(options, { ...DEFAULT_CALENDAR_CONFIG, mode: 'week' })
    expect(isViewDirty(saved, { viewOptions: week as any })).toBe(true)
    // Changing the setting and changing it back is not a change
    const again = withCalendarConfig(week, { ...DEFAULT_CALENDAR_CONFIG })
    expect(isViewDirty(saved, { viewOptions: again as any })).toBe(false)
    // A view saved with a calendar config is clean while it is unchanged
    const customSaved = { viewOptions: week as any }
    expect(isViewDirty(customSaved, { viewOptions: withCalendarConfig(options, readCalendarConfig(week)) as any })).toBe(false)
  })
})

describe('sanitizeCalendarConfig', () => {
  const sources = new Set(['issue:startDate', 'issue:dueDate', 'field:release'])

  it('keeps a config that is fully available, a switched off field included', () => {
    const config = { mode: 'week' as const, start: NO_DATE_SOURCE, target: 'field:release' }
    expect(sanitizeCalendarConfig(config, sources)).toEqual(config)
  })

  it('falls back to the default for a field that is gone', () => {
    const res = sanitizeCalendarConfig({ mode: 'month', start: 'field:deleted', target: 'field:release' }, sources)
    expect(calendarSelection(res)).toEqual({ start: DEFAULT_CALENDAR_CONFIG.start, target: 'field:release' })
  })

  it('does not end up with no date field at all', () => {
    const res = sanitizeCalendarConfig({ mode: 'agenda', start: NO_DATE_SOURCE, target: 'field:deleted' }, new Set(['issue:startDate']))
    // The target falls back to the due date, which is not available either, but the start is switched off: use the defaults
    expect(res.mode).toBe('agenda')
    expect(res.start === NO_DATE_SOURCE && res.target === NO_DATE_SOURCE).toBe(false)
  })
})
