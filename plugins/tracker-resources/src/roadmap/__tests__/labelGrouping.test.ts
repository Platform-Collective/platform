//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

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
