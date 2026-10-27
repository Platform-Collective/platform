// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { Class, Doc, Ref, StatusCategory, Tx, TxCreateDoc, TxCUD } from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import task from '@hcengineering/task'
import time from '@hcengineering/time'
import type { ToDo } from '@hcengineering/time'
import tracker from '@hcengineering/tracker'
import type { Issue, IssueStatus } from '@hcengineering/tracker'

import { IssueToDoFactory } from '../index'

function makeTodo (id: string, overrides: Partial<ToDo> = {}): ToDo {
  return {
    _id: id as Ref<ToDo>,
    _class: time.class.ProjectToDo,
    space: time.space.ToDos,
    attachedTo: 'issue' as Ref<Issue>,
    attachedToClass: tracker.class.Issue,
    user: 'employee',
    doneOn: null,
    workslots: 0,
    ...overrides
  } as unknown as ToDo
}

function makeControl (
  todos: ToDo[] = [],
  classic = true
): {
  control: TriggerControl
  issue: Issue
  changeStatus: (category: Ref<StatusCategory>) => Promise<Tx[]>
  apply: jest.Mock
} {
  const factory = new TxFactory(core.account.System)
  const issue = {
    _id: 'issue' as Ref<Issue>,
    _class: tracker.class.Issue,
    space: 'project',
    title: 'Issue',
    assignee: 'employee'
  } as unknown as Issue
  let category = task.statusCategory.ToDo
  const apply = jest.fn(async () => {})
  const control = {
    ctx: {},
    hierarchy: { isDerived: (actual: string, expected: string) => actual === expected },
    txFactory: factory,
    modelDb: {
      findAll: jest.fn(async (_class: Ref<Class<Doc>>) => {
        if (_class === task.class.ProjectType) return [{ classic }]
        if (_class === core.class.Status) return [{ category }]
        return []
      })
    },
    findAll: jest.fn(async (_ctx: unknown, _class: Ref<Class<Doc>>, query: Record<string, unknown>) => {
      if (_class === task.class.Project) return [{ _id: issue.space, type: 'project-type' }]
      if (_class === tracker.class.Issue) return [issue]
      if (_class === contact.mixin.Employee) return [{ _id: issue.assignee }]
      if (_class === time.class.ToDo || _class === time.class.ProjectToDo) {
        return todos.filter((todo) =>
          Object.entries(query).every(([key, value]) => {
            const actual = (todo as unknown as Record<string, unknown>)[key]
            return (
              (_class === time.class.ToDo || todo._class === _class) &&
              (actual === value || (actual == null && value === null))
            )
          })
        )
      }
      return []
    }),
    apply
  } as unknown as TriggerControl

  return {
    control,
    issue,
    apply,
    changeStatus: async (newCategory) => {
      category = newCategory
      const tx = factory.createTxUpdateDoc(issue._class, issue.space, issue._id, {
        status: newCategory as unknown as Ref<IssueStatus>
      })
      return await IssueToDoFactory(tx, control)
    }
  }
}

describe('issue todo status automation', () => {
  it.each([task.statusCategory.ToDo, task.statusCategory.Active])(
    'removes the assignee unplanned project todo when moving from %s to backlog',
    async (category) => {
      const todo = makeTodo('pending')
      const { changeStatus } = makeControl([todo])
      expect(await changeStatus(category)).toEqual([])

      const txes = await changeStatus(task.statusCategory.UnStarted)
      expect(txes).toEqual([
        expect.objectContaining({
          _class: core.class.TxRemoveDoc,
          objectClass: todo._class,
          objectId: todo._id,
          objectSpace: todo.space
        })
      ])
    }
  )

  it('preserves other users, planned, completed, unrelated and personal todos', async () => {
    const todos = [
      makeTodo('pending'),
      makeTodo('other-assignee', { user: 'other-employee' as ToDo['user'] }),
      makeTodo('planned', { workslots: 1 }),
      makeTodo('completed', { doneOn: 123 }),
      makeTodo('unrelated', { attachedTo: 'other-issue' as Ref<Issue> }),
      makeTodo('personal', { _class: time.class.ToDo })
    ]
    const { changeStatus } = makeControl(todos)

    const txes = await changeStatus(task.statusCategory.UnStarted)

    expect(txes.map((tx) => (tx as TxCUD<Doc>).objectId)).toEqual([todos[0]._id])
    expect(txes.every((tx) => tx._class === core.class.TxRemoveDoc)).toBe(true)
  })

  it('preserves todos when the issue has no assignee', async () => {
    const { issue, changeStatus } = makeControl([makeTodo('pending')])
    issue.assignee = null

    expect(await changeStatus(task.statusCategory.UnStarted)).toEqual([])
  })

  it('creates a new todo when the issue returns from backlog to todo', async () => {
    const todos = [makeTodo('pending')]
    const { control, changeStatus, apply } = makeControl(todos)

    const removals = await changeStatus(task.statusCategory.UnStarted)
    expect(removals).toHaveLength(1)
    for (const tx of removals) {
      const index = todos.findIndex((todo) => todo._id === (tx as TxCUD<Doc>).objectId)
      todos.splice(index, 1)
    }
    await changeStatus(task.statusCategory.ToDo)

    expect(apply).toHaveBeenCalledTimes(1)
    const [ctx, txes] = apply.mock.calls[0] as unknown as [unknown, TxCreateDoc<ToDo>[]]
    expect(ctx).toBe(control.ctx)
    expect(txes).toHaveLength(1)
    expect(TxProcessor.createDoc2Doc(txes[0])).toMatchObject({
      _class: time.class.ProjectToDo,
      attachedTo: 'issue',
      user: 'employee',
      doneOn: null
    })
  })

  it('does nothing when backlog has no pending todos', async () => {
    const { changeStatus, apply } = makeControl([makeTodo('completed', { doneOn: 123 })])

    expect(await changeStatus(task.statusCategory.UnStarted)).toEqual([])
    expect(apply).not.toHaveBeenCalled()
  })

  it.each([task.statusCategory.Won, task.statusCategory.Lost])(
    'still completes pending todos for %s',
    async (category) => {
      const todo = makeTodo('pending')
      const { changeStatus } = makeControl([todo, makeTodo('completed', { doneOn: 123 })])

      expect(await changeStatus(category)).toEqual([
        expect.objectContaining({
          _class: core.class.TxUpdateDoc,
          objectId: todo._id,
          operations: { doneOn: expect.any(Number) }
        })
      ])
    }
  )

  it('does not change todos for a non-classic project', async () => {
    const { changeStatus } = makeControl([makeTodo('pending')], false)

    expect(await changeStatus(task.statusCategory.UnStarted)).toEqual([])
  })
})
