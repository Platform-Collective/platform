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
import task, { type Project } from '@hcengineering/task'
import view, { type OrderOption } from '@hcengineering/view'
import { buildSortingRules } from './sortingRules'
import { sortCategories } from './utils'

/** Build query sorting that follows the configured status positions. */
export async function getOrderBySorting (
  client: TxOperations,
  _class: Ref<Class<Doc>>,
  orderBy: OrderOption,
  space: Ref<Space> | undefined,
  statuses: Status[],
  statusesReady: boolean
): Promise<SortingQuery<Doc> | undefined> {
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
  if (!statusesReady) return undefined
  let values = statuses.filter((it) => hierarchy.isDerived(it._class, attrClass)).map((it) => it._id)
  if (space !== undefined) {
    const project = await client.findOne(
      task.class.Project,
      { _id: space as Ref<Project> },
      { lookup: { type: task.class.ProjectType } }
    )
    const projectType = project?.$lookup?.type
    if (projectType !== undefined) {
      const projectStatuses = new Set(projectType.statuses.map((status) => status._id))
      values = values.filter((status) => projectStatuses.has(status))
    }
  }
  if (values.length === 0) return defaultSort
  const sorted = await sortCategories(client, attrClass, space, values)
  return { [key]: buildSortingRules(order, sorted) }
}
