//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { filterGrammar } from '@hcengineering/view-resources'
import type { SummableField } from '../fieldSum/config'
import { computeFieldSums, formatFieldSums } from '../fieldSum/sum'
import { SLICE_NONE } from './config'
import { optionIdSet, sliceValueIds } from './values'

type FieldSpec = filterGrammar.FieldSpec

/** Key of the sums of all the items ("All") in the result of `collectSliceSums`. */
export const SLICE_ALL = '__all__'

/**
 * The sums of the chosen number fields for every value of the slice panel, as text by value id (`SLICE_NONE` for the
 * items without a value, `SLICE_ALL` for all of them). An item with several values (labels) counts for each of them,
 * as it does in the counts. Nothing is returned for no fields.
 */
export function collectSliceSums (
  spec: FieldSpec,
  docs: readonly unknown[],
  fields: readonly SummableField[]
): Map<string, string> {
  const res = new Map<string, string>()
  if (fields.length === 0) return res
  const known = optionIdSet(spec)
  const buckets = new Map<string, unknown[]>()
  for (const doc of docs) {
    const ids = sliceValueIds(spec, doc, known)
    for (const id of ids.length === 0 ? [SLICE_NONE] : ids) {
      const list = buckets.get(id)
      if (list === undefined) buckets.set(id, [doc])
      else list.push(doc)
    }
  }
  for (const [id, list] of buckets) {
    const text = formatFieldSums(computeFieldSums(list, fields), false)
    if (text !== undefined) res.set(id, text)
  }
  const all = formatFieldSums(computeFieldSums(docs, fields), false)
  if (all !== undefined) res.set(SLICE_ALL, all)
  return res
}
