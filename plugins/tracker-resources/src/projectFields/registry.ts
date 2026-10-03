//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ProjectField, ProjectFieldValue } from '@hcengineering/tracker'
import { getFieldValue } from '@hcengineering/tracker'

/**
 * Immutable lookup of a project's field definitions.
 */
export interface ProjectFieldRegistry {
  // Fields ordered by position
  fields: ProjectField[]
  byKey: Map<string, ProjectField>
}

/**
 * Order fields by position, falling back to creation time for equal positions.
 */
export function sortFields (fields: readonly ProjectField[]): ProjectField[] {
  return [...fields].sort((a, b) => a.position - b.position || (a.createdOn ?? 0) - (b.createdOn ?? 0))
}

export function buildRegistry (fields: readonly ProjectField[]): ProjectFieldRegistry {
  const sorted = sortFields(fields)
  return { fields: sorted, byKey: new Map(sorted.map((f) => [f.key, f])) }
}

/**
 * Resolve a key stored in issue.customFields to its definition.
 */
export function resolveField (registry: ProjectFieldRegistry, key: string): ProjectField | undefined {
  return registry.byKey.get(key)
}

/**
 * Position for a field appended after all existing ones.
 */
export function nextFieldPosition (fields: readonly ProjectField[]): number {
  return fields.reduce((max, f) => Math.max(max, f.position), -1) + 1
}

/**
 * Compute position updates that move a field one step up (-1) or down (1).
 * Positions are renumbered densely so duplicates never persist.
 * Returns an empty list when the move is not possible.
 */
export function computeMove (
  fields: readonly ProjectField[],
  id: ProjectField['_id'],
  direction: -1 | 1
): Array<{ id: ProjectField['_id'], position: number }> {
  const sorted = sortFields(fields)
  const from = sorted.findIndex((f) => f._id === id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= sorted.length) return []
  const order = [...sorted]
  ;[order[from], order[to]] = [order[to], order[from]]
  return order.map((f, position) => ({ id: f._id, position })).filter((u) => sorted.find((f) => f._id === u.id)?.position !== u.position)
}

/**
 * Merge a new value into a customFields record. Empty values remove the key.
 */
export function mergeCustomFieldValue (
  customFields: Record<string, unknown> | undefined,
  key: string,
  value: ProjectFieldValue | undefined
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(customFields ?? {}) }
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[key]
  } else {
    next[key] = value
  }
  return next
}

/**
 * Read an issue's value for a field through the registry.
 */
export function readIssueValue (
  registry: ProjectFieldRegistry,
  customFields: Record<string, unknown> | undefined,
  key: string
): ProjectFieldValue {
  const field = resolveField(registry, key)
  return field === undefined ? null : getFieldValue(customFields, field)
}
