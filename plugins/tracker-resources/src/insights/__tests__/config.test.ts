//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import {
  allowsDateAxis,
  chartDocData,
  defaultChartConfig,
  INSIGHT_LAYOUTS,
  isChartDirty,
  isHorizontalLayout,
  isStackedLayout,
  nextChartPosition,
  normalizeChartConfig,
  resolveChartConfig,
  sortCharts,
  withGroupField,
  withLayout,
  withXField,
  withYAxis
} from '../config'
import { makeFields } from './fixtures'

const fields = makeFields()

describe('layouts', () => {
  it('offers exactly the six GitHub layouts', () => {
    expect(INSIGHT_LAYOUTS).toEqual(['bar', 'column', 'stackedBar', 'stackedColumn', 'stackedArea', 'line'])
  })

  it('knows stacked, horizontal and continuous layouts', () => {
    expect(INSIGHT_LAYOUTS.filter(isStackedLayout)).toEqual(['stackedBar', 'stackedColumn', 'stackedArea'])
    expect(INSIGHT_LAYOUTS.filter(isHorizontalLayout)).toEqual(['bar', 'stackedBar'])
    expect(INSIGHT_LAYOUTS.filter(allowsDateAxis)).toEqual(['stackedArea', 'line'])
  })
})

describe('normalizeChartConfig', () => {
  it('gives the default for anything that is not a config', () => {
    expect(normalizeChartConfig(undefined)).toEqual(defaultChartConfig())
    expect(normalizeChartConfig('x')).toEqual(defaultChartConfig())
    expect(normalizeChartConfig([])).toEqual(defaultChartConfig())
  })

  it('repairs the parts that are not valid', () => {
    const res = normalizeChartConfig({
      layout: 'pie',
      xField: '',
      groupField: '',
      yAggregate: { type: 'median', field: 5 },
      filter: 7,
      xBucket: 'year'
    })
    expect(res).toEqual(defaultChartConfig())
  })

  it('keeps a valid config and drops the number field of the count', () => {
    expect(
      normalizeChartConfig({
        layout: 'line',
        xField: 'due',
        xBucket: 'month',
        groupField: 'status',
        yAggregate: { type: 'sum', field: 'estimate' },
        filter: 'is:open'
      })
    ).toEqual({
      layout: 'line',
      xField: 'due',
      xBucket: 'month',
      groupField: 'status',
      yAggregate: { type: 'sum', field: 'estimate' },
      filter: 'is:open'
    })
    expect(normalizeChartConfig({ yAggregate: { type: 'count', field: 'estimate' } }).yAggregate).toEqual({ type: 'count' })
    // A sum without a field cannot be computed
    expect(normalizeChartConfig({ yAggregate: { type: 'sum' } }).yAggregate).toEqual({ type: 'count' })
  })
})

describe('isChartDirty', () => {
  const base = defaultChartConfig()

  it('is clean for the same config, whitespace around the filter and absent values', () => {
    expect(isChartDirty(base, { ...base })).toBe(false)
    expect(isChartDirty(base, { ...base, filter: '  ' })).toBe(false)
    expect(isChartDirty({ ...base, filter: 'a' }, { ...base, filter: ' a ' })).toBe(false)
  })

  it('is dirty for every setting that changes', () => {
    expect(isChartDirty(base, { ...base, layout: 'bar' })).toBe(true)
    expect(isChartDirty(base, { ...base, xField: 'priority' })).toBe(true)
    expect(isChartDirty(base, { ...base, groupField: 'priority' })).toBe(true)
    expect(isChartDirty(base, { ...base, yAggregate: { type: 'sum', field: 'estimate' } })).toBe(true)
    expect(isChartDirty(base, { ...base, filter: 'is:open' })).toBe(true)
  })

  it('is clean again when a change is changed back', () => {
    const changed = withGroupField(base, 'priority')
    expect(isChartDirty(base, changed)).toBe(true)
    expect(isChartDirty(base, withGroupField(changed, undefined))).toBe(false)
  })

  it('ignores a bucket that the X-axis does not use', () => {
    expect(isChartDirty(base, { ...base, xBucket: 'month' }, fields)).toBe(false)
    const date = { ...base, layout: 'line' as const, xField: 'due' }
    expect(isChartDirty(date, { ...date, xBucket: 'month' }, fields)).toBe(true)
    // The default bucket is the same as no bucket
    expect(isChartDirty(date, { ...date, xBucket: 'week' }, fields)).toBe(false)
  })
})

describe('resolveChartConfig', () => {
  it('keeps a config the fields allow', () => {
    const config = { ...defaultChartConfig(), groupField: 'priority', yAggregate: { type: 'avg' as const, field: 'estimate' } }
    expect(resolveChartConfig(config, fields)).toEqual(config)
  })

  it('falls back to the first category field for a missing X field', () => {
    expect(resolveChartConfig({ ...defaultChartConfig(), xField: 'customFields.gone' }, fields).xField).toBe('status')
  })

  it('does not draw a date axis for a bar layout, and adds the bucket for a line', () => {
    const date = { ...defaultChartConfig(), xField: 'due' }
    expect(resolveChartConfig(date, fields).xField).toBe('status')
    const line = resolveChartConfig({ ...date, layout: 'line' }, fields)
    expect(line.xField).toBe('due')
    expect(line.xBucket).toBe('week')
  })

  it('drops a series field that is gone, is not a category or equals the X field', () => {
    expect(resolveChartConfig({ ...defaultChartConfig(), groupField: 'customFields.gone' }, fields).groupField).toBeUndefined()
    expect(resolveChartConfig({ ...defaultChartConfig(), groupField: 'due' }, fields).groupField).toBeUndefined()
    expect(resolveChartConfig({ ...defaultChartConfig(), groupField: 'status' }, fields).groupField).toBeUndefined()
  })

  it('counts when the number field of the Y-axis is gone or is not a number', () => {
    expect(
      resolveChartConfig({ ...defaultChartConfig(), yAggregate: { type: 'sum', field: 'customFields.gone' } }, fields).yAggregate
    ).toEqual({ type: 'count' })
    expect(resolveChartConfig({ ...defaultChartConfig(), yAggregate: { type: 'sum', field: 'status' } }, fields).yAggregate).toEqual({
      type: 'count'
    })
  })
})

describe('config edits', () => {
  it('moves a date X-axis back to a category field when the layout cannot draw it', () => {
    const line = withXField({ ...defaultChartConfig(), layout: 'line' }, 'due', fields)
    expect(line.xBucket).toBe('week')
    const column = withLayout(line, 'column', fields)
    expect(column.xField).toBe('status')
    expect(column.xBucket).toBeUndefined()
    // Another layout that draws dates keeps it
    expect(withLayout(line, 'stackedArea', fields).xField).toBe('due')
  })

  it('removes the series field that becomes the X field', () => {
    const config = withGroupField(defaultChartConfig(), 'priority')
    expect(withXField(config, 'priority', fields).groupField).toBeUndefined()
    expect(withGroupField(defaultChartConfig(), 'status').groupField).toBeUndefined()
  })

  it('sets the Y-axis', () => {
    expect(withYAxis(defaultChartConfig(), 'sum', 'estimate').yAggregate).toEqual({ type: 'sum', field: 'estimate' })
    expect(withYAxis(defaultChartConfig(), 'count', 'estimate').yAggregate).toEqual({ type: 'count' })
    expect(withYAxis(defaultChartConfig(), 'sum', undefined).yAggregate).toEqual({ type: 'count' })
  })
})

describe('chart documents', () => {
  it('builds the data of a new chart', () => {
    expect(chartDocData('Chart 1', { ...defaultChartConfig(), filter: ' is:open ' }, 3)).toEqual({
      name: 'Chart 1',
      layout: 'column',
      xField: 'status',
      yAggregate: { type: 'count' },
      filter: 'is:open',
      position: 3
    })
  })

  it('appends after the last position and sorts by position then creation', () => {
    expect(nextChartPosition([])).toBe(0)
    expect(nextChartPosition([{ position: 0 }, { position: 4 }])).toBe(5)
    const sorted = sortCharts([
      { id: 'c', position: 1, createdOn: 5 },
      { id: 'b', position: 0, createdOn: 9 },
      { id: 'a', position: 0, createdOn: 1 }
    ])
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })
})
