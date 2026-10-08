//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import { ProjectFieldType, type Iteration } from '@hcengineering/tracker'
import {
  buildColumnCategories,
  buildLaneCategories,
  categoryKey,
  categoryOfItem,
  fieldOfKey,
  groupByCustomField,
  isCustomDimensionKey,
  isVisibleCategory,
  partitionColumns
} from '../columns'

const stage = {
  key: 'stage',
  type: ProjectFieldType.SingleSelect,
  options: [
    { value: 'todo', label: 'To do' },
    { value: 'doing', label: 'Doing' },
    { value: 'done', label: 'Done' }
  ]
}

const day = 24 * 60 * 60 * 1000
const sprint = { key: 'sprint', type: ProjectFieldType.Iteration }
const iterations: Array<Pick<Iteration, '_id' | 'startDate' | 'number' | 'isBreak'>> = [
  { _id: 'i2' as Ref<Iteration>, startDate: 14 * day, number: 2 },
  { _id: 'ib' as Ref<Iteration>, startDate: 7 * day, number: 0, isBreak: true },
  { _id: 'i1' as Ref<Iteration>, startDate: 0, number: 1 },
  { _id: 'i3' as Ref<Iteration>, startDate: 21 * day, number: 3 }
]

const issue = (id: string, customFields?: Record<string, unknown>): { id: string, customFields?: Record<string, unknown> } => ({
  id,
  customFields
})

describe('categoryKey', () => {
  it('is the name of a category object and the string of anything else', () => {
    expect(categoryKey({ name: 'Todo', values: [] })).toBe('Todo')
    expect(categoryKey('abc')).toBe('abc')
    expect(categoryKey(3)).toBe('3')
    expect(categoryKey(undefined)).toBe('undefined')
  })
})

describe('keys', () => {
  it('recognizes the keys of custom fields', () => {
    expect(isCustomDimensionKey('customFields.stage')).toBe(true)
    expect(isCustomDimensionKey('status')).toBe(false)
    expect(isCustomDimensionKey('customFields.')).toBe(false)
  })

  it('finds the field of a key', () => {
    const byKey = new Map([['stage', stage]])
    expect(fieldOfKey('customFields.stage', byKey)).toBe(stage)
    expect(fieldOfKey('customFields.nope', byKey)).toBeUndefined()
    expect(fieldOfKey('status', byKey)).toBeUndefined()
  })
})

describe('categoryOfItem and groupByCustomField', () => {
  it('reads an id, and nothing for empty values', () => {
    expect(categoryOfItem(issue('a', { stage: 'todo' }), 'stage')).toBe('todo')
    expect(categoryOfItem(issue('a', { stage: '' }), 'stage')).toBeUndefined()
    expect(categoryOfItem(issue('a', { stage: null }), 'stage')).toBeUndefined()
    expect(categoryOfItem(issue('a', { stage: 5 }), 'stage')).toBeUndefined()
    expect(categoryOfItem(issue('a'), 'stage')).toBeUndefined()
  })

  it('groups by the value and keeps the order of the items', () => {
    const items = [
      issue('1', { stage: 'doing' }),
      issue('2'),
      issue('3', { stage: 'todo' }),
      issue('4', { stage: 'doing' }),
      issue('5', { other: 'x' })
    ]
    const groups = groupByCustomField(items, 'stage')
    expect(groups.doing.map((i) => i.id)).toEqual(['1', '4'])
    expect(groups.todo.map((i) => i.id)).toEqual(['3'])
    expect(groups[categoryKey(undefined)].map((i) => i.id)).toEqual(['2', '5'])
  })
})

describe('buildColumnCategories', () => {
  it('lists No value first, then every option, also empty ones', () => {
    expect(buildColumnCategories(stage, [], [])).toEqual([undefined, 'todo', 'doing', 'done'])
    expect(buildColumnCategories(stage, [], [issue('1', { stage: 'done' })])).toEqual([
      undefined,
      'todo',
      'doing',
      'done'
    ])
  })

  it('appends a value that is no option any more', () => {
    expect(buildColumnCategories(stage, [], [issue('1', { stage: 'removed' })])).toEqual([
      undefined,
      'todo',
      'doing',
      'done',
      'removed'
    ])
  })

  it('orders iterations by date, leaves out breaks, and puts No value first', () => {
    expect(buildColumnCategories(sprint, iterations, [])).toEqual([undefined, 'i1', 'i2', 'i3'])
  })

  it('has just the No value column for a field without options', () => {
    expect(buildColumnCategories({ key: 'x', type: ProjectFieldType.SingleSelect }, [], [])).toEqual([undefined])
  })
})

describe('buildLaneCategories', () => {
  const items = [issue('1', { stage: 'doing' }), issue('2'), issue('3', { stage: 'todo' })]

  it('lists the options that have items, in order, and No value last', () => {
    expect(buildLaneCategories(stage, [], items, false)).toEqual(['todo', 'doing', undefined])
  })

  it('lists every option with includeEmpty', () => {
    expect(buildLaneCategories(stage, [], items, true)).toEqual(['todo', 'doing', 'done', undefined])
  })

  it('has no No value lane when every item has a value', () => {
    expect(buildLaneCategories(stage, [], [issue('1', { stage: 'done' })], false)).toEqual(['done'])
  })

  it('orders iteration lanes by date', () => {
    const all = [issue('1', { sprint: 'i3' }), issue('2', { sprint: 'i1' }), issue('3')]
    expect(buildLaneCategories(sprint, iterations, all, false)).toEqual(['i1', 'i3', undefined])
  })
})

describe('hidden columns', () => {
  it('tells visible from hidden columns by key', () => {
    expect(isVisibleCategory('todo', ['done'])).toBe(true)
    expect(isVisibleCategory('done', ['done'])).toBe(false)
    expect(isVisibleCategory({ name: 'Done', values: [] }, ['Done'])).toBe(false)
    expect(isVisibleCategory(undefined, [categoryKey(undefined)])).toBe(false)
  })

  it('splits the columns and keeps their order', () => {
    const columns = [undefined, 'todo', 'doing', 'done']
    expect(partitionColumns(columns, ['todo', 'undefined'])).toEqual({ visible: ['doing', 'done'], hidden: [undefined, 'todo'] })
    expect(partitionColumns(columns, [])).toEqual({ visible: columns, hidden: [] })
  })
})
