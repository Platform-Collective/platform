//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { getAssignableIterations } from './iteration'
import { ProjectFieldType, type ProjectField } from './projectField'
import type { Iteration } from './iteration'

// The fields the issues of a project can be filtered by with the filter grammar (view-resources). It is used by
// the project views on the client and by the server workflows, so that a filter means the same in both places.
// The types below repeat the shape of the grammar's `FieldSpec` (that package is not available to the server and
// to this one); a value is assignable to it.

/**
 * @public
 */
export type IssueFilterFieldType = 'text' | 'number' | 'date' | 'select' | 'multi' | 'user' | 'iteration' | 'presence'

/**
 * @public
 */
export interface IssueFilterOption {
  id: string | number
  name: string
}

/**
 * Same shape as the grammar's `FieldSpec`.
 * @public
 */
export interface IssueFilterField {
  name: string
  label: string
  type: IssueFilterFieldType
  source: 'attribute' | 'custom'
  key: string
  options?: IssueFilterOption[]
  read?: (doc: any) => unknown
  resolveDocIds?: (optionIds: Array<string | number>) => string[]
  presenceQuery?: (present: boolean) => Record<string, any>
  dependsOn?: string[]
  clientOnly?: boolean
}

/**
 * @public
 */
export interface NamedOption {
  id: string | number
  name: string
}

/**
 * @public
 */
export interface IssueFilterSchemaInput {
  statuses: NamedOption[]
  priorities: NamedOption[]
  assignees: NamedOption[]
  components: NamedOption[]
  milestones: NamedOption[]
  // Label (tag element) options
  labels: NamedOption[]
  // Tag references: which issue carries which label
  labelRefs: Array<{ issue: string, label: string }>
  customFields: ProjectField[]
  // Iterations of the iteration fields among the custom fields
  iterations?: readonly Iteration[]
  // Value of Issue.attachedTo for an issue without a parent
  noParentId: string
}

const NAME_PATTERN = /^\p{L}[\p{L}\p{N}_.-]*$/u

/**
 * Name of a user-defined field in a filter: its label lowercased with spaces replaced by hyphens
 * (GitHub's convention). A label that does not make a valid name falls back to the field key.
 */
export function fieldFilterName (label: string, key: string): string {
  const slug = label.trim().toLowerCase().replace(/\s+/g, '-')
  return NAME_PATTERN.test(slug) ? slug : key.toLowerCase()
}

function customFieldType (type: ProjectFieldType): IssueFilterFieldType {
  switch (type) {
    case ProjectFieldType.Number:
      return 'number'
    case ProjectFieldType.Date:
      return 'date'
    case ProjectFieldType.SingleSelect:
      return 'select'
    case ProjectFieldType.MultiSelect:
      return 'multi'
    case ProjectFieldType.Iteration:
      return 'iteration'
    default:
      return 'text'
  }
}

/**
 * Fields a project's issues can be filtered by: the built-in attributes first, then the project's
 * custom fields. A custom field whose name collides with an earlier one is not filterable by string.
 */
export function buildIssueFilterSchema (input: IssueFilterSchemaInput): IssueFilterField[] {
  const labelsByIssue = new Map<string, string[]>()
  for (const ref of input.labelRefs) {
    const list = labelsByIssue.get(ref.issue)
    if (list === undefined) labelsByIssue.set(ref.issue, [ref.label])
    else list.push(ref.label)
  }
  const options = (list: NamedOption[]): IssueFilterOption[] => list.map((o) => ({ id: o.id, name: o.name }))

  const schema: IssueFilterField[] = [
    { name: 'title', label: 'Title', type: 'text', source: 'attribute', key: 'title' },
    { name: 'status', label: 'Status', type: 'select', source: 'attribute', key: 'status', options: options(input.statuses) },
    {
      name: 'priority',
      label: 'Priority',
      type: 'select',
      source: 'attribute',
      key: 'priority',
      options: options(input.priorities)
    },
    {
      name: 'assignee',
      label: 'Assignee',
      type: 'user',
      source: 'attribute',
      key: 'assignee',
      options: options(input.assignees)
    },
    {
      name: 'label',
      label: 'Label',
      type: 'multi',
      source: 'attribute',
      key: 'labels',
      options: options(input.labels),
      // Labels are separate documents: the issues that carry them are looked up by id
      read: (doc) => labelsByIssue.get(doc._id) ?? [],
      resolveDocIds: (ids) => {
        const wanted = new Set(ids.map(String))
        const res: string[] = []
        for (const [issue, labels] of labelsByIssue) {
          if (labels.some((l) => wanted.has(l))) res.push(issue)
        }
        return res
      }
    },
    {
      name: 'component',
      label: 'Component',
      type: 'select',
      source: 'attribute',
      key: 'component',
      options: options(input.components)
    },
    {
      name: 'milestone',
      label: 'Milestone',
      type: 'select',
      source: 'attribute',
      key: 'milestone',
      options: options(input.milestones)
    },
    { name: 'due', label: 'Due date', type: 'date', source: 'attribute', key: 'dueDate' },
    { name: 'start', label: 'Start date', type: 'date', source: 'attribute', key: 'startDate' },
    { name: 'deadline', label: 'Deadline', type: 'date', source: 'attribute', key: 'deadline' },
    { name: 'estimate', label: 'Estimate', type: 'number', source: 'attribute', key: 'estimation' },
    // When the issue was last changed (GitHub's `updated:`), e.g. `updated:<@today-2w`
    { name: 'updated', label: 'Updated', type: 'date', source: 'attribute', key: 'modifiedOn' },
    {
      name: 'parent-issue',
      label: 'Parent issue',
      type: 'presence',
      source: 'attribute',
      key: 'attachedTo',
      read: (doc) => (doc.attachedTo === input.noParentId ? undefined : doc.attachedTo),
      presenceQuery: (present) => ({ attachedTo: present ? { $ne: input.noParentId } : input.noParentId })
    },
    {
      name: 'sub-issues',
      label: 'Sub-issues',
      type: 'presence',
      source: 'attribute',
      key: 'subIssues',
      read: (doc) => (typeof doc.subIssues === 'number' && doc.subIssues > 0 ? doc.subIssues : undefined),
      presenceQuery: (present) => ({ subIssues: present ? { $gt: 0 } : 0 })
    }
  ]

  const taken = new Set(schema.map((f) => f.name))
  for (const field of input.customFields) {
    const name = fieldFilterName(field.label, field.key)
    if (taken.has(name)) continue
    taken.add(name)
    schema.push({
      name,
      label: field.label,
      type: customFieldType(field.type),
      source: 'custom',
      key: field.key,
      options:
        field.type === ProjectFieldType.Iteration
          ? getAssignableIterations((input.iterations ?? []).filter((it) => it.field === field._id)).map((it) => ({
            id: it._id,
            name: it.label
          }))
          : field.options?.map((o) => ({ id: o.value, name: o.label }))
    })
  }
  return schema
}
