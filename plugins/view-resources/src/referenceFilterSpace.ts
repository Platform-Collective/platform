// SPDX-License-Identifier: EPL-2.0

import type { AnyAttribute, Doc, Hierarchy, Ref, Space, WithLookup } from '@hcengineering/core'
import view, { type KeyFilter, type ReferenceFilterSpace } from '@hcengineering/view'

/**
 * Model lookup used to read an attribute with the mixins the model applied to it.
 */
export interface AttributeModel {
  findObject: <T extends Doc>(_id: Ref<T>) => T | undefined
}

/**
 * Resolve the space settings of a reference filter, or undefined when the
 * filter is limited to one space or its attribute has no such settings.
 *
 * The attribute is resolved through the class hierarchy, so filters on
 * subclasses and mixins of the attribute's class get the same settings, and
 * saved filters do not depend on the attribute copy stored with them.
 */
export function getReferenceFilterSpace (
  hierarchy: Hierarchy,
  model: AttributeModel,
  key: KeyFilter,
  space: Ref<Space> | undefined
): ReferenceFilterSpace | undefined {
  if (space !== undefined) return undefined
  const attribute = hierarchy.findAttribute(key._class, key.key) ?? key.attribute
  if (attribute === undefined) return undefined
  const modelAttribute = model.findObject<AnyAttribute>(attribute._id) ?? attribute
  return hierarchy.asIf(modelAttribute, view.mixin.ReferenceFilterSpace)
}

/**
 * The label of a value's space, read from the looked-up space.
 */
export function getSpaceFilterLabel (value: WithLookup<Doc>, config: ReferenceFilterSpace): string | undefined {
  const space = (value.$lookup as Record<string, unknown> | undefined)?.space as Record<string, unknown> | undefined
  const label = space?.[config.labelKey]
  return typeof label === 'string' && label !== '' ? label : undefined
}

/**
 * Whether a value matches the search by its own label or by its space label.
 */
export function matchesSpaceFilterSearch (label: string, spaceLabel: string | undefined, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (needle === '') return true
  if (label.toLowerCase().includes(needle)) return true
  if (spaceLabel === undefined) return false
  const lowerSpace = spaceLabel.toLowerCase()
  // Also match the combined form, such as "PROJ · Sprint" or "PROJ Sprint".
  return (
    lowerSpace.includes(needle) ||
    `${lowerSpace} · ${label.toLowerCase()}`.includes(needle) ||
    `${lowerSpace} ${label.toLowerCase()}`.includes(needle)
  )
}

/**
 * Order values by space label and then by their own label, so values with the
 * same label in different spaces stay grouped by space.
 */
export function compareBySpaceThenLabel (
  a: { label: string, spaceLabel: string | undefined },
  b: { label: string, spaceLabel: string | undefined }
): number {
  const bySpace = (a.spaceLabel ?? '').localeCompare(b.spaceLabel ?? '', undefined, { sensitivity: 'base' })
  if (bySpace !== 0) return bySpace
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Filter values by search and order them by space, then label.
 */
export function filterAndSortBySpace<T extends WithLookup<Doc>> (
  values: T[],
  config: ReferenceFilterSpace,
  getLabel: (value: T) => string,
  search: string
): T[] {
  return values
    .map((value) => ({ value, label: getLabel(value), spaceLabel: getSpaceFilterLabel(value, config) }))
    .filter((it) => matchesSpaceFilterSearch(it.label, it.spaceLabel, search))
    .sort(compareBySpaceThenLabel)
    .map((it) => it.value)
}
