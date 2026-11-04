// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import type { Person } from '@hcengineering/contact'
import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { Class, Data, Doc, Ref, StatusCategory, Tx, TxCreateDoc, TxCUD } from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import task from '@hcengineering/task'
import time from '@hcengineering/time'
import type { ToDo, WorkSlot } from '@hcengineering/time'
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
    collection: 'todos',
    user: 'employee',
    doneOn: null,
    workslots: 0,
    ...overrides
  } as unknown as ToDo
}

function matches (doc: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]) => {
    const actual = doc[key]
    if (value !== null && typeof value === 'object' && '$in' in value) {
      return (value as { $in: unknown[] }).$in.includes(actual)
    }
    return actual === value || (actual == null && value === null)
  })
}

function makeControl (
  todos: ToDo[] = [],
  classic = true,
  workslots: WorkSlot[] = []
): {
  control: TriggerControl
  issue: Issue
  changeStatus: (category: Ref<StatusCategory>, assignee?: Ref<Person> | null) => Promise<Tx[]>
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
  const history: Tx[] = [
    factory.createTxCreateDoc(
      tracker.class.Issue,
      issue.space,
      { title: issue.title, assignee: issue.assignee } as unknown as Data<Issue>,
      issue._id
    )
  ]
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
        return todos.filter(
          (todo) =>
            (_class === time.class.ToDo || todo._class === _class) &&
            matches(todo as unknown as Record<string, unknown>, query)
        )
      }
      if (_class === time.class.WorkSlot) {
        return workslots.filter((slot) => matches(slot as unknown as Record<string, unknown>, query))
      }
      if (_class === core.class.TxCUD) {
        return history.filter((tx) => matches(tx as unknown as Record<string, unknown>, query))
      }
      return []
    }),
    apply
  } as unknown as TriggerControl

  return {
    control,
    issue,
    apply,
    changeStatus: async (newCategory, assignee) => {
      category = newCategory
      const operations: Partial<Issue> = { status: newCategory as unknown as Ref<IssueStatus> }
      if (assignee !== undefined) {
        operations.assignee = assignee
        issue.assignee = assignee
      }
      const tx = factory.createTxUpdateDoc(issue._class, issue.space, issue._id, operations)
      history.push(tx)
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
          objectSpace: todo.space,
          attachedTo: todo.attachedTo,
          attachedToClass: todo.attachedToClass,
          collection: 'todos'
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
    const slot = { _id: 'slot', _class: time.class.WorkSlot, attachedTo: 'planned' } as unknown as WorkSlot
    const { changeStatus } = makeControl(todos, true, [slot])

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

  it('removes the previous assignee todo when status and assignee change together', async () => {
    const previous = makeTodo('previous')
    const { changeStatus } = makeControl([previous])

    const txes = await changeStatus(task.statusCategory.UnStarted, 'other-employee' as Ref<Person>)

    expect(txes.map((tx) => (tx as TxCUD<Doc>).objectId)).toEqual([previous._id])
    expect(txes.every((tx) => tx._class === core.class.TxRemoveDoc)).toBe(true)
  })

  it('removes the previous assignee todo when the issue is unassigned on the way to backlog', async () => {
    const previous = makeTodo('previous')
    const { changeStatus } = makeControl([previous])

    const txes = await changeStatus(task.statusCategory.UnStarted, null)

    expect(txes.map((tx) => (tx as TxCUD<Doc>).objectId)).toEqual([previous._id])
  })

  it('preserves a todo with a work slot even when its workslots counter is stale', async () => {
    const todo = makeTodo('stale-counter', { workslots: 0 })
    const slot = { _id: 'slot', _class: time.class.WorkSlot, attachedTo: todo._id } as unknown as WorkSlot
    const { changeStatus } = makeControl([todo], true, [slot])

    expect(await changeStatus(task.statusCategory.UnStarted)).toEqual([])
  })

  it('does not change todos for a non-classic project', async () => {
    const { changeStatus } = makeControl([makeTodo('pending')], false)

    expect(await changeStatus(task.statusCategory.UnStarted)).toEqual([])
  })
})
