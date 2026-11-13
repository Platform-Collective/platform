// SPDX-License-Identifier: EPL-2.0

import core, { type Doc, type Ref, type Status, type TxUpdateDoc } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import type { TriggerControl } from '@hcengineering/server-core'
import task from '@hcengineering/task'
import time, { type ToDo, type WorkSlot } from '@hcengineering/time'
import tracker, { type Issue } from '@hcengineering/tracker'
import { IssueToDoDone } from '../index'

jest.mock('@hcengineering/server-contact', () => ({}))
jest.mock('@hcengineering/server-notification-resources', () => ({}))
jest.mock('@hcengineering/text-core', () => ({}))
jest.mock('@hcengineering/platform', () => {
  const actual = jest.requireActual('@hcengineering/platform')
  return { ...actual, getResource: jest.fn() }
})

const TODO = 'todo' as Ref<Status>
const ACTIVE = 'active' as Ref<Status>
const DONE = 'done' as Ref<Status>
const CANCELED = 'canceled' as Ref<Status>
const OTHER_DONE = 'other-done' as Ref<Status>
const statuses = [
  { _id: OTHER_DONE, category: task.statusCategory.Won },
  { _id: CANCELED, category: task.statusCategory.Lost },
  { _id: DONE, category: task.statusCategory.Won },
  { _id: ACTIVE, category: task.statusCategory.Active },
  { _id: TODO, category: task.statusCategory.ToDo }
] as Status[]

interface Options {
  status?: Ref<Status>
  typeStatuses?: Ref<Status>[]
  unfinished?: boolean
  classic?: boolean
  testerAllows?: boolean
}

interface Query {
  _id?: string | { $in: string[] }
}

function setup (options: Options = {}): { control: TriggerControl, todo: ToDo, tester: jest.Mock } {
  const issue = {
    _id: 'issue',
    _class: tracker.class.Issue,
    space: 'project',
    attachedTo: 'parent',
    attachedToClass: tracker.class.Issue,
    collection: 'subIssues',
    kind: 'task-type',
    status: options.status ?? TODO
  } as unknown as Issue
  const todo = {
    _id: 'action-item',
    _class: time.class.ToDo,
    attachedTo: issue._id,
    attachedToClass: issue._class,
    doneOn: 1,
    user: 'employee'
  } as unknown as ToDo
  const tester = jest.fn(async () => options.testerAllows ?? true)
  jest.mocked(getResource).mockResolvedValue(tester)

  const control = {
    ctx: {},
    txFactory: { account: core.account.System },
    findAll: jest.fn(async (_ctx: unknown, _class: Ref<Doc>) => {
      if (_class === tracker.class.Issue) return [issue]
      if (_class === tracker.class.Project) return [{ type: 'project-type' }]
      if (_class === time.class.ToDo) return options.unfinished === true ? [todo] : []
      throw new Error(`Unexpected document class: ${_class}`)
    }),
    modelDb: {
      findAll: jest.fn(async (_class: Ref<Doc>, query: Query) => {
        if (_class === task.class.ProjectType) return [{ classic: options.classic ?? true }]
        if (_class === task.class.TaskType) {
          return [{ statuses: options.typeStatuses ?? [TODO, ACTIVE, DONE, CANCELED] }]
        }
        if (_class === time.class.TodoAutomationHelper) return [{ onDoneTester: 'tester' }]
        if (_class === core.class.Status) {
          const id = query._id
          return statuses.filter((status) =>
            typeof id === 'string' ? status._id === id : id?.$in.includes(status._id)
          )
        }
        throw new Error(`Unexpected model class: ${_class}`)
      })
    }
  } as unknown as TriggerControl
  return { control, todo, tester }
}

describe('IssueToDoDone', () => {
  it.each<[Ref<Status>, boolean]>([
    [TODO, false],
    [TODO, true],
    [ACTIVE, false],
    [ACTIVE, true]
  ])('completes an issue in %s with work slots: %s', async (status, scheduled) => {
    const { control, todo, tester } = setup({ status })
    const workslots = scheduled ? [{ date: 0, dueDate: 30 * 60 * 1000 } as unknown as WorkSlot] : []

    const txes = await IssueToDoDone(control, workslots, todo, false)

    expect(txes).toHaveLength(scheduled ? 2 : 1)
    const change = txes[0] as TxUpdateDoc<Issue>
    expect(change.objectId).toBe(todo.attachedTo)
    expect(change.operations).toEqual({ status: DONE })
    expect(tester).toHaveBeenCalledWith(control, todo)
    if (scheduled) {
      expect(txes[1]).toMatchObject({
        objectClass: tracker.class.TimeSpendReport,
        attributes: { value: 0.5, employee: todo.user }
      })
    }
  })

  it.each<Options>([
    { status: DONE },
    { status: CANCELED },
    { status: 'missing' as Ref<Status> },
    { typeStatuses: [ACTIVE, DONE] },
    { typeStatuses: [] },
    { typeStatuses: [TODO, ACTIVE, CANCELED] },
    { unfinished: true },
    { testerAllows: false },
    { classic: false }
  ])('preserves completion guards: %j', async (options) => {
    const { control, todo } = setup(options)

    expect(await IssueToDoDone(control, [], todo, false)).toEqual([])
  })

  it('does not change status for a derived completion', async () => {
    const { control, todo, tester } = setup()

    expect(await IssueToDoDone(control, [], todo, true)).toEqual([])
    expect(tester).not.toHaveBeenCalled()
  })

  it('uses the first successful status in task type order', async () => {
    const { control, todo } = setup({ typeStatuses: [TODO, DONE, OTHER_DONE] })

    const txes = await IssueToDoDone(control, [], todo, false)

    expect(txes[0]).toMatchObject({ operations: { status: DONE } })
  })
})
