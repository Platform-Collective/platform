// SPDX-License-Identifier: EPL-2.0

import core, {
  type AnyAttribute,
  type Attribute,
  type Class,
  type Doc,
  Hierarchy,
  type Ref,
  SortingOrder,
  type Space,
  type Status,
  type TxOperations
} from '@hcengineering/core'
import task from '@hcengineering/task'
import { getOrderBySorting } from '../order-by-sorting'
import * as utils from '../utils'

const statusClass = 'test:class:IssueStatus' as Ref<Class<Status>>
const projectId = 'test:space:Project' as Ref<Space>

function status (id: string, _class: Ref<Class<Status>> = statusClass): Status {
  return {
    _id: id as Ref<Status>,
    _class,
    space: core.space.Model,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    ofAttribute: 'test:attribute:Status' as Ref<Attribute<Status>>,
    name: id
  }
}

function createHierarchy (): Hierarchy {
  const hierarchy = new Hierarchy()
  jest.spyOn(hierarchy, 'findAttribute').mockReturnValue({
    type: { _class: core.class.RefTo, to: statusClass }
  } as unknown as AnyAttribute)
  jest.spyOn(hierarchy, 'getClass').mockReturnValue({ _id: statusClass } as unknown as Class<Doc>)
  jest.spyOn(hierarchy, 'hasMixin').mockReturnValue(true)
  jest.spyOn(hierarchy, 'isDerived').mockImplementation((value, base) => {
    return (
      (value === core.class.RefTo && base === core.class.RefTo) ||
      (value === statusClass && (base === core.class.Status || base === statusClass))
    )
  })
  return hierarchy
}

describe('getOrderBySorting', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('builds rules only for statuses available in the selected project', async () => {
    const hierarchy = createHierarchy()
    const findOne = jest.fn(async () => ({
      $lookup: {
        type: { statuses: [{ _id: 'first' }, { _id: 'second' }] }
      }
    }))
    const client = { getHierarchy: () => hierarchy, findOne } as unknown as TxOperations
    const sortCategories = jest
      .spyOn(utils, 'sortCategories')
      .mockImplementation(async (_client, _attrClass, _space, values) => [...values].reverse())

    const sorting = await getOrderBySorting(
      client,
      core.class.Doc,
      ['status', SortingOrder.Ascending],
      projectId,
      [status('first'), status('second'), status('other-project')],
      true
    )

    expect(findOne).toHaveBeenCalledWith(
      task.class.Project,
      { _id: projectId },
      { lookup: { type: task.class.ProjectType } }
    )
    expect(sortCategories).toHaveBeenCalledWith(client, statusClass, projectId, ['first', 'second'])
    expect(sorting).toEqual({
      status: {
        order: SortingOrder.Ascending,
        default: 2,
        cases: [
          { query: 'second', index: 0 },
          { query: 'first', index: 1 }
        ]
      }
    })
  })

  it('waits for the initial status load instead of returning fallback sorting', async () => {
    const hierarchy = createHierarchy()
    const findOne = jest.fn()
    const client = { getHierarchy: () => hierarchy, findOne } as unknown as TxOperations
    const sortCategories = jest.spyOn(utils, 'sortCategories')

    await expect(
      getOrderBySorting(client, core.class.Doc, ['status', SortingOrder.Ascending], projectId, [], false)
    ).resolves.toBeUndefined()
    expect(findOne).not.toHaveBeenCalled()
    expect(sortCategories).not.toHaveBeenCalled()
  })
})
