//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Iteration, ProjectField } from '@hcengineering/tracker'
import { getAssignableIterations, ProjectFieldType } from '@hcengineering/tracker'
import type { filterGrammar } from '@hcengineering/view-resources'

import { isFilterComplete, type CustomFieldFilter } from './projectFields/query'

// Glue between the filter grammar (view-resources) and the tracker's issues: the field schema
// the grammar parses against, and the conversion of the legacy custom-field rules into filter text.

type FieldSpec = filterGrammar.FieldSpec
type FieldOption = filterGrammar.FieldOption

export interface NamedOption {
  id: string | number
  name: string
}

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

function customFieldType (type: ProjectFieldType): FieldSpec['type'] {
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
export function buildIssueFilterSchema (input: IssueFilterSchemaInput): FieldSpec[] {
  const labelsByIssue = new Map<string, string[]>()
  for (const ref of input.labelRefs) {
    const list = labelsByIssue.get(ref.issue)
    if (list === undefined) labelsByIssue.set(ref.issue, [ref.label])
    else list.push(ref.label)
  }
  const options = (list: NamedOption[]): FieldOption[] => list.map((o) => ({ id: o.id, name: o.name }))

  const schema: FieldSpec[] = [
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

function pad (n: number): string {
  return String(n).padStart(2, '0')
}

function formatDay (ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function quote (text: string): string {
  return /[\s,:()"]/.test(text) || text === '' ? `"${text.replaceAll('"', '\\"')}"` : text
}

/**
 * Filter text for the legacy custom-field rules (AND of all rules), so that they can be folded into
 * the filter string. Rules that are incomplete or refer to a field that no longer exists are skipped.
 */
export function customFilterToQuery (
  rules: readonly CustomFieldFilter[],
  fields: ReadonlyMap<string, Pick<ProjectField, 'key' | 'label' | 'type' | 'options'>>,
  // Iterations of an iteration field by its key, to name the picked ones
  iterationsOf: (fieldKey: string) => ReadonlyArray<Pick<Iteration, '_id' | 'label'>> = () => []
): string {
  const terms: string[] = []
  for (const rule of rules) {
    const field = fields.get(rule.fieldKey)
    if (field === undefined || !isFilterComplete(rule)) continue
    const name = fieldFilterName(field.label, field.key)
    const isDate = field.type === ProjectFieldType.Date
    const num = (v: number): string => (isDate ? formatDay(v) : String(v))
    const value = rule.value
    switch (rule.operator) {
      case 'isEmpty':
        terms.push(`no:${name}`)
        break
      case 'isNotEmpty':
        terms.push(`has:${name}`)
        break
      case 'contains':
        terms.push(`${name}:${quote((value as string).trim())}`)
        break
      case 'eq':
        terms.push(`${name}:${num(value as number)}`)
        break
      case 'gt':
      case 'after':
        terms.push(`${name}:>${num(value as number)}`)
        break
      case 'gte':
        terms.push(`${name}:>=${num(value as number)}`)
        break
      case 'lt':
      case 'before':
        terms.push(`${name}:<${num(value as number)}`)
        break
      case 'lte':
        terms.push(`${name}:<=${num(value as number)}`)
        break
      case 'between': {
        const range = value as { from?: number, to?: number }
        const from = range.from !== undefined ? num(range.from) : '*'
        const to = range.to !== undefined ? num(range.to) : '*'
        terms.push(`${name}:${from}..${to}`)
        break
      }
      case 'anyOf': {
        const labels = (value as string[]).map(
          (id) =>
            (field.type === ProjectFieldType.Iteration
              ? iterationsOf(field.key).find((it) => it._id === id)?.label
              : field.options?.find((o) => o.value === id)?.label) ?? id
        )
        terms.push(`${name}:${labels.map(quote).join(',')}`)
        break
      }
    }
  }
  return terms.join(' ')
}
