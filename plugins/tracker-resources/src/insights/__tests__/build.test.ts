//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { filterGrammar } from '@hcengineering/view-resources'
import { computeChart } from '../aggregate'
import { buildChartRequest, chartMeasure } from '../build'
import { defaultChartConfig, resolveChartConfig, type ChartConfig } from '../config'
import { cellFilter } from '../drill'
import { buildChartFields, chartFieldId, chartProjection } from '../fields'
import { customFields, makeFields, noneLabel } from './fixtures'
import { buildIssueFilterSchema } from '../../issueFilter'

const fields = makeFields()

function run (docs: any[], config: ChartConfig): ReturnType<typeof computeChart> {
  const resolved = resolveChartConfig(config, fields)
  const request = buildChartRequest(docs, resolved, fields, noneLabel)
  if (request === undefined) throw new Error('no request')
  return computeChart(request)
}

describe('buildChartFields', () => {
  it('offers the built-in category fields, then the custom ones, in the slice order', () => {
    expect(fields.groups.map((f) => f.id)).toEqual([
      'status',
      'priority',
      'assignee',
      'label',
      'component',
      'milestone',
      'customFields.size',
      'customFields.areas',
      'customFields.sprint'
    ])
  })

  it('offers dates for the X-axis only, after the category fields', () => {
    expect(fields.axis.map((f) => f.id).slice(-4)).toEqual(['due', 'start', 'deadline', 'customFields.shipped'])
    expect(fields.groups.every((f) => f.kind === 'category')).toBe(true)
    expect(fields.axis.some((f) => f.id === 'title' || f.id === 'customFields.notes')).toBe(false)
  })

  it('offers the estimation and the Number fields for the Y-axis', () => {
    expect(fields.numbers.map((f) => f.id)).toEqual(['estimate', 'customFields.points'])
  })

  it('orders statuses by the workflow, people and labels alphabetically, the rest as given', () => {
    expect(fields.byId.get('status')?.options.map((o) => o.label)).toEqual(['Todo', 'Doing', 'Done'])
    expect(fields.byId.get('assignee')?.options.map((o) => o.label)).toEqual(['Amy', 'Zed'])
    expect(fields.byId.get('customFields.size')?.options.map((o) => o.label)).toEqual(['Small', 'Medium', 'Large'])
    expect(fields.byId.get('customFields.sprint')?.options.map((o) => o.label)).toEqual(['Iteration 1', 'Iteration 2'])
  })

  it('uses the translated labels of the built-in fields', () => {
    const labels = new Map([['status', 'Статус']])
    const translated = buildChartFields({ schema: fields.byId.get('status') !== undefined ? [fields.byId.get('status')!.spec] : [], labels })
    expect(translated.byId.get('status')?.label).toBe('Статус')
  })

  it('lists the options of custom fields even when no item has them, the others only when used', () => {
    expect(fields.byId.get('customFields.size')?.includeEmpty).toBe(true)
    expect(fields.byId.get('status')?.includeEmpty).toBe(false)
  })

  it('addresses a field the way the slice panel does', () => {
    expect(chartFieldId({ name: 'size', source: 'custom', key: 'size' })).toBe('customFields.size')
    expect(chartFieldId({ name: 'status', source: 'attribute', key: 'status' })).toBe('status')
  })

  it('skips a custom field that has a name of its own already', () => {
    const schema = buildIssueFilterSchema({
      statuses: [],
      priorities: [],
      assignees: [],
      components: [],
      milestones: [],
      labels: [],
      labelRefs: [],
      customFields: [...customFields],
      noParentId: 'x'
    })
    expect(buildChartFields({ schema }).byId.size).toBeGreaterThan(5)
  })

  it('projects the properties a chart reads', () => {
    const status = fields.byId.get('status')
    const size = fields.byId.get('customFields.size')
    expect(chartProjection([status, size, undefined]).sort()).toEqual(['_id', 'customFields', 'status'])
  })
})

describe('building and computing a chart', () => {
  const issues = [
    { _id: 'i1', status: 'todo', priority: 1, estimation: 3, customFields: { size: 's', points: 5, shipped: new Date(2026, 9, 5, 10).getTime() } },
    { _id: 'i2', status: 'todo', priority: 2, estimation: 5, customFields: { size: 's', points: 1 } },
    { _id: 'i3', status: 'done', priority: 1, estimation: 8, customFields: { size: 'l', shipped: new Date(2026, 9, 20, 10).getTime() } },
    { _id: 'i4', status: 'gone', priority: 0, estimation: 'n/a' }
  ]

  it('draws the default chart: the issues by status', () => {
    const res = run(issues, defaultChartConfig())
    expect(res.categories.map((c) => c.label)).toEqual(['Todo', 'Done', 'No Status'])
    expect(res.values).toEqual([[2, 1, 1]])
  })

  it('counts by a custom field with all its options and a "No <field>" bucket', () => {
    const res = run(issues, { ...defaultChartConfig(), xField: 'customFields.size' })
    expect(res.categories.map((c) => c.label)).toEqual(['Small', 'Medium', 'Large', 'No Size'])
    expect(res.values).toEqual([[2, 0, 1, 1]])
  })

  it('stacks by another field and sums the estimation', () => {
    const res = run(issues, {
      ...defaultChartConfig(),
      layout: 'stackedColumn',
      groupField: 'priority',
      yAggregate: { type: 'sum', field: 'estimate' }
    })
    expect(res.series.map((s) => s.label)).toEqual(['No priority', 'Urgent', 'High'])
    // Todo: urgent 3, high 5; Done: urgent 8; No Status: no priority (the text estimate is ignored)
    expect(res.values).toEqual([
      [0, 0, 0],
      [3, 8, 0],
      [5, 0, 0]
    ])
  })

  it('averages a Number custom field and leaves the empty cells without value', () => {
    const res = run(issues, { ...defaultChartConfig(), yAggregate: { type: 'avg', field: 'customFields.points' } })
    expect(res.values).toEqual([[3, null, null]])
  })

  it('buckets a date field for a line', () => {
    const res = run(issues, { ...defaultChartConfig(), layout: 'line', xField: 'customFields.shipped', xBucket: 'week' })
    expect(res.categories.map((c) => c.label)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', 'No Shipped'])
    expect(res.values).toEqual([[1, 0, 1, 2]])
  })

  it('reads the labels of the issues from the label references', () => {
    const res = run(
      [{ _id: 'i1' }, { _id: 'i2' }, { _id: 'i3' }],
      { ...defaultChartConfig(), xField: 'label' }
    )
    expect(res.categories.map((c) => c.label)).toEqual(['bug', 'ui', 'No Label'])
    expect(res.values).toEqual([[2, 1, 1]])
  })

  it('has no request for a number field on the X-axis or an unknown field', () => {
    expect(buildChartRequest([], { ...defaultChartConfig(), xField: 'estimate' }, fields, noneLabel)).toBeUndefined()
    expect(buildChartRequest([], { ...defaultChartConfig(), xField: 'nope' }, fields, noneLabel)).toBeUndefined()
  })

  it('counts when the measure has no number field', () => {
    expect(chartMeasure({ ...defaultChartConfig(), yAggregate: { type: 'sum', field: 'nope' } }, fields)).toEqual({ type: 'count' })
  })
})

describe('cellFilter', () => {
  const config: ChartConfig = { ...defaultChartConfig(), filter: 'is:open', groupField: 'priority' }
  const resolved = resolveChartConfig(config, fields)
  const schema = fields.axis.map((f) => f.spec)

  function filterOf (cfg: ChartConfig, docs: any[], category: number, series: number): string {
    const res = resolveChartConfig(cfg, fields)
    const data = computeChart(buildChartRequest(docs, res, fields, noneLabel) as any)
    return cellFilter(res, fields, data.categories[category], data.series[series])
  }

  it('adds the bucket and the series to the filter of the chart', () => {
    const docs = [{ _id: 'i1', status: 'todo', priority: 1 }]
    expect(filterOf(config, docs, 0, 0)).toBe('is:open status:Todo priority:Urgent')
  })

  it('addresses the items without a value with no:', () => {
    const docs = [{ _id: 'i1', priority: 1 }]
    expect(filterOf(config, docs, 0, 0)).toBe('is:open no:status priority:Urgent')
    const other = [{ _id: 'i1', status: 'todo' }]
    expect(filterOf(config, other, 0, 0)).toBe('is:open status:Todo no:priority')
  })

  it('quotes values that need it', () => {
    const docs = [{ _id: 'i1', customFields: { sprint: 'it2' } }]
    const res = filterOf({ ...defaultChartConfig(), xField: 'customFields.sprint' }, docs, 1, 0)
    expect(res).toBe('sprint:"Iteration 2"')
    expect(filterGrammar.parseFilter(res, schema).ok).toBe(true)
  })

  it('uses the day range of a date bucket, and the filter parses and selects the items of the bucket', () => {
    const inside = new Date(2026, 9, 7, 10).getTime()
    const outside = new Date(2026, 9, 14, 10).getTime()
    const docs = [{ _id: 'a', customFields: { shipped: inside } }, { _id: 'b', customFields: { shipped: outside } }]
    const cfg = { ...defaultChartConfig(), layout: 'line' as const, xField: 'customFields.shipped', xBucket: 'week' as const }
    const text = filterOf(cfg, docs, 0, 0)
    expect(text).toBe('shipped:2026-10-05..2026-10-11')
    const parsed = filterGrammar.parseFilter(text, schema)
    if (parsed.ok === false) throw new Error('filter does not parse')
    const match = filterGrammar.createPredicate(parsed.value, { now: Date.now() })
    expect(docs.filter(match).map((d) => d._id)).toEqual(['a'])
  })

  it('produces filters that the grammar parses for the none bucket as well', () => {
    const text = filterOf({ ...defaultChartConfig() }, [{ _id: 'i1' }], 0, 0)
    expect(text).toBe('no:status')
    expect(filterGrammar.parseFilter(text, schema).ok).toBe(true)
    expect(resolved.groupField).toBe('priority')
  })
})
