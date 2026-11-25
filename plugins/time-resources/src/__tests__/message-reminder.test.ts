// SPDX-License-Identifier: EPL-2.0

import calendar, {
  AccessLevel,
  type Calendar,
  type ExternalCalendar,
  type PrimaryCalendar
} from '@hcengineering/calendar'
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
import presentation, { getClient } from '@hcengineering/presentation'
import { setMetadata } from '@hcengineering/platform'
import { createMessageToDo, getMessageToDoDefaults } from '../message-reminder'
import { type MessageToDoSource } from '../message-todo'
import time from '../plugin'

jest.mock('@hcengineering/contact', () => ({ getCurrentEmployee: () => 'employee' }))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { FrontUrl: 'front-url' } },
  getClient: jest.fn()
}))
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
const defaultCalendar: ExternalCalendar = {
  _id: 'default-calendar' as Ref<ExternalCalendar>,
  _class: calendar.class.ExternalCalendar,
  space: calendar.space.Calendar,
  modifiedOn: 0,
  modifiedBy: 'social' as PersonId,
  name: 'Default calendar',
  hidden: false,
  visibility: 'private',
  user: 'social' as PersonId,
  access: AccessLevel.Owner,
  default: true,
  externalId: 'external',
  externalUser: 'user'
}
const primaryCalendar: Calendar = {
  ...defaultCalendar,
  _id: 'primary-calendar' as Ref<Calendar>,
  _class: calendar.class.Calendar,
  name: 'Primary calendar'
}
const preference: PrimaryCalendar = {
  _id: 'preference' as Ref<PrimaryCalendar>,
  _class: calendar.class.PrimaryCalendar,
  space: calendar.space.Calendar,
  modifiedOn: 0,
  modifiedBy: 'social' as PersonId,
  attachedTo: primaryCalendar._id
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
  setMetadata(presentation.metadata.FrontUrl, 'https://public.example')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://example.com' } }
  })
  jest.mocked(getClient).mockReturnValue({
    getHierarchy: () => ({}),
    apply: () => ops,
    findAll: async () => [defaultCalendar, primaryCalendar],
    findOne: async (_class: Ref<Class<Doc>>): Promise<Doc | undefined> => {
      if (_class === calendar.class.PrimaryCalendar) return preference
      if (_class === calendar.class.ExternalCalendar) return defaultCalendar
      return undefined
    }
  } as unknown as ReturnType<typeof getClient>)
})

it('uses the primary calendar and schedules a native thirty-minute WorkSlot', async () => {
  const start = Date.UTC(2026, 10, 12, 14, 30)
  await createMessageToDo(message, start)
  expect(addCollection).toHaveBeenCalledWith(
    time.class.ToDo,
    time.space.ToDos,
    time.ids.NotAttached,
    time.class.ToDo,
    'todos',
    expect.objectContaining({ title: 'Follow up', dueDate: start + 30 * 60 * 1000 })
  )
  expect(addCollection).toHaveBeenCalledWith(
    time.class.WorkSlot,
    expect.anything(),
    'todo',
    time.class.ToDo,
    'workslots',
    expect.objectContaining({
      title: 'Follow up',
      date: start,
      dueDate: start + 30 * 60 * 1000,
      calendar: primaryCalendar._id,
      reminders: []
    })
  )
  expect(ops.commit).toHaveBeenCalledTimes(1)
})

it('uses the configured public front URL for the message link', async () => {
  const { description } = await getMessageToDoDefaults(message)
  expect(description).toContain('https://public.example/workbench/workspace/chunter/message')
  expect(description).not.toContain('https://example.com')
})

it('keeps truncated Unicode titles intact in the ToDo, WorkSlot and link', async () => {
  const title = `${'a'.repeat(99)}😀…`
  const unicodeMessage = { ...message, message: `${'a'.repeat(99)}😀${'b'.repeat(20)}` }
  await createMessageToDo(unicodeMessage, Date.UTC(2026, 10, 12, 14, 30))
  expect(addCollection).toHaveBeenCalledWith(
    time.class.ToDo,
    time.space.ToDos,
    time.ids.NotAttached,
    time.class.ToDo,
    'todos',
    expect.objectContaining({ title, description: expect.stringContaining(title) })
  )
  expect(addCollection).toHaveBeenCalledWith(
    time.class.WorkSlot,
    expect.anything(),
    'todo',
    time.class.ToDo,
    'workslots',
    expect.objectContaining({ title, description: expect.stringContaining(title) })
  )
})

it('uses the selected duration and the slot end as the ToDo due date', async () => {
  const start = Date.UTC(2026, 10, 12, 14, 30)
  const duration = 60 * 60 * 1000
  await createMessageToDo(message, start, [], duration)
  expect(addCollection).toHaveBeenCalledWith(
    time.class.ToDo,
    time.space.ToDos,
    time.ids.NotAttached,
    time.class.ToDo,
    'todos',
    expect.objectContaining({ dueDate: start + duration })
  )
  expect(addCollection).toHaveBeenCalledWith(
    time.class.WorkSlot,
    expect.anything(),
    'todo',
    time.class.ToDo,
    'workslots',
    expect.objectContaining({ date: start, dueDate: start + duration })
  )
})

it('does not update the source message collection or metadata', async () => {
  await createMessageToDo(message, Date.UTC(2026, 10, 12, 14, 30))
  expect(addCollection).toHaveBeenCalledWith(
    time.class.ToDo,
    time.space.ToDos,
    time.ids.NotAttached,
    time.class.ToDo,
    'todos',
    expect.anything()
  )
  expect(addCollection).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    message._id,
    message._class,
    'todos',
    expect.anything()
  )
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
