//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType, type Iteration, type ProjectField } from '@hcengineering/tracker'
import { buildIssueFilterSchema } from '../../issueFilter'
import { buildChartFields, type ChartFields } from '../fields'

function field (key: string, label: string, type: ProjectFieldType, options?: Array<[string, string]>): ProjectField {
  return {
    _id: `f-${key}`,
    key,
    label,
    type,
    position: 0,
    options: options?.map(([value, l]) => ({ value, label: l }))
  } as unknown as ProjectField
}

export const customFields = [
  field('size', 'Size', ProjectFieldType.SingleSelect, [
    ['s', 'Small'],
    ['m', 'Medium'],
    ['l', 'Large']
  ]),
  field('areas', 'Areas', ProjectFieldType.MultiSelect, [
    ['ui', 'UI'],
    ['api', 'API']
  ]),
  field('points', 'Points', ProjectFieldType.Number),
  field('notes', 'Notes', ProjectFieldType.Text),
  field('shipped', 'Shipped', ProjectFieldType.Date),
  field('sprint', 'Sprint', ProjectFieldType.Iteration)
]

export const iterations = [
  { _id: 'it1', label: 'Iteration 1', field: 'f-sprint', isBreak: false, startDate: 0, duration: 7 },
  { _id: 'it2', label: 'Iteration 2', field: 'f-sprint', isBreak: false, startDate: 0, duration: 7 }
] as unknown as Iteration[]

export function makeFields (): ChartFields {
  const schema = buildIssueFilterSchema({
    statuses: [
      { id: 'done', name: 'Done' },
      { id: 'todo', name: 'Todo' },
      { id: 'doing', name: 'Doing' }
    ],
    priorities: [
      { id: 0, name: 'No priority' },
      { id: 1, name: 'Urgent' },
      { id: 2, name: 'High' }
    ],
    assignees: [
      { id: 'u-zed', name: 'Zed' },
      { id: 'u-amy', name: 'Amy' }
    ],
    components: [{ id: 'c1', name: 'Backend' }],
    milestones: [{ id: 'm1', name: 'v1' }],
    labels: [
      { id: 'l-bug', name: 'bug' },
      { id: 'l-ui', name: 'ui' }
    ],
    labelRefs: [
      { issue: 'i1', label: 'l-bug' },
      { issue: 'i1', label: 'l-ui' },
      { issue: 'i2', label: 'l-bug' }
    ],
    customFields,
    iterations,
    noParentId: 'no-parent'
  })
  return buildChartFields({ schema, statusOrder: ['todo', 'doing', 'done'] })
}

export const noneLabel = (label: string): string => `No ${label}`
