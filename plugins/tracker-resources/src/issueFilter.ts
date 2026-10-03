//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Iteration, ProjectField } from '@hcengineering/tracker'
import {
  buildIssueFilterSchema as buildSharedIssueFilterSchema,
  fieldFilterName,
  ProjectFieldType,
  type IssueFilterSchemaInput,
  type NamedOption
} from '@hcengineering/tracker'
import type { filterGrammar } from '@hcengineering/view-resources'

import { isFilterComplete, type CustomFieldFilter } from './projectFields/query'

// Glue between the filter grammar (view-resources) and the tracker's issues: the field schema
// the grammar parses against, and the conversion of the legacy custom-field rules into filter text.
// The schema itself is built in `@hcengineering/tracker`, because the server workflows parse filters with it too.

type FieldSpec = filterGrammar.FieldSpec

export { fieldFilterName }
export type { IssueFilterSchemaInput, NamedOption }

/**
 * Fields a project's issues can be filtered by: the built-in attributes first, then the project's
 * custom fields. A custom field whose name collides with an earlier one is not filterable by string.
 */
export function buildIssueFilterSchema (input: IssueFilterSchemaInput): FieldSpec[] {
  return buildSharedIssueFilterSchema(input)
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
