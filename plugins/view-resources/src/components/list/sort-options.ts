// SPDX-License-Identifier: EPL-2.0

import core, {
  SortingOrder,
  type Class,
  type Doc,
  type FindOptions,
  type Hierarchy,
  type Ref,
  type RefTo
} from '@hcengineering/core'

/** Resolves status-name ordering before the row query applies its page limit. */
export function getListSortOptions<T extends Doc> (
  hierarchy: Hierarchy,
  _class: Ref<Class<T>>,
  options: FindOptions<T>
): FindOptions<T> {
  const direction = options.sort?.status
  if (direction === SortingOrder.Ascending || direction === SortingOrder.Descending) {
    const attribute = hierarchy.findAttribute(_class, 'status')
    if (attribute?.type._class === core.class.RefTo) {
      const statusClass = (attribute.type as RefTo<Doc>).to
      if (hierarchy.isDerived(statusClass, core.class.Status)) {
        return {
          ...options,
          lookup: { status: statusClass, ...options.lookup },
          sort: Object.fromEntries(
            Object.entries(options.sort ?? {}).map(([key, value]) => [
              key === 'status' ? '$lookup.status.name' : key,
              value
            ])
          )
        } as unknown as FindOptions<T>
      }
    }
  }
  return options
}
