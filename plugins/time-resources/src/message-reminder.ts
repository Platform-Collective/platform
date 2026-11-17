// SPDX-License-Identifier: EPL-2.0

import { getCurrentEmployee } from '@hcengineering/contact'
import calendar, { AccessLevel, type Calendar, generateEventId } from '@hcengineering/calendar'
import { getCurrentAccount, SortingOrder } from '@hcengineering/core'
import type { Doc, Ref } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { makeRank } from '@hcengineering/task'
import { ToDoPriority } from '@hcengineering/time'
import type { ToDo } from '@hcengineering/time'
import { locationToUrl } from '@hcengineering/ui'
import { getObjectLinkFragment } from '@hcengineering/view-resources'
import { getMessageToDoContent, isMessageToDoSource } from './message-todo'
import time from './plugin'

export async function getMessageToDoDefaults (object: Doc): Promise<Pick<ToDo, 'title' | 'description'>> {
  if (!isMessageToDoSource(object)) return { title: '', description: '' }
  const location = await getObjectLinkFragment(getClient().getHierarchy(), object)
  const link = new URL(locationToUrl(location), window.location.origin).href
  return getMessageToDoContent(object.message, link, await translate(time.string.ToDo, {}))
}

/** Schedule a private planner item using the calendar's native reminder support. */
export async function createMessageToDo (object: Doc, date: number, reminders: number[] = []): Promise<void> {
  if (!Number.isFinite(date)) throw new Error('Invalid planned date')
  const content = await getMessageToDoDefaults(object)
  const user = getCurrentEmployee()
  const account = getCurrentAccount()
  const client = getClient()
  const external = await client.findOne(calendar.class.ExternalCalendar, {
    default: true,
    hidden: false,
    user: account.primarySocialId
  })
  const calendarId = external?._id ?? (`${account.uuid}_calendar` as Ref<Calendar>)
  const ops = client.apply(undefined, 'create-todo')
  const latestTodo = await ops.findOne(
    time.class.ToDo,
    { user, doneOn: null },
    { sort: { rank: SortingOrder.Ascending } }
  )
  const id = await ops.addCollection(
    time.class.ToDo,
    time.space.ToDos,
    object._id,
    object._class,
    'todos',
    {
      ...content,
      dueDate: date,
      user,
      attachedSpace: object.space,
      visibility: 'private',
      workslots: 0,
      priority: ToDoPriority.NoPriority,
      doneOn: null,
      rank: makeRank(undefined, latestTodo?.rank)
    }
  )
  await ops.addCollection(time.class.WorkSlot, calendar.space.Calendar, id, time.class.ToDo, 'workslots', {
    eventId: generateEventId(),
    date,
    dueDate: date + 30 * 60 * 1000,
    title: content.title,
    description: content.description,
    participants: [user],
    calendar: calendarId,
    blockTime: true,
    allDay: false,
    access: AccessLevel.Owner,
    visibility: 'freeBusy',
    reminders,
    user: account.primarySocialId
  })
  if (!(await ops.commit()).result) throw new Error('Unable to create planner item')
}
