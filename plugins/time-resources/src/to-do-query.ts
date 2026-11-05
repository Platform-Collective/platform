// SPDX-License-Identifier: EPL-2.0

import type { DocumentQuery, Ref, Space, WithLookup } from '@hcengineering/core'
import type { Event } from '@hcengineering/calendar'
import type { ToDo } from '@hcengineering/time'

/** Drop todos attached to archived spaces; todos without an attached space stay visible. */
export function filterVisibleToDos<T extends ToDo> (todos: T[], archivedProjects: Set<Ref<Space>>): T[] {
  if (archivedProjects.size === 0) return todos
  return todos.filter((todo) => todo.attachedSpace == null || !archivedProjects.has(todo.attachedSpace))
}

/**
 * Restrict a todo query to todos attached to archived spaces.
 * A positive $in is used, because $nin does not match todos without an attached space on Postgres.
 */
export function getArchivedToDoQuery (query: DocumentQuery<ToDo>, archivedProjects: Ref<Space>[]): DocumentQuery<ToDo> {
  return { ...query, attachedSpace: { $in: archivedProjects } }
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
