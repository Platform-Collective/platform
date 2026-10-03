//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType } from '@hcengineering/tracker'
import {
  BOARD_OPTION_KEY,
  columnFieldKeys,
  DEFAULT_BOARD_CONFIG,
  hiddenOf,
  isAvailableColumnField,
  isDefaultBoardConfig,
  limitsOf,
  normalizeBoardConfig,
  normalizeLimit,
  readBoardConfig,
  resolveBoardDimensions,
  withAllColumnsShown,
  withBoardConfig,
  withColumnField,
  withColumnHidden,
  withColumnLimit,
  withoutColumnLimits
} from '../config'
import path from 'path'

// The saved views logic is a pure module of view-resources. The path is built at run time so that the type
// checkers do not pull view-resources sources into this package.
const { isViewDirty } = require(path.resolve(__dirname, '../../../../view-resources/src/savedViews')) as {
  isViewDirty: (baseline: Record<string, unknown>, current: Record<string, unknown>) => boolean
}

const fields = [
  { key: 'stage', type: ProjectFieldType.SingleSelect },
  { key: 'sprint', type: ProjectFieldType.Iteration },
  { key: 'effort', type: ProjectFieldType.Number },
  { key: 'tags', type: ProjectFieldType.MultiSelect }
]

describe('normalizeBoardConfig', () => {
  it('gives the defaults for nothing or garbage', () => {
    expect(normalizeBoardConfig(undefined)).toEqual(DEFAULT_BOARD_CONFIG)
    expect(normalizeBoardConfig(null)).toEqual(DEFAULT_BOARD_CONFIG)
    expect(normalizeBoardConfig('x')).toEqual(DEFAULT_BOARD_CONFIG)
    expect(normalizeBoardConfig([])).toEqual(DEFAULT_BOARD_CONFIG)
    expect(normalizeBoardConfig({ columnField: 5, columnLimits: 'a', hiddenColumns: 7 })).toEqual(DEFAULT_BOARD_CONFIG)
  })

  it('keeps valid values and drops damaged parts', () => {
    const config = normalizeBoardConfig({
      columnField: 'customFields.stage',
      columnLimits: { 'customFields.stage': { todo: 3, bad: 0, worse: -1, frac: 1.5, str: '2' }, status: 'x' },
      hiddenColumns: { status: ['Done', 'Done', 4], other: 'x', empty: [] }
    })
    expect(config).toEqual({
      columnField: 'customFields.stage',
      columnLimits: { 'customFields.stage': { todo: 3 } },
      hiddenColumns: { status: ['Done'] }
    })
  })

  it('does not share structure with the input', () => {
    const raw = { columnField: 'status', columnLimits: { status: { a: 1 } }, hiddenColumns: { status: ['a'] } }
    const config = normalizeBoardConfig(raw)
    config.columnLimits.status.a = 9
    config.hiddenColumns.status.push('b')
    expect(raw.columnLimits.status.a).toBe(1)
    expect(raw.hiddenColumns.status).toEqual(['a'])
  })
})

describe('normalizeLimit', () => {
  it('accepts only positive whole numbers', () => {
    expect(normalizeLimit(3)).toBe(3)
    expect(normalizeLimit(0)).toBeUndefined()
    expect(normalizeLimit(-2)).toBeUndefined()
    expect(normalizeLimit(2.5)).toBeUndefined()
    expect(normalizeLimit(NaN)).toBeUndefined()
    expect(normalizeLimit('3')).toBeUndefined()
    expect(normalizeLimit(undefined)).toBeUndefined()
  })
})

describe('column limits and hidden columns', () => {
  it('sets, changes and removes a limit', () => {
    const one = withColumnLimit(DEFAULT_BOARD_CONFIG, 'status', 'Todo', 3)
    expect(limitsOf(one, 'status')).toEqual({ Todo: 3 })
    const two = withColumnLimit(one, 'status', 'Todo', 5)
    expect(limitsOf(two, 'status')).toEqual({ Todo: 5 })
    const none = withColumnLimit(two, 'status', 'Todo', undefined)
    expect(none).toEqual(DEFAULT_BOARD_CONFIG)
    expect(limitsOf(none, 'status')).toEqual({})
  })

  it('does not change the config it was given', () => {
    const base = withColumnLimit(DEFAULT_BOARD_CONFIG, 'status', 'Todo', 3)
    withColumnLimit(base, 'status', 'Todo', 9)
    withColumnHidden(base, 'status', 'Todo', true)
    expect(limitsOf(base, 'status')).toEqual({ Todo: 3 })
    expect(hiddenOf(base, 'status')).toEqual([])
    expect(DEFAULT_BOARD_CONFIG).toEqual({ columnField: 'status', columnLimits: {}, hiddenColumns: {} })
  })

  it('keeps the limits per column field', () => {
    let config = withColumnLimit(DEFAULT_BOARD_CONFIG, 'status', 'Todo', 3)
    config = withColumnLimit(config, 'customFields.stage', 'a', 2)
    config = withoutColumnLimits(config, 'status')
    expect(limitsOf(config, 'status')).toEqual({})
    expect(limitsOf(config, 'customFields.stage')).toEqual({ a: 2 })
  })

  it('ignores an invalid limit like a removal', () => {
    const config = withColumnLimit(withColumnLimit(DEFAULT_BOARD_CONFIG, 'status', 'a', 4), 'status', 'a', 0)
    expect(config).toEqual(DEFAULT_BOARD_CONFIG)
  })

  it('hides and shows columns', () => {
    let config = withColumnHidden(DEFAULT_BOARD_CONFIG, 'status', 'Done', true)
    config = withColumnHidden(config, 'status', 'Backlog', true)
    expect(hiddenOf(config, 'status')).toEqual(['Done', 'Backlog'])
    // Hiding twice does not repeat the column
    expect(hiddenOf(withColumnHidden(config, 'status', 'Done', true), 'status')).toEqual(['Backlog', 'Done'])
    config = withColumnHidden(config, 'status', 'Done', false)
    expect(hiddenOf(config, 'status')).toEqual(['Backlog'])
    expect(withAllColumnsShown(config, 'status')).toEqual(DEFAULT_BOARD_CONFIG)
  })

  it('keeps the limits and hidden columns when the column field changes', () => {
    let config = withColumnLimit(DEFAULT_BOARD_CONFIG, 'status', 'Todo', 3)
    config = withColumnHidden(config, 'status', 'Done', true)
    const other = withColumnField(config, 'customFields.stage')
    expect(other.columnField).toBe('customFields.stage')
    expect(limitsOf(other, 'status')).toEqual({ Todo: 3 })
    expect(hiddenOf(other, 'status')).toEqual(['Done'])
    expect(withColumnField(other, 'status')).toEqual(config)
  })
})

describe('column field', () => {
  it('offers the built-in attributes and the single-select and iteration fields', () => {
    expect(columnFieldKeys({ fields })).toEqual([
      'status',
      'assignee',
      'priority',
      'component',
      'milestone',
      'customFields.stage',
      'customFields.sprint'
    ])
  })

  it('knows which keys can be the column field', () => {
    expect(isAvailableColumnField('status', { fields: [] })).toBe(true)
    expect(isAvailableColumnField('customFields.stage', { fields })).toBe(true)
    expect(isAvailableColumnField('customFields.sprint', { fields })).toBe(true)
    expect(isAvailableColumnField('customFields.effort', { fields })).toBe(false)
    expect(isAvailableColumnField('customFields.tags', { fields })).toBe(false)
    expect(isAvailableColumnField('customFields.gone', { fields })).toBe(false)
    expect(isAvailableColumnField('createdBy', { fields })).toBe(false)
  })
})

describe('resolveBoardDimensions', () => {
  const available = { fields }

  it('uses the status columns and no swimlanes by default', () => {
    expect(resolveBoardDimensions(DEFAULT_BOARD_CONFIG, ['#no_category'], available)).toEqual({
      columnKey: 'status',
      laneKey: undefined
    })
    expect(resolveBoardDimensions(DEFAULT_BOARD_CONFIG, undefined, available)).toEqual({
      columnKey: 'status',
      laneKey: undefined
    })
  })

  it('takes the group-by of the view as swimlanes', () => {
    expect(resolveBoardDimensions(DEFAULT_BOARD_CONFIG, ['assignee'], available)).toEqual({
      columnKey: 'status',
      laneKey: 'assignee'
    })
    expect(
      resolveBoardDimensions({ ...DEFAULT_BOARD_CONFIG, columnField: 'customFields.sprint' }, ['customFields.stage'], available)
    ).toEqual({ columnKey: 'customFields.sprint', laneKey: 'customFields.stage' })
  })

  it('ignores swimlanes by the field of the columns', () => {
    expect(resolveBoardDimensions(DEFAULT_BOARD_CONFIG, ['status'], available).laneKey).toBeUndefined()
    expect(
      resolveBoardDimensions({ ...DEFAULT_BOARD_CONFIG, columnField: 'customFields.stage' }, ['customFields.stage'], available)
        .laneKey
    ).toBeUndefined()
  })

  it('ignores swimlanes by a custom field that does not exist or cannot be grouped by', () => {
    expect(resolveBoardDimensions(DEFAULT_BOARD_CONFIG, ['customFields.gone'], available).laneKey).toBeUndefined()
    expect(resolveBoardDimensions(DEFAULT_BOARD_CONFIG, ['customFields.effort'], available).laneKey).toBeUndefined()
    expect(resolveBoardDimensions(DEFAULT_BOARD_CONFIG, ['customFields.sprint'], available).laneKey).toBe(
      'customFields.sprint'
    )
  })

  it('falls back to the status when the column field does not exist', () => {
    expect(
      resolveBoardDimensions({ ...DEFAULT_BOARD_CONFIG, columnField: 'customFields.gone' }, [], available).columnKey
    ).toBe('status')
    expect(
      resolveBoardDimensions({ ...DEFAULT_BOARD_CONFIG, columnField: 'customFields.effort' }, [], available).columnKey
    ).toBe('status')
  })
})

describe('storing the board config in the view options', () => {
  const custom = { ...DEFAULT_BOARD_CONFIG, columnField: 'customFields.stage' }

  it('does not store the default config', () => {
    expect(withBoardConfig({ groupBy: ['x'], [BOARD_OPTION_KEY]: custom }, DEFAULT_BOARD_CONFIG)).toEqual({
      groupBy: ['x']
    })
    expect(isDefaultBoardConfig(DEFAULT_BOARD_CONFIG)).toBe(true)
    expect(isDefaultBoardConfig(custom)).toBe(false)
  })

  it('stores and reads a custom config', () => {
    const options = withBoardConfig({ groupBy: ['x'] }, custom)
    expect((options as Record<string, unknown>)[BOARD_OPTION_KEY]).toEqual(custom)
    expect(readBoardConfig(options)).toEqual(custom)
    expect(readBoardConfig(undefined)).toEqual(DEFAULT_BOARD_CONFIG)
  })

  it('does not change the options it was given', () => {
    const options = { groupBy: ['x'] }
    withBoardConfig(options, custom)
    expect(options).toEqual({ groupBy: ['x'] })
  })

  it('takes part in the unsaved changes of a saved view', () => {
    const saved = { viewOptions: { groupBy: ['#no_category'], orderBy: ['modifiedOn', -1] } }
    expect(isViewDirty(saved, { viewOptions: withBoardConfig(saved.viewOptions, DEFAULT_BOARD_CONFIG) })).toBe(false)

    const changed = withBoardConfig(saved.viewOptions, withColumnLimit(DEFAULT_BOARD_CONFIG, 'status', 'Todo', 3))
    expect(isViewDirty(saved, { viewOptions: changed })).toBe(true)

    // Changing it back makes the view clean again
    const back = withBoardConfig(changed, withColumnLimit(readBoardConfig(changed), 'status', 'Todo', undefined))
    expect(isViewDirty(saved, { viewOptions: back })).toBe(false)

    const hidden = withBoardConfig(saved.viewOptions, withColumnHidden(DEFAULT_BOARD_CONFIG, 'status', 'Done', true))
    expect(isViewDirty(saved, { viewOptions: hidden })).toBe(true)
    const column = withBoardConfig(saved.viewOptions, custom)
    expect(isViewDirty(saved, { viewOptions: column })).toBe(true)
  })
})
