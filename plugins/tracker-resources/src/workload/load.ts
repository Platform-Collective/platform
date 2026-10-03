//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { toSummable } from '../fieldSum/sum'
import type { LoadMeasure } from './config'

/** The part of an issue the load is read from. */
export interface LoadIssue {
  // Estimation in man hours (0 is how an issue without an estimate is stored)
  estimation?: number | null
  // Remaining time in man hours
  remainingTime?: number | null
  customFields?: Record<string, unknown>
}

/**
 * The load an item puts on its assignee, in the unit of the measure: hours for the estimation and the remaining time,
 * one for the item count, the number of a Number custom field. It is never negative, `NaN`, infinite or text: such a
 * value is no load (0), so a damaged value cannot poison the sums.
 */
export function readLoad (issue: LoadIssue, measure: LoadMeasure, fieldKey?: string): number {
  let raw: unknown
  switch (measure) {
    case 'estimate':
      raw = issue.estimation
      break
    case 'remaining':
      raw = issue.remainingTime
      break
    case 'count':
      return 1
    case 'field':
      raw = fieldKey !== undefined ? issue.customFields?.[fieldKey] : undefined
      break
  }
  const n = toSummable(raw)
  return n !== undefined && n > 0 ? n : 0
}

/** Document properties that the load of a measure reads. */
export function loadProjection (measure: LoadMeasure): string[] {
  switch (measure) {
    case 'estimate':
      return ['estimation']
    case 'remaining':
      return ['remainingTime']
    case 'count':
      return []
    case 'field':
      return ['customFields']
  }
}
