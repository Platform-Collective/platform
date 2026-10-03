//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { groupItems, groupIdOf, sortGroupsByLabel } from '../grouping'
import {
  buildItemLabel,
  customLabelFieldId,
  LABEL_SEPARATOR,
  parseCustomLabelFieldId,
  toggleLabelField,
  type LabelResolvers
} from '../label'

interface Item {
  identifier?: string
  title: string
  estimation?: number
  status?: string
  assignee?: string
  tags?: string[]
  custom?: Record<string, string>
}

const resolvers: LabelResolvers<Item> = {
  status: (i) => i.status,
  assignee: (i) => i.assignee,
  priority: () => 'High',
  component: () => undefined,
  milestone: () => undefined,
  labels: (i) => i.tags ?? [],
  custom: (i, key) => i.custom?.[key]
}

describe('buildItemLabel', () => {
  const issue: Item = {
    identifier: 'TSK-4',
    title: 'Fix login',
    estimation: 3,
    status: 'In Progress',
    assignee: 'Ann',
    tags: ['bug', 'ui'],
    custom: { size: 'L' }
  }

  it('joins the chosen fields in the order given', () => {
    expect(buildItemLabel(issue, ['identifier', 'title'], resolvers)).toBe(`TSK-4${LABEL_SEPARATOR}Fix login`)
    expect(buildItemLabel(issue, ['title', 'identifier'], resolvers)).toBe(`Fix login${LABEL_SEPARATOR}TSK-4`)
  })

  it('renders every kind of field', () => {
    const text = buildItemLabel(
      issue,
      ['status', 'assignee', 'priority', 'labels', 'estimation', customLabelFieldId('size')],
      resolvers
    )
    expect(text).toBe(['In Progress', 'Ann', 'High', 'bug, ui', '3 h', 'L'].join(LABEL_SEPARATOR))
  })

  it('leaves out fields without a value and unknown fields', () => {
    expect(buildItemLabel({ title: 'x' }, ['identifier', 'component', 'estimation', 'labels', 'bogus', 'cf:nope'], resolvers)).toBe('')
    expect(buildItemLabel({ title: 'x', estimation: 0 }, ['title', 'estimation'], resolvers)).toBe('x')
  })

  it('is empty without fields', () => {
    expect(buildItemLabel(issue, [], resolvers)).toBe('')
  })
})

describe('label field ids', () => {
  it('round trips custom field ids', () => {
    expect(parseCustomLabelFieldId(customLabelFieldId('size'))).toBe('size')
    expect(parseCustomLabelFieldId('title')).toBeUndefined()
  })

  it('toggles a field and keeps the canonical order', () => {
    const all = ['identifier', 'title', 'status', 'assignee']
    expect(toggleLabelField(['title'], 'identifier', all)).toEqual(['identifier', 'title'])
    expect(toggleLabelField(['identifier', 'title'], 'identifier', all)).toEqual(['title'])
    expect(toggleLabelField([], 'assignee', all)).toEqual(['assignee'])
  })
})

describe('groupItems', () => {
  const items = [
    { id: 1, g: 'b' },
    { id: 2, g: 'a' },
    { id: 3, g: undefined },
    { id: 4, g: 'b' },
    { id: 5, g: 'c' },
    { id: 6, g: '' }
  ]
  const valueOf = (i: { g: string | undefined }): string | undefined => i.g

  it('groups in first-seen order with the empty group last and keeps the item order', () => {
    const groups = groupItems(items, valueOf)
    expect(groups.map((g) => [g.value, g.items.map((i) => i.id)])).toEqual([
      ['b', [1, 4]],
      ['a', [2]],
      ['c', [5]],
      [undefined, [3, 6]]
    ])
    expect(groups[3].id).toBe(groupIdOf(undefined))
  })

  it('follows the given order and appends values it does not know', () => {
    const groups = groupItems(items, valueOf, ['c', 'a', 'zzz'])
    expect(groups.map((g) => g.value)).toEqual(['c', 'a', 'b', undefined])
  })

  it('lists empty groups of the order on request', () => {
    const groups = groupItems(items.slice(0, 2), valueOf, ['z', 'a', 'b', undefined], true)
    expect(groups.map((g) => [g.value, g.items.length])).toEqual([
      ['z', 0],
      ['a', 1],
      ['b', 1],
      [undefined, 0]
    ])
  })

  it('has no groups without items', () => {
    expect(groupItems([], valueOf)).toEqual([])
  })

  it('sorts groups by label with the empty group last', () => {
    const groups = groupItems(items, valueOf)
    const sorted = sortGroupsByLabel(groups, (v) => ({ a: 'Zed', b: 'Alpha', c: 'Mid' })[v] ?? v)
    expect(sorted.map((g) => g.value)).toEqual(['b', 'c', 'a', undefined])
  })
})
