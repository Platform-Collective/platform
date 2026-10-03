//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { filterGrammar } from '@hcengineering/view-resources'
import { bucketDayRange, CHART_NONE, type ChartCategory, type ChartSeries } from './aggregate'
import { DEFAULT_DATE_BUCKET, type ChartConfig } from './config'
import type { ChartField, ChartFields } from './fields'

function termFor (query: string, field: ChartField, value: string | undefined, none: boolean): string {
  if (none || value === undefined) return filterGrammar.appendTerm(query, 'no', field.spec.name)
  return filterGrammar.appendTerm(query, field.spec.name, value)
}

/**
 * The filter string that selects the issues of a bar, a point or a segment: the filter of the chart, the bucket of the
 * X-axis and the series. Applying it to the project view lists the issues behind the number.
 */
export function cellFilter (
  config: ChartConfig,
  fields: ChartFields,
  category: ChartCategory,
  series: ChartSeries | undefined
): string {
  let query = config.filter.trim()
  const x = fields.byId.get(config.xField)
  if (x !== undefined) {
    if (x.kind === 'date' && !category.none && category.start !== undefined) {
      const { from, to } = bucketDayRange(category.start, config.xBucket ?? DEFAULT_DATE_BUCKET)
      query = filterGrammar.appendTerm(query, x.spec.name, `${from}..${to}`)
    } else {
      query = termFor(query, x, category.label, category.none || category.id === CHART_NONE)
    }
  }
  const group = config.groupField !== undefined ? fields.byId.get(config.groupField) : undefined
  if (group !== undefined && series !== undefined) {
    query = termFor(query, group, series.label, series.none)
  }
  return query
}
