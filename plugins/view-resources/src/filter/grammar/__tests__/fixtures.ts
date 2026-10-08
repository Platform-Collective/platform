//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { FieldSpec, FilterContext, IterationInfo } from '../types'

export const DAY = 24 * 60 * 60 * 1000
// Wednesday, local noon
export const NOW = new Date(2026, 5, 17, 12, 0, 0).getTime()

export const ITERATIONS: IterationInfo[] = [
  { id: 'it1', title: 'Sprint 1', start: new Date(2026, 5, 1).getTime(), end: new Date(2026, 5, 14, 23, 59, 59, 999).getTime() },
  { id: 'it2', title: 'Sprint 2', start: new Date(2026, 5, 15).getTime(), end: new Date(2026, 5, 28, 23, 59, 59, 999).getTime() },
  { id: 'it3', title: 'Sprint 3', start: new Date(2026, 5, 29).getTime(), end: new Date(2026, 6, 12, 23, 59, 59, 999).getTime() },
  { id: 'it4', title: 'Sprint 4', start: new Date(2026, 6, 13).getTime(), end: new Date(2026, 6, 26, 23, 59, 59, 999).getTime() }
]

export const schema: FieldSpec[] = [
  { name: 'title', label: 'Title', type: 'text', source: 'attribute', key: 'title' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    source: 'attribute',
    key: 'status',
    options: [
      { id: 'st-todo', name: 'Todo' },
      { id: 'st-progress', name: 'In Progress' },
      { id: 'st-done', name: 'Done' },
      { id: 'st-canceled', name: 'Canceled' }
    ]
  },
  {
    name: 'priority',
    label: 'Priority',
    type: 'select',
    source: 'attribute',
    key: 'priority',
    options: [
      { id: 0, name: 'No priority' },
      { id: 1, name: 'Urgent' },
      { id: 2, name: 'High' },
      { id: 3, name: 'Medium' },
      { id: 4, name: 'Low' }
    ]
  },
  {
    name: 'assignee',
    label: 'Assignee',
    type: 'user',
    source: 'attribute',
    key: 'assignee',
    options: [
      { id: 'p-alice', name: 'Alice' },
      { id: 'p-bob', name: 'Bob Smith' }
    ]
  },
  {
    name: 'milestone',
    label: 'Milestone',
    type: 'select',
    source: 'attribute',
    key: 'milestone',
    options: [
      { id: 'm1', name: 'v1' },
      { id: 'm2', name: 'v2' }
    ]
  },
  { name: 'due', label: 'Due date', type: 'date', source: 'attribute', key: 'dueDate' },
  { name: 'estimate', label: 'Estimate', type: 'number', source: 'attribute', key: 'estimation' },
  {
    name: 'label',
    label: 'Label',
    type: 'multi',
    source: 'attribute',
    key: 'labels',
    options: [
      { id: 'l-bug', name: 'bug' },
      { id: 'l-ui', name: 'ui' },
      { id: 'l-gfi', name: 'good first issue' }
    ],
    read: (doc) => doc.labelIds,
    resolveDocIds: (optionIds) => LABELLED.filter((d) => d.labelIds.some((l: string) => optionIds.includes(l))).map((d) => d._id)
  },
  {
    name: 'parent-issue',
    label: 'Parent issue',
    type: 'presence',
    source: 'attribute',
    key: 'attachedTo',
    read: (doc) => (doc.attachedTo === 'no-parent' ? undefined : doc.attachedTo),
    presenceQuery: (present) => ({ attachedTo: present ? { $ne: 'no-parent' } : 'no-parent' })
  },
  { name: 'story-points', label: 'Story points', type: 'number', source: 'custom', key: 'storyPoints' },
  { name: 'notes', label: 'Notes', type: 'text', source: 'custom', key: 'notes' },
  { name: 'target', label: 'Target', type: 'date', source: 'custom', key: 'target' },
  {
    name: 'size',
    label: 'Size',
    type: 'select',
    source: 'custom',
    key: 'size',
    options: [
      { id: 'o-s', name: 'S' },
      { id: 'o-m', name: 'M' },
      { id: 'o-l', name: 'L' }
    ]
  },
  {
    name: 'area',
    label: 'Area',
    type: 'multi',
    source: 'custom',
    key: 'area',
    options: [
      { id: 'o-fe', name: 'Frontend' },
      { id: 'o-be', name: 'Backend' }
    ]
  },
  { name: 'iteration', label: 'Iteration', type: 'iteration', source: 'custom', key: 'iter' }
]

export const ctx: FilterContext = {
  now: NOW,
  me: 'p-alice',
  iterations: () => ITERATIONS,
  closedStatuses: new Set(['st-done', 'st-canceled']),
  noParentId: 'no-parent'
}

let n = 0
export function issue (props: Record<string, any>): any {
  n++
  return {
    _id: `i${n}`,
    title: 'Untitled',
    status: 'st-todo',
    priority: 0,
    assignee: null,
    milestone: null,
    dueDate: null,
    estimation: 0,
    labelIds: [],
    attachedTo: 'no-parent',
    ...props
  }
}

export const ISSUES: any[] = [
  issue({ title: 'Fix login bug', status: 'st-progress', priority: 1, assignee: 'p-alice', labelIds: ['l-bug'], dueDate: NOW, estimation: 5, milestone: 'm1', customFields: { storyPoints: 3, size: 'o-m', notes: 'Needs QA', area: ['o-fe'], target: NOW + 3 * DAY, iter: 'it2' } }),
  issue({ title: 'Add dark theme', status: 'st-todo', priority: 3, assignee: 'p-bob', labelIds: ['l-ui', 'l-gfi'], dueDate: NOW - 10 * DAY, estimation: 8, milestone: 'm2', customFields: { storyPoints: 8, size: 'o-l', area: ['o-fe', 'o-be'], iter: 'it3' } }),
  issue({ title: 'Release notes', status: 'st-done', priority: 4, assignee: 'p-alice', labelIds: [], dueDate: NOW + 20 * DAY, estimation: 1, customFields: { storyPoints: 1, size: 'o-s', iter: 'it1' } }),
  issue({ title: 'Refactor API 100% coverage', status: 'st-canceled', priority: 2, labelIds: ['l-bug', 'l-ui'], attachedTo: 'i1', estimation: 13, customFields: { storyPoints: 13, area: [] } }),
  issue({ title: 'Plain issue', status: 'st-progress', priority: 0, assignee: 'p-bob' })
]

// Referenced by the label field before it is initialised
export const LABELLED = ISSUES
