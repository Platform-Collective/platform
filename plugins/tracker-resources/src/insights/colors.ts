//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { getPlatformColor } from '@hcengineering/ui'
import type { ChartSeries } from './aggregate'

/** Color of the series without a value ("No <field>"): neutral, so that it never looks like a real value. */
export const NONE_SERIES_COLOR = 'var(--theme-dark-color)'

/**
 * Color of a series: a color of the platform palette by the position of the series (stable while the options of the
 * field keep their order), a neutral one for "No <field>".
 */
export function seriesColor (series: Pick<ChartSeries, 'none'>, index: number, dark: boolean): string {
  return series.none ? NONE_SERIES_COLOR : getPlatformColor(index, dark)
}
