//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Data } from '@hcengineering/core'
import type { InsightAggregate, InsightChart, InsightDateBucket, InsightLayout, InsightYAxis } from '@hcengineering/tracker'
import type { ChartFields } from './fields'

/**
 * The configuration of an Insights chart (what a saved `InsightChart` stores besides its name and position).
 * It is also what the configuration panel edits: the draft is compared with the saved chart to tell whether
 * there are unsaved changes.
 */
export interface ChartConfig {
  layout: InsightLayout
  // Id of the field of the X-axis, see `chartFieldId`
  xField: string
  // Buckets of a date X-axis
  xBucket?: InsightDateBucket
  // Id of the field that makes the series
  groupField?: string
  yAggregate: InsightYAxis
  // GitHub-style filter string
  filter: string
}

/** The six layouts of GitHub, in the order the layout menu lists them. */
export const INSIGHT_LAYOUTS: readonly InsightLayout[] = ['bar', 'column', 'stackedBar', 'stackedColumn', 'stackedArea', 'line']

export const INSIGHT_AGGREGATES: readonly InsightAggregate[] = ['count', 'sum', 'avg', 'min', 'max']

export const INSIGHT_DATE_BUCKETS: readonly InsightDateBucket[] = ['day', 'week', 'month']

/** Id of the chart that is shown before any chart is saved (it exists only until the first one is saved). */
export const DEFAULT_CHART_ID = 'default-chart'

/** Buckets of a date X-axis until the user picks another size. */
export const DEFAULT_DATE_BUCKET: InsightDateBucket = 'week'

/** The id of the Status field, the X-axis of the default chart. */
export const STATUS_FIELD_ID = 'status'

/** The default chart: "Issues by status", a column chart with the count of items. */
export function defaultChartConfig (): ChartConfig {
  return { layout: 'column', xField: STATUS_FIELD_ID, yAggregate: { type: 'count' }, filter: '' }
}

function isRecord (raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
}

function oneOf<T extends string> (list: readonly T[], raw: unknown): T | undefined {
  return typeof raw === 'string' && (list as readonly string[]).includes(raw) ? (raw as T) : undefined
}

/** Whether the layout is drawn over a continuous axis (a date can be the X-axis). */
export function allowsDateAxis (layout: InsightLayout): boolean {
  return layout === 'line' || layout === 'stackedArea'
}

/** Whether the layout puts the series on top of each other. */
export function isStackedLayout (layout: InsightLayout): boolean {
  return layout === 'stackedBar' || layout === 'stackedColumn' || layout === 'stackedArea'
}

/** Whether the categories run down the vertical axis. */
export function isHorizontalLayout (layout: InsightLayout): boolean {
  return layout === 'bar' || layout === 'stackedBar'
}

/** Whether the layout is a bar layout (as opposed to a line or an area). */
export function isBarLayout (layout: InsightLayout): boolean {
  return !allowsDateAxis(layout)
}

/**
 * Turns whatever is stored (an older or damaged doc) into a config; a part that is not valid gets its default.
 */
export function normalizeChartConfig (raw: unknown): ChartConfig {
  const base = defaultChartConfig()
  if (!isRecord(raw)) return base
  const y = isRecord(raw.yAggregate) ? raw.yAggregate : {}
  const type = oneOf(INSIGHT_AGGREGATES, y.type) ?? 'count'
  const yField = typeof y.field === 'string' && y.field !== '' ? y.field : undefined
  const bucket = oneOf(INSIGHT_DATE_BUCKETS, raw.xBucket)
  return {
    layout: oneOf(INSIGHT_LAYOUTS, raw.layout) ?? base.layout,
    xField: typeof raw.xField === 'string' && raw.xField !== '' ? raw.xField : base.xField,
    ...(bucket !== undefined ? { xBucket: bucket } : {}),
    ...(typeof raw.groupField === 'string' && raw.groupField !== '' ? { groupField: raw.groupField } : {}),
    yAggregate: type === 'count' || yField === undefined ? { type: 'count' } : { type, field: yField },
    filter: typeof raw.filter === 'string' ? raw.filter : ''
  }
}

/** The configuration of a saved chart. */
export function configOfChart (chart: Pick<InsightChart, 'layout' | 'xField' | 'xBucket' | 'groupField' | 'yAggregate' | 'filter'>): ChartConfig {
  return normalizeChartConfig(chart)
}

/**
 * The part of the config in the form it is stored and compared in: absent values are left out, the filter is
 * trimmed (whitespace around it is not a change), and a bucket is kept only while the X-axis can use it.
 */
function canonical (config: ChartConfig, fields?: ChartFields): Record<string, unknown> {
  const c = normalizeChartConfig(config)
  const usesBucket = fields === undefined ? c.xBucket !== undefined : fields.byId.get(c.xField)?.kind === 'date'
  return {
    layout: c.layout,
    xField: c.xField,
    xBucket: usesBucket ? (c.xBucket ?? DEFAULT_DATE_BUCKET) : undefined,
    groupField: c.groupField,
    yAggregate: c.yAggregate.type === 'count' ? { type: 'count' } : c.yAggregate,
    filter: c.filter.trim()
  }
}

/**
 * Whether the draft differs from the baseline (the saved chart, or the default one): the unsaved changes dot.
 * A setting that is changed and changed back is clean again.
 */
export function isChartDirty (baseline: ChartConfig, current: ChartConfig, fields?: ChartFields): boolean {
  return JSON.stringify(canonical(baseline, fields)) !== JSON.stringify(canonical(current, fields))
}

/**
 * The config that is drawn: what the fields of the project allow. A field that does not exist any more (or that the
 * layout cannot use) falls back, without anything being rewritten in the saved chart.
 */
export function resolveChartConfig (config: ChartConfig, fields: ChartFields): ChartConfig {
  const c = normalizeChartConfig(config)
  const x = fields.byId.get(c.xField)
  const xOk = x !== undefined && (x.kind === 'category' || (x.kind === 'date' && allowsDateAxis(c.layout)))
  const xField = xOk ? c.xField : (fields.axis.find((f) => f.kind === 'category')?.id ?? c.xField)
  const xKind = fields.byId.get(xField)?.kind
  const group = c.groupField !== undefined ? fields.byId.get(c.groupField) : undefined
  const groupField = group?.kind === 'category' && c.groupField !== xField ? c.groupField : undefined
  const yField = c.yAggregate.field !== undefined ? fields.byId.get(c.yAggregate.field) : undefined
  const yAggregate: InsightYAxis = c.yAggregate.type !== 'count' && yField?.kind === 'number' ? c.yAggregate : { type: 'count' }
  return {
    layout: c.layout,
    xField,
    ...(xKind === 'date' ? { xBucket: c.xBucket ?? DEFAULT_DATE_BUCKET } : {}),
    ...(groupField !== undefined ? { groupField } : {}),
    yAggregate,
    filter: c.filter
  }
}

/** The config with another layout; a date X-axis that the layout cannot draw goes back to the first category field. */
export function withLayout (config: ChartConfig, layout: InsightLayout, fields: ChartFields): ChartConfig {
  const next = { ...config, layout }
  const x = fields.byId.get(config.xField)
  if (x?.kind === 'date' && !allowsDateAxis(layout)) {
    const first = fields.axis.find((f) => f.kind === 'category')
    if (first !== undefined) return withXField({ ...next }, first.id, fields)
  }
  return next
}

/** The config with another X-axis field; the series field cannot be the same field, the bucket goes with a date. */
export function withXField (config: ChartConfig, xField: string, fields: ChartFields): ChartConfig {
  const next: ChartConfig = { ...config, xField }
  if (fields.byId.get(xField)?.kind === 'date') next.xBucket = config.xBucket ?? DEFAULT_DATE_BUCKET
  else delete next.xBucket
  if (next.groupField === xField) delete next.groupField
  return next
}

/** The config with another series field; `undefined` is "no grouping". */
export function withGroupField (config: ChartConfig, groupField: string | undefined): ChartConfig {
  const next: ChartConfig = { ...config }
  if (groupField === undefined || groupField === config.xField) delete next.groupField
  else next.groupField = groupField
  return next
}

/** The config with another Y-axis; the number field is dropped for the count. */
export function withYAxis (config: ChartConfig, type: InsightAggregate, field: string | undefined): ChartConfig {
  return { ...config, yAggregate: type === 'count' || field === undefined ? { type: 'count' } : { type, field } }
}

/** The values a new chart document is created with. */
export function chartDocData (name: string, config: ChartConfig, position: number): Data<InsightChart> {
  const c = normalizeChartConfig(config)
  return {
    name,
    layout: c.layout,
    xField: c.xField,
    ...(c.xBucket !== undefined ? { xBucket: c.xBucket } : {}),
    ...(c.groupField !== undefined ? { groupField: c.groupField } : {}),
    yAggregate: c.yAggregate,
    filter: c.filter.trim(),
    position
  }
}

/**
 * The values an update of a saved chart writes. A cleared setting is written as `null`, because an update that leaves
 * a property out (or sets it to undefined) does not remove it.
 */
export function chartDocUpdate (config: ChartConfig): Pick<InsightChart, 'layout' | 'xField' | 'xBucket' | 'groupField' | 'yAggregate' | 'filter'> {
  const c = normalizeChartConfig(config)
  return {
    layout: c.layout,
    xField: c.xField,
    xBucket: c.xBucket ?? null,
    groupField: c.groupField ?? null,
    yAggregate: c.yAggregate,
    filter: c.filter.trim()
  }
}

/** Order value for a chart appended after the others. */
export function nextChartPosition (charts: ReadonlyArray<Pick<InsightChart, 'position'>>): number {
  let max = -1
  for (const chart of charts) if (chart.position > max) max = chart.position
  return max + 1
}

/** The charts in the order of the sidebar: by position, ties by creation time. */
export function sortCharts<T extends Pick<InsightChart, 'position'> & { createdOn?: number }> (charts: readonly T[]): T[] {
  return [...charts].sort((a, b) => a.position - b.position || (a.createdOn ?? 0) - (b.createdOn ?? 0))
}
