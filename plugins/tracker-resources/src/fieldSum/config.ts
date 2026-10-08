//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ProjectField } from '@hcengineering/tracker'
import { ProjectFieldType } from '@hcengineering/tracker'
import { parseCustomFieldViewKey, toCustomFieldViewKey } from '../projectFields/query'

/**
 * Number fields whose sum a view shows ("Field sum" of GitHub Projects). The keys are stored in the view options
 * under `FIELD_SUMS_OPTION_KEY`, so that they are saved with the saved view, restored when it is opened and take
 * part in its unsaved-changes tracking (the same way as the roadmap and board settings).
 *
 * A key is the view key of the field: `estimation` for the estimation of an issue and `customFields.<key>` for a
 * Number custom field.
 */
export const FIELD_SUMS_OPTION_KEY = 'fieldSums'

/** View key of the built-in number field, the estimation of an issue. */
export const ESTIMATION_SUM_KEY = 'estimation'

/** A number field of an issue that can be summed. */
export interface SummableField {
  // View key, see above
  key: string
  // Already translated
  label: string
  // Raw value of the field in an issue; anything that is not a finite number is ignored by the sums
  read: (doc: any) => unknown
}

/** Keys that are stored: unique, in the order they were chosen, empty ones dropped. */
export function normalizeFieldSums (raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const res: string[] = []
  for (const key of raw) {
    if (typeof key === 'string' && key !== '' && !res.includes(key)) res.push(key)
  }
  return res
}

export function readFieldSums (viewOptions: Record<string, any> | undefined): string[] {
  return normalizeFieldSums(viewOptions?.[FIELD_SUMS_OPTION_KEY])
}

/** The view options with the keys stored. Nothing is stored for an empty list, so a view without sums stays clean. */
export function withFieldSums<O extends Record<string, any>> (options: O, keys: readonly string[]): O {
  const next: Record<string, any> = { ...options }
  const own = normalizeFieldSums(keys)
  if (own.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[FIELD_SUMS_OPTION_KEY]
  } else {
    next[FIELD_SUMS_OPTION_KEY] = own
  }
  return next as O
}

/** The keys with one switched on or off; a field that is switched on goes last. */
export function toggleFieldSum (keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((it) => it !== key) : [...keys, key]
}

/**
 * Number fields a view can sum: the estimation of the issue first, then the Number custom fields of the project in
 * the order of the project.
 */
export function buildSummableFields (
  fields: ReadonlyArray<Pick<ProjectField, 'key' | 'label' | 'type'>>,
  estimationLabel: string
): SummableField[] {
  return [
    { key: ESTIMATION_SUM_KEY, label: estimationLabel, read: (doc) => doc?.estimation },
    ...fields
      .filter((f) => f.type === ProjectFieldType.Number)
      .map((f) => ({
        key: toCustomFieldViewKey(f.key),
        label: f.label,
        read: (doc: any) => doc?.customFields?.[f.key]
      }))
  ]
}

/** The chosen fields that exist, in the order they were chosen. A deleted field is left out (it stays in the view). */
export function resolveFieldSums (keys: readonly string[], available: readonly SummableField[]): SummableField[] {
  const byKey = new Map(available.map((f) => [f.key, f]))
  const res: SummableField[] = []
  for (const key of keys) {
    const field = byKey.get(key)
    if (field !== undefined) res.push(field)
  }
  return res
}

/** Document properties that the sums of the keys read. */
export function sumProjection (keys: readonly string[]): string[] {
  const res = new Set<string>()
  for (const key of keys) {
    if (key === ESTIMATION_SUM_KEY) res.add('estimation')
    else if (parseCustomFieldViewKey(key) !== undefined) res.add('customFields')
  }
  return [...res]
}
