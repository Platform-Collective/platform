// SPDX-License-Identifier: EPL-2.0

import type { Ref, Space, WithLookup } from '@hcengineering/core'
import type { Event } from '@hcengineering/calendar'
import type { ToDo } from '@hcengineering/time'

/** Drop todos attached to archived spaces; todos without an attached space stay visible. */
export function filterVisibleToDos<T extends ToDo> (todos: T[], archivedProjects: Set<Ref<Space>>): T[] {
  if (archivedProjects.size === 0) return todos
  return todos.filter((todo) => todo.attachedSpace == null || !archivedProjects.has(todo.attachedSpace))
}

/** Count the visible unplanned todos already loaded by the navigator, without a second query. */
export function countVisibleUnplannedToDos (todos: ToDo[], archivedSpaces: Set<Ref<Space>>): number {
  return filterVisibleToDos(todos, archivedSpaces).filter((todo) => todo.doneOn == null && todo.workslots === 0).length
}

/** Hide work slots through their todo lookup; ordinary calendar events stay visible. */
export function filterVisibleWorkSlots<T extends WithLookup<Event>> (
  events: T[],
  archivedSpaces: Set<Ref<Space>>,
  isWorkSlot: (event: T) => boolean
): T[] {
  if (archivedSpaces.size === 0) return events
  return events.filter((event) => {
    if (!isWorkSlot(event)) return true
    const todo = event.$lookup?.attachedTo as ToDo | undefined
    return todo?.attachedSpace == null || !archivedSpaces.has(todo.attachedSpace)
  })
}
