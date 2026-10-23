// SPDX-License-Identifier: EPL-2.0

import { findProperty } from '@hcengineering/core'
import type { DocumentQuery, Ref, Space } from '@hcengineering/core'
import type { ToDo } from '@hcengineering/time'
import { filterVisibleToDos, getArchivedToDoQuery } from '../to-do-query'

const ARCHIVED_PROJECT = 'archived-project' as Ref<Space>
const ACTIVE_PROJECT = 'active-project' as Ref<Space>

function todo (id: string, fields: Partial<ToDo> = {}): ToDo {
  return {
    _id: id as Ref<ToDo>,
    user: 'current-user' as ToDo['user'],
    doneOn: null,
    workslots: 0,
    ...fields
  } as unknown as ToDo
}

function findTodos (todos: ToDo[], query: DocumentQuery<ToDo>): ToDo[] {
  return Object.entries(query).reduce<ToDo[]>(
    (result, [key, value]) => findProperty(result, key, value) as ToDo[],
    todos
  )
}

describe('Planner archived project filtering', () => {
  const archived = todo('archived', { attachedSpace: ARCHIVED_PROJECT })
  const active = todo('active', { attachedSpace: ACTIVE_PROJECT })
  const independent = todo('independent')
  const nullSpace = todo('null-space', { attachedSpace: null as unknown as Ref<Space> })
  const unknown = todo('unknown', { attachedSpace: 'unknown-space' as Ref<Space> })
  const todos = [archived, active, independent, nullSpace, unknown]

  it('hides todos of archived projects and keeps all others', () => {
    expect(filterVisibleToDos(todos, new Set([ARCHIVED_PROJECT]))).toEqual([active, independent, nullSpace, unknown])
  })

  it('shows everything again once the project is unarchived', () => {
    expect(filterVisibleToDos(todos, new Set())).toEqual(todos)
  })

  it('counts only unplanned todos of archived projects', () => {
    const query = getArchivedToDoQuery({ doneOn: null, workslots: 0 }, [ARCHIVED_PROJECT])
    const planned = todo('planned', { attachedSpace: ARCHIVED_PROJECT, workslots: 1 })

    expect(findTodos([...todos, planned], query)).toEqual([archived])
  })

  it('does not modify the original query', () => {
    const query: DocumentQuery<ToDo> = { doneOn: null, workslots: 0 }

    getArchivedToDoQuery(query, [ARCHIVED_PROJECT])

    expect(query).toEqual({ doneOn: null, workslots: 0 })
  })
})
