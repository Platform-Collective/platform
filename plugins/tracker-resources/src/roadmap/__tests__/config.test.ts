//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  DEFAULT_ROADMAP_CONFIG,
  isDefaultConfig,
  normalizeRoadmapConfig,
  readRoadmapConfig,
  ROADMAP_OPTION_KEY,
  sanitizeConfig,
  selectionOf,
  withRoadmapConfig
} from '../config'
import path from 'path'

// The saved views logic is a pure module of view-resources. The path is built at run time so that the type
// checkers do not pull view-resources sources into this package.
const { isViewDirty } = require(path.resolve(__dirname, '../../../../view-resources/src/savedViews')) as {
  isViewDirty: (baseline: Record<string, unknown>, current: Record<string, unknown>) => boolean
}

describe('normalizeRoadmapConfig', () => {
  it('gives the defaults for nothing or garbage', () => {
    expect(normalizeRoadmapConfig(undefined)).toEqual(DEFAULT_ROADMAP_CONFIG)
    expect(normalizeRoadmapConfig(null)).toEqual(DEFAULT_ROADMAP_CONFIG)
    expect(normalizeRoadmapConfig('x')).toEqual(DEFAULT_ROADMAP_CONFIG)
    expect(normalizeRoadmapConfig({ start: 5, target: 'nope', zoom: 'week', markers: 7, fields: 'a' })).toEqual(
      DEFAULT_ROADMAP_CONFIG
    )
  })

  it('keeps valid values', () => {
    const config = {
      start: 'field:begin',
      target: 'iteration:sprint',
      zoom: 'year',
      markers: { milestones: true, iterations: ['sprint'], dates: ['issue:dueDate'] },
      fields: ['title', 'status']
    }
    expect(normalizeRoadmapConfig(config)).toEqual(config)
  })

  it('drops damaged list entries and duplicates', () => {
    const res = normalizeRoadmapConfig({ markers: { iterations: ['a', 1, '', 'a', 'b'] }, fields: ['x', 'x', 3] })
    expect(res.markers.iterations).toEqual(['a', 'b'])
    expect(res.fields).toEqual(['x'])
  })

  it('does not share state with the defaults', () => {
    const res = normalizeRoadmapConfig(undefined)
    res.fields.push('status')
    res.markers.iterations.push('x')
    expect(DEFAULT_ROADMAP_CONFIG.fields).not.toContain('status')
    expect(DEFAULT_ROADMAP_CONFIG.markers.iterations).toEqual([])
  })
})

describe('storing the config in the view options', () => {
  const options = { groupBy: ['#no_category'], orderBy: ['startDate', 1] }

  it('stores a customized config and reads it back', () => {
    const config = { ...DEFAULT_ROADMAP_CONFIG, zoom: 'quarter' as const, start: 'field:begin' }
    const stored = withRoadmapConfig(options, config)
    expect(stored.groupBy).toEqual(options.groupBy)
    expect(readRoadmapConfig(stored)).toEqual(config)
  })

  it('does not store the default config and removes a stored one that returns to it', () => {
    const custom = withRoadmapConfig(options, { ...DEFAULT_ROADMAP_CONFIG, zoom: 'year' })
    expect(ROADMAP_OPTION_KEY in custom).toBe(true)
    const back = withRoadmapConfig(custom, readRoadmapConfig(withRoadmapConfig({}, DEFAULT_ROADMAP_CONFIG)))
    expect(ROADMAP_OPTION_KEY in back).toBe(false)
    expect(back).toEqual(options)
  })

  it('does not modify the options it is given', () => {
    const frozen = Object.freeze({ ...options })
    expect(() => withRoadmapConfig(frozen, { ...DEFAULT_ROADMAP_CONFIG, zoom: 'year' })).not.toThrow()
  })

  it('tells the default from a changed config', () => {
    expect(isDefaultConfig(normalizeRoadmapConfig(undefined))).toBe(true)
    expect(isDefaultConfig({ ...DEFAULT_ROADMAP_CONFIG, fields: ['title'] })).toBe(false)
  })

  it('makes a saved view dirty only when the roadmap settings changed', () => {
    const saved = { viewOptions: withRoadmapConfig(options, DEFAULT_ROADMAP_CONFIG) as any }
    expect(isViewDirty(saved, { viewOptions: withRoadmapConfig(options, DEFAULT_ROADMAP_CONFIG) as any })).toBe(false)
    const zoomed = withRoadmapConfig(options, { ...DEFAULT_ROADMAP_CONFIG, zoom: 'quarter' })
    expect(isViewDirty(saved, { viewOptions: zoomed as any })).toBe(true)
    // Changing the setting and changing it back is not a change
    const again = withRoadmapConfig(zoomed, { ...DEFAULT_ROADMAP_CONFIG })
    expect(isViewDirty(saved, { viewOptions: again as any })).toBe(false)
  })
})

describe('sanitizeConfig', () => {
  const available = {
    sourceIds: new Set(['issue:startDate', 'issue:dueDate', 'field:begin', 'iteration:sprint']),
    iterationFieldKeys: new Set(['sprint']),
    labelFieldIds: new Set(['identifier', 'title', 'cf:size'])
  }

  it('keeps a config that is fully available', () => {
    const config = normalizeRoadmapConfig({
      start: 'field:begin',
      target: 'iteration:sprint',
      markers: { milestones: true, iterations: ['sprint'], dates: ['issue:dueDate'] },
      fields: ['title', 'cf:size']
    })
    expect(sanitizeConfig(config, available)).toEqual(config)
  })

  it('falls back to the default dates and drops what is gone', () => {
    const config = normalizeRoadmapConfig({
      start: 'field:deleted',
      target: 'iteration:deleted',
      markers: { milestones: true, iterations: ['sprint', 'deleted'], dates: ['field:deleted', 'field:begin'] },
      fields: ['title', 'cf:deleted']
    })
    const res = sanitizeConfig(config, available)
    expect(selectionOf(res)).toEqual({ start: DEFAULT_ROADMAP_CONFIG.start, target: DEFAULT_ROADMAP_CONFIG.target })
    expect(res.markers).toEqual({ milestones: true, iterations: ['sprint'], dates: ['field:begin'] })
    expect(res.fields).toEqual(['title'])
  })
})
