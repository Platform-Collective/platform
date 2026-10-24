// SPDX-License-Identifier: EPL-2.0

import type { Class, Doc, Hierarchy, Ref, SortingQuery } from '@hcengineering/core'
import view, { type ViewOptions } from '@hcengineering/view'

/** Build query sorting from the attribute type's rules before applying a page limit. */
export function getListSorting (
  hierarchy: Hierarchy,
  _class: Ref<Class<Doc>>,
  [key, order]: ViewOptions['orderBy']
): SortingQuery<Doc> {
  const attribute = hierarchy.findAttribute(_class, key)
  const rules =
    attribute === undefined
      ? undefined
      : hierarchy.as(hierarchy.getClass(attribute.type._class), view.mixin.SortFuncs)?.sortingRules
  return { [key]: rules === undefined ? order : { ...rules, order } }
}
