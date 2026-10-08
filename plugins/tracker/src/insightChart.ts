//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Doc, Ref } from '@hcengineering/core'
import type { Project } from './index'

/**
 * Layouts of an Insights chart, the same six as in GitHub Projects.
 * @public
 */
export type InsightLayout = 'bar' | 'column' | 'stackedBar' | 'stackedColumn' | 'stackedArea' | 'line'

/**
 * How the values of the items of a bucket are combined into the Y value.
 * @public
 */
export type InsightAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'

/**
 * Y-axis of a chart: the number of items, or an aggregate of a number field.
 * @public
 */
export interface InsightYAxis {
  type: InsightAggregate
  // Id of the number field (see `chartFieldId` in tracker-resources); absent for `count`
  field?: string
}

/**
 * Size of the buckets of a date X-axis.
 * @public
 */
export type InsightDateBucket = 'day' | 'week' | 'month'

/**
 * A saved chart of the project Insights (current charts only: the chart is computed from the issues as they are
 * now, there is no history). The `space` is the project.
 * @public
 */
export interface InsightChart extends Doc {
  space: Ref<Project>
  name: string
  layout: InsightLayout
  // Id of the field of the X-axis (see `chartFieldId` in tracker-resources)
  xField: string
  // Buckets of a date X-axis; null once cleared (an update cannot remove a property)
  xBucket?: InsightDateBucket | null
  // Id of the field that makes the series; absent or null = a single series
  groupField?: string | null
  yAggregate: InsightYAxis
  // GitHub-style filter string
  filter: string
  // Order in the sidebar
  position: number
}
