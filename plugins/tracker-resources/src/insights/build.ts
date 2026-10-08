//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { filterGrammar } from '@hcengineering/view-resources'
import { optionIdSet, sliceValueIds } from '../slice/values'
import type { CategoryDimension, ChartRequest, DateDimension, Measure } from './aggregate'
import type { ChartConfig } from './config'
import { DEFAULT_DATE_BUCKET } from './config'
import type { ChartField, ChartFields } from './fields'

/** The dimension of a category field: its options in axis order and the options an item has. */
export function categoryDimension (field: ChartField, noneLabel: string): CategoryDimension {
  const known = optionIdSet(field.spec)
  return {
    kind: 'category',
    options: field.options,
    includeEmpty: field.includeEmpty,
    ids: (doc) => sliceValueIds(field.spec, doc, known),
    noneLabel
  }
}

/** The dimension of a date field: the moment of an item, bucketed. A value that is not a finite number is no date. */
export function dateDimension (field: ChartField, bucket: DateDimension['bucket'], noneLabel: string): DateDimension {
  return {
    kind: 'date',
    bucket,
    read: (doc) => {
      const raw = filterGrammar.readFieldValue(field.spec, doc)
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
    },
    noneLabel
  }
}

/**
 * What the Y-axis computes. `config` must be resolved (`resolveChartConfig`), so that the number field exists.
 */
export function chartMeasure (config: ChartConfig, fields: ChartFields): Measure {
  const type = config.yAggregate.type
  if (type === 'count') return { type }
  const field = config.yAggregate.field !== undefined ? fields.byId.get(config.yAggregate.field) : undefined
  if (field === undefined) return { type: 'count' }
  return { type, read: (doc) => filterGrammar.readFieldValue(field.spec, doc) }
}

/**
 * The request for `computeChart` for a resolved config over the scanned issues; undefined when the X-axis field
 * does not exist.
 * @param noneLabel the translated "No <field>" for a field label
 */
export function buildChartRequest (
  docs: readonly unknown[],
  config: ChartConfig,
  fields: ChartFields,
  noneLabel: (fieldLabel: string) => string
): ChartRequest | undefined {
  const x = fields.byId.get(config.xField)
  if (x === undefined || x.kind === 'number') return undefined
  const group = config.groupField !== undefined ? fields.byId.get(config.groupField) : undefined
  return {
    docs,
    x:
      x.kind === 'date'
        ? dateDimension(x, config.xBucket ?? DEFAULT_DATE_BUCKET, noneLabel(x.label))
        : categoryDimension(x, noneLabel(x.label)),
    group: group?.kind === 'category' ? categoryDimension(group, noneLabel(group.label)) : undefined,
    measure: chartMeasure(config, fields)
  }
}
