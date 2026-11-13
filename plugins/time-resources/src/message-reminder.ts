// SPDX-License-Identifier: EPL-2.0

import { getCurrentEmployee } from '@hcengineering/contact'
import { SortingOrder } from '@hcengineering/core'
import type { Doc } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { makeRank } from '@hcengineering/task'
import { ToDoPriority } from '@hcengineering/time'
import type { ToDo } from '@hcengineering/time'
import { locationToUrl } from '@hcengineering/ui'
import { getObjectLinkFragment } from '@hcengineering/view-resources'
import { getMessageToDoContent, isMessageToDoSource, withPlannedTime } from './message-todo'
import time from './plugin'

export async function getMessageToDoDefaults (object: Doc): Promise<Pick<ToDo, 'title' | 'description'>> {
  if (!isMessageToDoSource(object)) return { title: '', description: '' }
  const location = await getObjectLinkFragment(getClient().getHierarchy(), object)
  const link = new URL(locationToUrl(location), window.location.origin).href
  return getMessageToDoContent(object.message, link, await translate(time.string.ToDo, {}))
}

/**
 * Create a private planner item due at the chosen date and time. ToDo due dates do not schedule
 * notifications, so the item only appears in the planner.
 */
export async function createMessageToDo (object: Doc, dueDate: number): Promise<void> {
  const content = await getMessageToDoDefaults(object)
  const user = getCurrentEmployee()
  const ops = getClient().apply(undefined, 'create-todo')
  const latestTodo = await ops.findOne(
    time.class.ToDo,
    { user, doneOn: null },
    { sort: { rank: SortingOrder.Ascending } }
  )
  await ops.addCollection(time.class.ToDo, time.space.ToDos, object._id, object._class, 'todos', {
    ...content,
    title: withPlannedTime(content.title, dueDate),
    dueDate,
    user,
    attachedSpace: object.space,
    visibility: 'private',
    workslots: 0,
    priority: ToDoPriority.NoPriority,
    doneOn: null,
    rank: makeRank(undefined, latestTodo?.rank)
  })
  await ops.commit()
}
