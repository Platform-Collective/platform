// SPDX-License-Identifier: EPL-2.0

import { findProperty } from '@hcengineering/core'
import type { DocumentQuery, Ref, Space, WithLookup } from '@hcengineering/core'
import type { Event } from '@hcengineering/calendar'
import type { ToDo } from '@hcengineering/time'
import { countVisibleUnplannedToDos, filterVisibleToDos, filterVisibleWorkSlots, getArchivedToDoQuery } from '../to-do-query'

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

describe('unplanned navigator count from the existing todo list', () => {
  const archived = new Set([ARCHIVED_PROJECT])
  const input = [
    todo('archived-open', { attachedSpace: ARCHIVED_PROJECT }),
    todo('active-open', { attachedSpace: ACTIVE_PROJECT }),
    todo('standalone-open'),
    todo('planned', { workslots: 1 }),
    todo('done', { doneOn: 123 })
  ]

  it('counts visible open unplanned todos, including ones without an attached space', () => {
    expect(countVisibleUnplannedToDos(input, archived)).toBe(2)
  })

  it('recomputes on archive and unarchive using the already loaded todos', () => {
    expect(countVisibleUnplannedToDos(input, new Set())).toBe(3)
    expect(countVisibleUnplannedToDos(input, new Set([ARCHIVED_PROJECT, ACTIVE_PROJECT]))).toBe(1)
    expect(countVisibleUnplannedToDos(input, new Set())).toBe(3)
  })

  it('does not inherit the list query limit or change the loaded todos', () => {
    const many = Array.from({ length: 205 }, (_, index) => todo(`visible-${index}`))
    const before = [...many]
    expect(countVisibleUnplannedToDos(many, archived)).toBe(205)
    expect(many).toEqual(before)
  })
})

describe('Planner calendar archived space filtering', () => {
  function event (id: string, attachedSpace?: Ref<Space>, workSlot = true): WithLookup<Event> {
    return {
      _id: id,
      _class: workSlot ? 'work-slot' : 'calendar-event',
      $lookup: { attachedTo: todo(`todo-${id}`, { attachedSpace }) }
    } as unknown as WithLookup<Event>
  }

  const archived = 'archived-document-space' as Ref<Space>
  const slot = event('hidden-slot', archived)
  const active = event('active-slot', ACTIVE_PROJECT)
  const standalone = event('no-space-slot')
  const regular = event('regular-event', archived, false)
  const missing = { _id: 'missing-todo', _class: 'work-slot' } as unknown as WithLookup<Event>
  const events = [slot, active, standalone, regular, missing]
  const isWorkSlot = (value: Event): boolean => String(value._class) === 'work-slot'

  it('hides slots whose todo belongs to any archived space, keeping ordinary calendar events', () => {
    expect(filterVisibleWorkSlots(events, new Set([archived]), isWorkSlot)).toEqual([
      active,
      standalone,
      regular,
      missing
    ])
  })

  it('restores the original slots on unarchive without changing the events', () => {
    expect(filterVisibleWorkSlots(events, new Set(), isWorkSlot)).toEqual(events)
    expect(events[0]).toBe(slot)
  })
})
