//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { ProjectFieldType, WORKFLOW_PRIORITY_NAMES, type Issue, type ProjectField, type WebhookEvent } from '@hcengineering/tracker'

// The JSON a project webhook receives, modelled after GitHub's `projects_v2_item` event: an `action`, the item, and for
// `edited` the `changes.field_value` with the id, name and type of the field and its value `from` and `to`.

/** Largest payload that is sent, in bytes. */
export const MAX_PAYLOAD_BYTES = 64 * 1024

const MAX_STRING = 1000
const MAX_LIST = 100

/**
 * A change of one field, as the server reads it from the documents.
 */
export interface RawFieldChange {
  // `status`, `priority`, ..., or `customFields.<key>`
  fieldId: string
  from: unknown
  to: unknown
}

/**
 * What the ids in a change resolve to.
 */
export interface ChangeLookups {
  statuses: ReadonlyMap<string, string>
  people: ReadonlyMap<string, string>
  components: ReadonlyMap<string, string>
  milestones: ReadonlyMap<string, string>
  iterations: ReadonlyMap<string, string>
  // Custom fields by key
  fields: ReadonlyMap<string, Pick<ProjectField, 'key' | 'label' | 'type' | 'options'>>
}

/**
 * The attributes of an issue a webhook reports a change of, and how each is typed in the payload.
 */
export const WATCHED_ATTRIBUTES: Readonly<Record<string, { name: string, type: string }>> = {
  title: { name: 'Title', type: 'text' },
  status: { name: 'Status', type: 'status' },
  priority: { name: 'Priority', type: 'priority' },
  assignee: { name: 'Assignee', type: 'assignee' },
  component: { name: 'Component', type: 'component' },
  milestone: { name: 'Milestone', type: 'milestone' },
  estimation: { name: 'Estimation', type: 'number' },
  startDate: { name: 'Start date', type: 'date' },
  dueDate: { name: 'Due date', type: 'date' },
  deadline: { name: 'Deadline', type: 'date' }
}

/**
 * Cuts a value down to what a payload may carry: strings are shortened, lists capped, anything that is not a plain
 * JSON value becomes null.
 */
export function boundValue (value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return depth > 2 ? null : value.slice(0, MAX_LIST).map((v) => boundValue(v, depth + 1))
  if (typeof value === 'object') {
    if (depth > 2) return null
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_LIST)) out[k] = boundValue(v, depth + 1)
    return out
  }
  return null
}

function isoDate (value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null
}

function named (id: unknown, names: ReadonlyMap<string, string>): { id: string, name: string | null } | null {
  if (id === null || id === undefined || id === '') return null
  return { id: String(id), name: names.get(String(id)) ?? null }
}

const PRIORITY_NAMES = new Map(WORKFLOW_PRIORITY_NAMES.map((p) => [String(p.id), p.name]))

/**
 * The change of one field in the form of GitHub's `changes.field_value`.
 */
export interface FieldValueChange {
  field_node_id: string
  field_name: string
  field_type: string
  from: unknown
  to: unknown
}

function describeValue (type: string, value: unknown, names: ReadonlyMap<string, string>): unknown {
  switch (type) {
    case 'date':
      return isoDate(value)
    case 'status':
    case 'assignee':
    case 'component':
    case 'milestone':
    case 'priority':
    case 'single_select':
    case 'iteration':
      return named(value, names)
    case 'multi_select':
      return Array.isArray(value) ? value.slice(0, MAX_LIST).map((v) => named(v, names)) : []
    default:
      return boundValue(value)
  }
}

/**
 * Turns a raw change into the payload form, resolving ids to names. A custom field that no longer exists is reported
 * under its key, with its values as they are stored.
 */
export function describeChange (change: RawFieldChange, lookups: ChangeLookups): FieldValueChange {
  const custom = change.fieldId.startsWith('customFields.')
  if (custom) {
    const key = change.fieldId.slice('customFields.'.length)
    const field = lookups.fields.get(key)
    if (field === undefined) {
      return {
        field_node_id: change.fieldId,
        field_name: key,
        field_type: 'unknown',
        from: boundValue(change.from),
        to: boundValue(change.to)
      }
    }
    const options = new Map<string, string>(
      field.type === ProjectFieldType.Iteration
        ? [...lookups.iterations]
        : (field.options ?? []).map((o): [string, string] => [o.value, o.label])
    )
    const type =
      field.type === ProjectFieldType.SingleSelect
        ? 'single_select'
        : field.type === ProjectFieldType.MultiSelect
          ? 'multi_select'
          : field.type
    return {
      field_node_id: change.fieldId,
      field_name: field.label,
      field_type: type,
      from: describeValue(type, change.from, options),
      to: describeValue(type, change.to, options)
    }
  }
  const attribute = WATCHED_ATTRIBUTES[change.fieldId] ?? { name: change.fieldId, type: 'text' }
  const names =
    attribute.type === 'status'
      ? lookups.statuses
      : attribute.type === 'assignee'
        ? lookups.people
        : attribute.type === 'component'
          ? lookups.components
          : attribute.type === 'milestone'
            ? lookups.milestones
            : attribute.type === 'priority'
              ? PRIORITY_NAMES
              : new Map<string, string>()
  return {
    field_node_id: change.fieldId,
    field_name: attribute.name,
    field_type: attribute.type,
    from: describeValue(attribute.type, change.from, names),
    to: describeValue(attribute.type, change.to, names)
  }
}

function sameValue (a: unknown, b: unknown): boolean {
  if (a === b) return true
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/**
 * The fields that differ between two states of an issue: the watched attributes and each custom field, one change
 * per field. A field a webhook does not report (the description, ranks, counters) never shows up.
 */
export function diffIssue (before: Partial<Issue> | undefined, after: Partial<Issue> | undefined): RawFieldChange[] {
  if (after === undefined) return []
  const changes: RawFieldChange[] = []
  for (const key of Object.keys(WATCHED_ATTRIBUTES)) {
    const from = (before as any)?.[key]
    const to = (after as any)[key]
    if (!sameValue(from, to)) changes.push({ fieldId: key, from: from ?? null, to: to ?? null })
  }
  const oldFields = before?.customFields ?? {}
  const newFields = after.customFields ?? {}
  for (const key of [...new Set([...Object.keys(oldFields), ...Object.keys(newFields)])].sort()) {
    if (!sameValue(oldFields[key], newFields[key])) {
      changes.push({ fieldId: `customFields.${key}`, from: oldFields[key] ?? null, to: newFields[key] ?? null })
    }
  }
  return changes
}

/**
 * Who made the change.
 */
export interface PayloadSender {
  // `Automation` for a change made by a project workflow
  type: 'User' | 'Automation'
  id?: string
  name?: string
}

/**
 * Everything a payload is built from.
 */
export interface PayloadInput {
  action: WebhookEvent
  deliveryId: string
  // When the event happened
  timestamp: number
  workspace: string
  project: { id: string, name?: string, identifier?: string }
  issue: {
    id: string
    identifier?: string
    title?: string
    url?: string
    createdOn?: number
    modifiedOn?: number
    archivedAt?: number | null
    // A draft item (GitHub `DraftIssue`), not an issue yet
    isDraft?: boolean
  }
  // Only for `edited`
  change?: FieldValueChange
  sender: PayloadSender
}

/**
 * The payload of an event. Free text and values are bounded; the result is plain JSON.
 */
export function buildPayload (input: PayloadInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    action: input.action,
    project_item: {
      id: input.issue.id,
      project_id: input.project.id,
      content_type: input.issue.isDraft === true ? 'DraftIssue' : 'Issue',
      content_id: input.issue.id,
      identifier: boundValue(input.issue.identifier),
      title: boundValue(input.issue.title),
      url: boundValue(input.issue.url),
      created_at: isoDate(input.issue.createdOn),
      updated_at: isoDate(input.issue.modifiedOn),
      archived_at: isoDate(input.issue.archivedAt)
    },
    project: {
      id: input.project.id,
      name: boundValue(input.project.name),
      identifier: boundValue(input.project.identifier)
    },
    workspace: { url: boundValue(input.workspace) },
    sender: { type: input.sender.type, id: boundValue(input.sender.id), name: boundValue(input.sender.name) },
    delivery: { id: input.deliveryId, sent_at: new Date(input.timestamp).toISOString() }
  }
  if (input.action === 'edited' && input.change !== undefined) {
    payload.changes = {
      field_value: {
        ...input.change,
        field_name: boundValue(input.change.field_name),
        from: boundValue(input.change.from),
        to: boundValue(input.change.to)
      }
    }
  }
  return payload
}

/**
 * The exact bytes that are sent and signed. A payload over the limit is sent without the old and new value of the change
 * (the field is still named), so a receiver can always tell what happened.
 */
export function serializePayload (payload: Record<string, unknown>): string {
  let body = JSON.stringify(payload)
  if (Buffer.byteLength(body, 'utf8') <= MAX_PAYLOAD_BYTES) return body
  const changes = payload.changes as { field_value: Record<string, unknown> } | undefined
  const trimmed: Record<string, unknown> = {
    ...payload,
    truncated: true,
    changes:
      changes !== undefined ? { field_value: { ...changes.field_value, from: null, to: null } } : undefined
  }
  body = JSON.stringify(trimmed)
  if (Buffer.byteLength(body, 'utf8') <= MAX_PAYLOAD_BYTES) return body
  // Nothing left to drop but the free text
  const item = { ...(payload.project_item as Record<string, unknown>), title: null, url: null }
  return JSON.stringify({ ...trimmed, project_item: item })
}
