// SPDX-License-Identifier: EPL-2.0

import type { DocumentQuery, Ref, Space } from '@hcengineering/core'
import type { ToDo } from '@hcengineering/time'

/** Drop todos attached to archived projects; todos without a project stay visible. */
export function filterVisibleToDos<T extends ToDo> (todos: T[], archivedProjects: Set<Ref<Space>>): T[] {
  if (archivedProjects.size === 0) return todos
  return todos.filter((todo) => todo.attachedSpace == null || !archivedProjects.has(todo.attachedSpace))
}

/**
 * Restrict a todo query to todos attached to archived projects.
 * A positive $in is used, because $nin does not match todos without a project on Postgres.
 */
export function getArchivedToDoQuery (query: DocumentQuery<ToDo>, archivedProjects: Ref<Space>[]): DocumentQuery<ToDo> {
  return { ...query, attachedSpace: { $in: archivedProjects } }
}
