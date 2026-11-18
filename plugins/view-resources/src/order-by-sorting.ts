// SPDX-License-Identifier: EPL-2.0

import core, {
  type Class,
  type Doc,
  type Ref,
  type SortingQuery,
  type Space,
  type Status,
  type TxOperations
} from '@hcengineering/core'
import { getAttributePresenterClass } from '@hcengineering/presentation'
import view, { type OrderOption } from '@hcengineering/view'
import { buildSortingRules } from './sortingRules'
import { sortCategories } from './utils'

/** Build query sorting that follows the configured status positions. */
export async function getOrderBySorting (
  client: TxOperations,
  _class: Ref<Class<Doc>>,
  orderBy: OrderOption,
  space: Ref<Space> | undefined,
  statuses: Status[]
): Promise<SortingQuery<Doc>> {
  const [key, order] = orderBy
  const defaultSort: SortingQuery<Doc> = { [key]: order }
  const hierarchy = client.getHierarchy()
  const attr = hierarchy.findAttribute(_class, key)
  if (attr === undefined) return defaultSort
  const attrClass = getAttributePresenterClass(hierarchy, attr.type).attrClass
  if (
    !hierarchy.isDerived(attrClass, core.class.Status) ||
    !hierarchy.hasMixin(hierarchy.getClass(attrClass), view.mixin.SortFuncs)
  ) {
    return defaultSort
  }
  const values = statuses.filter((it) => hierarchy.isDerived(it._class, attrClass)).map((it) => it._id)
  if (values.length === 0) return defaultSort
  const sorted = await sortCategories(client, attrClass, space, values)
  return { [key]: buildSortingRules(order, sorted) }
}
