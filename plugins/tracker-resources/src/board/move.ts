//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { deepEqual } from 'fast-equals'
import { mergeCustomFieldValue } from '../projectFields/registry'

/**
 * What dropping a card on a column (and a swimlane) writes. Every axis of the board is a field: a built-in
 * attribute of the issue, or a custom field stored in `Issue.customFields`.
 */
export type DropTarget =
  | { kind: 'attribute', key: string, value: unknown }
  | { kind: 'custom', fieldKey: string, value: string | undefined }

export type DropUpdate = Record<string, unknown>

/**
 * The update that puts an issue where it was dropped: the targets of the column and of the swimlane, in any order.
 * Targets that are `undefined` (no swimlanes) are skipped.
 *
 * - Attribute targets write `{ [key]: value }`.
 * - Custom field targets are merged into one `customFields` record, so that the other custom fields of the issue
 *   stay as they are. A target without a value ("No <field>") clears the field.
 * - Returns `{}` when the issue already is where it was dropped, and `undefined` when the targets contradict each
 *   other (the same field with two different values), so the drop is not possible.
 */
export function resolveDropUpdate (doc: object, targets: ReadonlyArray<DropTarget | undefined>): DropUpdate | undefined {
  const current = (doc as { customFields?: Record<string, unknown> }).customFields
  const update: DropUpdate = {}
  const wanted = new Map<string, unknown>()
  let customFields: Record<string, unknown> | undefined
  for (const target of targets) {
    if (target === undefined) continue
    const id = target.kind === 'attribute' ? `a:${target.key}` : `c:${target.fieldKey}`
    const value = target.value
    if (wanted.has(id) && !deepEqual(wanted.get(id), value)) return undefined
    wanted.set(id, value)
    if (target.kind === 'attribute') {
      update[target.key] = value
    } else {
      customFields = mergeCustomFieldValue(customFields ?? current, target.fieldKey, target.value ?? null)
    }
  }
  if (customFields !== undefined && !deepEqual(customFields, current ?? {})) {
    update.customFields = customFields
  }
  return update
}

/**
 * Whether a drop changes anything for a document, given what it has now.
 */
export function isNoopUpdate (doc: object, update: object): boolean {
  return Object.entries(update).every(([key, value]) => deepEqual((doc as Record<string, unknown>)[key], value))
}

/**
 * Whether a card can be dropped on a column or a swimlane, given the categories the host says are available for it
 * (for example only the statuses of the project of the card). `undefined` means that every category is available.
 * A category that stands for several values (the same status in several projects) is available when one of them is.
 */
export function isAvailableCategory (available: readonly unknown[] | undefined, category: unknown): boolean {
  if (available === undefined) return true
  if (available.includes(category)) return true
  if (category !== null && typeof category === 'object') {
    const values = (category as { values?: unknown }).values
    if (Array.isArray(values)) {
      return values.some((v) => available.includes((v as { _id?: unknown })?._id))
    }
  }
  return false
}

/** Attributes of an issue that can be empty, so that a card can be dropped on "No <attribute>". */
export const NULLABLE_ATTRIBUTES: readonly string[] = ['assignee', 'component', 'milestone']

/**
 * What dropping on the column or swimlane of a built-in attribute writes. A category that stands for several values
 * (the same status in several projects) gives the value of the project of the card. `undefined` when the card cannot
 * go there: the category has no value for the project of the card, or the attribute cannot be empty.
 */
export function attributeTarget (key: string, category: unknown, space: string): DropTarget | undefined {
  if (category === undefined || category === null) {
    return NULLABLE_ATTRIBUTES.includes(key) ? { kind: 'attribute', key, value: null } : undefined
  }
  if (typeof category === 'object') {
    const values = (category as { values?: Array<{ _id: unknown, space: unknown }> }).values
    const value = values?.find((it) => it.space === space)?._id
    return value === undefined ? undefined : { kind: 'attribute', key, value }
  }
  return { kind: 'attribute', key, value: category }
}

/** What dropping on the column or swimlane of a custom field writes: the id, or nothing for "No <field>". */
export function customTarget (fieldKey: string, category: unknown): DropTarget {
  return { kind: 'custom', fieldKey, value: typeof category === 'string' && category !== '' ? category : undefined }
}
