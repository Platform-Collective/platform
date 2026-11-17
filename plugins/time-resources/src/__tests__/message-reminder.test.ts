// SPDX-License-Identifier: EPL-2.0

import {
  setCurrentAccount,
  AccountRole,
  type AccountUuid,
  type Account,
  type Class,
  type Doc,
  type PersonId,
  type Ref,
  type Space
} from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { createMessageToDo } from '../message-reminder'
import { type MessageToDoSource } from '../message-todo'
import time from '../plugin'

jest.mock('@hcengineering/contact', () => ({ getCurrentEmployee: () => 'employee' }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: async () => 'Action Item'
}))
jest.mock('@hcengineering/ui', () => ({ locationToUrl: () => '/workbench/workspace/chunter/message' }))
jest.mock('@hcengineering/view-resources', () => ({ getObjectLinkFragment: async () => ({ path: [] }) }))

const addCollection = jest.fn(async () => 'todo')
const ops = { findOne: jest.fn(async () => undefined), addCollection, commit: jest.fn(async () => ({ result: true })) }
const message: MessageToDoSource = {
  _id: 'message' as Ref<MessageToDoSource>,
  _class: 'message-class' as Ref<Class<Doc>>,
  space: 'channel' as Ref<Space>,
  modifiedOn: 0,
  modifiedBy: 'social' as PersonId,
  message: 'Follow up'
}

beforeEach(() => {
  jest.clearAllMocks()
  const account: Account = {
    uuid: 'account' as AccountUuid,
    role: AccountRole.User,
    primarySocialId: 'social' as PersonId,
    socialIds: ['social' as PersonId],
    fullSocialIds: []
  }
  setCurrentAccount(account)
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://example.com' } }
  })
  jest.mocked(getClient).mockReturnValue({
    getHierarchy: () => ({}),
    apply: () => ops,
    findOne: async () => undefined
  } as unknown as ReturnType<typeof getClient>)
})

it('keeps the message title clean and schedules a native thirty-minute WorkSlot', async () => {
  const start = Date.UTC(2026, 10, 12, 14, 30)
  await createMessageToDo(message, start)
  expect(addCollection).toHaveBeenCalledWith(
    time.class.ToDo,
    time.space.ToDos,
    message._id,
    message._class,
    'todos',
    expect.objectContaining({ title: 'Follow up' })
  )
  expect(addCollection).toHaveBeenCalledWith(
    time.class.WorkSlot,
    expect.anything(),
    'todo',
    time.class.ToDo,
    'workslots',
    expect.objectContaining({ title: 'Follow up', date: start, dueDate: start + 30 * 60 * 1000, reminders: [] })
  )
  expect(ops.commit).toHaveBeenCalledTimes(1)
})

it('stores the selected event reminders on the WorkSlot', async () => {
  await createMessageToDo(message, Date.UTC(2026, 10, 12, 14, 30), [5 * 60 * 1000])
  expect(addCollection).toHaveBeenCalledWith(
    time.class.WorkSlot,
    expect.anything(),
    'todo',
    time.class.ToDo,
    'workslots',
    expect.objectContaining({ reminders: [5 * 60 * 1000] })
  )
})

it('reports a rejected planner batch instead of claiming success', async () => {
  ops.commit.mockResolvedValueOnce({ result: false })
  await expect(createMessageToDo(message, Date.UTC(2026, 10, 12, 14, 30))).rejects.toThrow(
    'Unable to create planner item'
  )
})
