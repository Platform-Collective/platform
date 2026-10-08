//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { filterGrammar } from '@hcengineering/view-resources'
import { toCustomFieldViewKey } from '../projectFields/query'
import type { SliceConfig } from './config'

type FieldSpec = filterGrammar.FieldSpec

/** Built-in fields that can be sliced, in the order they are offered; the custom fields follow. */
export const BUILTIN_SLICE_FIELDS: readonly string[] = ['status', 'priority', 'assignee', 'label', 'component', 'milestone']

/**
 * Id of a field in the slice settings: the filter name of a built-in field, `customFields.<key>` for a custom one
 * (its filter name follows its label, the key does not change when it is renamed).
 */
export function sliceFieldId (spec: Pick<FieldSpec, 'name' | 'source' | 'key'>): string {
  return spec.source === 'custom' ? toCustomFieldViewKey(spec.key) : spec.name
}

function isSliceable (spec: FieldSpec): boolean {
  if (spec.source === 'custom') {
    return spec.type === 'select' || spec.type === 'multi' || spec.type === 'iteration'
  }
  return BUILTIN_SLICE_FIELDS.includes(spec.name)
}

/**
 * The fields of the filter schema a view can be sliced by: the built-in ones and the single select, multi select
 * and iteration fields of the project. Title, dates, numbers and text cannot be sliced (GitHub parity).
 */
export function buildSliceFields (schema: readonly FieldSpec[]): FieldSpec[] {
  const builtin = BUILTIN_SLICE_FIELDS.map((name) => schema.find((f) => f.source === 'attribute' && f.name === name)).filter(
    (f): f is FieldSpec => f !== undefined
  )
  return [...builtin, ...schema.filter((f) => f.source === 'custom' && isSliceable(f))]
}

/** The field of the settings; undefined when it does not exist (any more). */
export function resolveSliceField (config: SliceConfig | undefined, fields: readonly FieldSpec[]): FieldSpec | undefined {
  if (config === undefined) return undefined
  return fields.find((f) => sliceFieldId(f) === config.field)
}

/** The field a panel starts with: the first one offered. */
export function defaultSliceField (fields: readonly FieldSpec[]): FieldSpec | undefined {
  return fields[0]
}

/** Document properties a client evaluation of the field reads, for projecting a scan. */
export function sliceProjection (spec: FieldSpec): string[] {
  const res = new Set<string>(['_id'])
  res.add(spec.source === 'custom' ? 'customFields' : spec.key)
  for (const dependency of spec.dependsOn ?? []) res.add(dependency)
  return [...res]
}

/**
 * Whether the values of the field that no item has are listed (with a count of 0). The fields whose values belong to
 * the project (its custom fields) list all of them; the others (a status of another project, every person of the
 * workspace) list the values that are in use.
 */
export function listsEmptyValues (spec: Pick<FieldSpec, 'source'>): boolean {
  return spec.source === 'custom'
}
