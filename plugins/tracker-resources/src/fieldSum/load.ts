//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { translate } from '@hcengineering/platform'
import type { ProjectField } from '@hcengineering/tracker'
import tracker from '../plugin'
import { buildSummableFields, type SummableField } from './config'

/** The number fields a view can sum, with the translated label of the estimation. */
export async function loadSummableFields (
  fields: ReadonlyArray<Pick<ProjectField, 'key' | 'label' | 'type'>>,
  lang: string
): Promise<SummableField[]> {
  const estimation = await translate(tracker.string.Estimation, {}, lang)
  return buildSummableFields(fields, estimation)
}
