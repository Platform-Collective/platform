//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { customFieldKeyOf, hasCardFooter, planCardFields, type CardFooterFacts } from '../cardFields'

// The field list the board starts with: the look the cards had before they followed the list
const defaultList = [
  'assignee',
  'subIssues',
  'priority',
  'component',
  'milestone',
  'dueDate',
  'labels',
  'estimation',
  'attachments',
  'comments'
]

const fieldColumn = (fieldKey: string): { key: string, props: { fieldKey: string }, displayProps: { key: string } } => ({
  key: '',
  props: { fieldKey },
  displayProps: { key: `cf_${fieldKey}` }
})

describe('planCardFields', () => {
  it('shows everything of the default list', () => {
    expect(planCardFields(defaultList)).toEqual({
      assignee: true,
      chips: [
        { kind: 'builtin', id: 'subIssues' },
        { kind: 'builtin', id: 'priority' },
        { kind: 'builtin', id: 'component' },
        { kind: 'builtin', id: 'milestone' },
        { kind: 'builtin', id: 'dueDate' }
      ],
      labels: true,
      estimation: true,
      attachments: true,
      comments: true
    })
  })

  it('shows nothing but the title for an empty list', () => {
    expect(planCardFields([])).toEqual({
      assignee: false,
      chips: [],
      labels: false,
      estimation: false,
      attachments: false,
      comments: false
    })
  })

  it('follows the order of the list for the chips', () => {
    const plan = planCardFields(['milestone', 'priority', fieldColumn('stage'), 'dueDate'])
    expect(plan.chips).toEqual([
      { kind: 'builtin', id: 'milestone' },
      { kind: 'builtin', id: 'priority' },
      { kind: 'custom', fieldKey: 'stage' },
      { kind: 'builtin', id: 'dueDate' }
    ])
  })

  it('switches single fields on and off', () => {
    const plan = planCardFields(['labels', { key: 'comments' }])
    expect(plan.labels).toBe(true)
    expect(plan.comments).toBe(true)
    expect(plan.assignee).toBe(false)
    expect(plan.estimation).toBe(false)
    expect(plan.chips).toEqual([])
  })

  it('shows a custom field and an iteration field as chips', () => {
    const plan = planCardFields([fieldColumn('stage'), fieldColumn('sprint')])
    expect(plan.chips).toEqual([
      { kind: 'custom', fieldKey: 'stage' },
      { kind: 'custom', fieldKey: 'sprint' }
    ])
  })

  it('ignores repeats and fields it does not know', () => {
    const plan = planCardFields(['priority', 'priority', fieldColumn('a'), fieldColumn('a'), 'title', { key: 'kind' }, ''])
    expect(plan.chips).toEqual([
      { kind: 'builtin', id: 'priority' },
      { kind: 'custom', fieldKey: 'a' }
    ])
  })
})

describe('customFieldKeyOf', () => {
  it('reads the field key of a custom field column only', () => {
    expect(customFieldKeyOf(fieldColumn('stage'))).toBe('stage')
    expect(customFieldKeyOf('priority')).toBeUndefined()
    expect(customFieldKeyOf({ key: 'labels' })).toBeUndefined()
    expect(customFieldKeyOf({ key: '', props: { fieldKey: '' } })).toBeUndefined()
    expect(customFieldKeyOf({ key: '', props: { fieldKey: 4 } })).toBeUndefined()
  })
})

describe('hasCardFooter', () => {
  const facts = (over: Partial<CardFooterFacts> = {}): CardFooterFacts => ({
    reportedTime: 0,
    childEstimation: 0,
    comments: 0,
    parentComments: 0,
    attachments: 0,
    ...over
  })
  const all = planCardFields(defaultList)

  it('has nothing to show for an issue without activity', () => {
    expect(hasCardFooter(all, facts())).toBe(false)
  })

  it('shows what the list switched on', () => {
    expect(hasCardFooter(all, facts({ reportedTime: 2 }))).toBe(true)
    expect(hasCardFooter(all, facts({ childEstimation: 1 }))).toBe(true)
    expect(hasCardFooter(all, facts({ comments: 1 }))).toBe(true)
    expect(hasCardFooter(all, facts({ parentComments: 3 }))).toBe(true)
    expect(hasCardFooter(all, facts({ attachments: 1 }))).toBe(true)
  })

  it('has no footer for the fields that are switched off', () => {
    const none = planCardFields([])
    expect(hasCardFooter(none, facts({ reportedTime: 2, comments: 1, attachments: 1 }))).toBe(false)
    expect(hasCardFooter(planCardFields(['comments']), facts({ attachments: 4, reportedTime: 1 }))).toBe(false)
    expect(hasCardFooter(planCardFields(['comments']), facts({ comments: 4 }))).toBe(true)
  })
})
