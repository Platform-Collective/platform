//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// The text on a roadmap item: the fields chosen in the Fields menu, joined with a separator.

export const LABEL_FIELD_IDENTIFIER = 'identifier'
export const LABEL_FIELD_TITLE = 'title'
export const LABEL_FIELD_STATUS = 'status'
export const LABEL_FIELD_ASSIGNEE = 'assignee'
export const LABEL_FIELD_PRIORITY = 'priority'
export const LABEL_FIELD_COMPONENT = 'component'
export const LABEL_FIELD_MILESTONE = 'milestone'
export const LABEL_FIELD_LABELS = 'labels'
export const LABEL_FIELD_ESTIMATION = 'estimation'
export const CUSTOM_LABEL_PREFIX = 'cf:'

/** Built-in label fields in the order they are offered. */
export const BUILTIN_LABEL_FIELDS: readonly string[] = [
  LABEL_FIELD_IDENTIFIER,
  LABEL_FIELD_TITLE,
  LABEL_FIELD_STATUS,
  LABEL_FIELD_ASSIGNEE,
  LABEL_FIELD_PRIORITY,
  LABEL_FIELD_LABELS,
  LABEL_FIELD_COMPONENT,
  LABEL_FIELD_MILESTONE,
  LABEL_FIELD_ESTIMATION
]

export function customLabelFieldId (fieldKey: string): string {
  return `${CUSTOM_LABEL_PREFIX}${fieldKey}`
}

export function parseCustomLabelFieldId (id: string): string | undefined {
  return id.startsWith(CUSTOM_LABEL_PREFIX) ? id.slice(CUSTOM_LABEL_PREFIX.length) : undefined
}

export interface LabelIssue {
  identifier?: string
  title: string
  estimation?: number
}

/** Text of the other fields of an item; undefined or empty for a field the item has no value in. */
export interface LabelResolvers<I extends LabelIssue> {
  status: (issue: I) => string | undefined
  assignee: (issue: I) => string | undefined
  priority: (issue: I) => string | undefined
  component: (issue: I) => string | undefined
  milestone: (issue: I) => string | undefined
  labels: (issue: I) => string[]
  custom: (issue: I, fieldKey: string) => string | undefined
}

export const LABEL_SEPARATOR = ' · '

/** The label of an item for the chosen fields, in the order of `fields`; fields without a value are left out. */
export function buildItemLabel<I extends LabelIssue> (issue: I, fields: readonly string[], r: LabelResolvers<I>): string {
  const parts: string[] = []
  for (const id of fields) {
    let text: string | undefined
    switch (id) {
      case LABEL_FIELD_IDENTIFIER:
        text = issue.identifier
        break
      case LABEL_FIELD_TITLE:
        text = issue.title
        break
      case LABEL_FIELD_STATUS:
        text = r.status(issue)
        break
      case LABEL_FIELD_ASSIGNEE:
        text = r.assignee(issue)
        break
      case LABEL_FIELD_PRIORITY:
        text = r.priority(issue)
        break
      case LABEL_FIELD_COMPONENT:
        text = r.component(issue)
        break
      case LABEL_FIELD_MILESTONE:
        text = r.milestone(issue)
        break
      case LABEL_FIELD_LABELS:
        text = r.labels(issue).join(', ')
        break
      case LABEL_FIELD_ESTIMATION:
        text = issue.estimation !== undefined && issue.estimation > 0 ? `${issue.estimation} h` : undefined
        break
      default: {
        const key = parseCustomLabelFieldId(id)
        text = key !== undefined ? r.custom(issue, key) : undefined
      }
    }
    if (text !== undefined && text.trim() !== '') parts.push(text.trim())
  }
  return parts.join(LABEL_SEPARATOR)
}

/** Adds or removes a field id, keeping the order of `all` so that the label does not depend on the click order. */
export function toggleLabelField (selected: readonly string[], id: string, all: readonly string[]): string[] {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return all.filter((it) => next.has(it))
}
