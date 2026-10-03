//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { generateId, type DocumentUpdate, type TxOperations } from '@hcengineering/core'
import tags from '@hcengineering/tags'
import type { Issue, ProjectField } from '@hcengineering/tracker'
import { IssuePriority, ProjectFieldType, getFieldValue } from '@hcengineering/tracker'
import { tableEdit } from '@hcengineering/view-resources'

import { mergeCustomFieldValue } from '../projectFields/registry'

type CellColumn = tableEdit.CellColumn<Issue>
type EditOp = tableEdit.EditOp
type ValueOption<Id extends string | number = string> = tableEdit.ValueOption<Id>

/** Label of an issue (a tag reference), as far as bulk editing needs it. */
export interface IssueLabelRef {
  // Id of the reference
  _id: string
  // Id of the label (tag element)
  tag: string
  title: string
  color: number
}

/** What the cells of the issue table can be set to. The lists follow the project that is shown. */
export interface IssueCellLookups {
  // Statuses an issue can have (depends on its project and kind)
  statuses: (issue: Issue) => Array<ValueOption<string>>
  priorities: Array<ValueOption<number>>
  assignees: Array<ValueOption<string>>
  components: Array<ValueOption<string>>
  milestones: Array<ValueOption<string>>
  labels: Array<{ id: string, title: string, color: number }>
  labelRefs: (issueId: string) => IssueLabelRef[]
  // Custom fields by field key
  fields: ReadonlyMap<string, ProjectField>
  // Whether the current user may change the attribute of the issue
  canEdit?: (issue: Issue, attribute: string) => boolean
  now?: () => number
}

const CELL_FIELD_PREFIX = 'cf_'

/** Key of a custom field column, as marked on the rendered cells. */
export function customFieldColumnKey (fieldKey: string): string {
  return `${CELL_FIELD_PREFIX}${fieldKey}`
}

export function issueTarget (issue: Issue): tableEdit.DocTarget {
  return {
    _id: issue._id,
    _class: issue._class,
    space: issue.space,
    attachedTo: issue.attachedTo,
    attachedToClass: issue.attachedToClass,
    collection: issue.collection
  }
}

const ok = (ops: EditOp[]): tableEdit.ParseResult<EditOp[]> => ({ ok: true, value: ops })
const fail = (reason: tableEdit.ParseFailure): tableEdit.ParseResult<EditOp[]> => ({ ok: false, reason })

function setAttribute (issue: Issue, key: string, value: unknown): tableEdit.ParseResult<EditOp[]> {
  return ok([tableEdit.updateOp(issueTarget(issue), issue as unknown as Record<string, unknown>, { [key]: value })])
}

type Resolve = (lookups: IssueCellLookups) => (issue: Issue) => Array<ValueOption<string>>

// A column whose value is one of a list of options and may be cleared to null (assignee, component, milestone)
function optionColumn (
  key: string,
  attribute: keyof Issue & string,
  options: Resolve,
  lookups: () => IssueCellLookups
): CellColumn {
  return {
    key,
    clearable: true,
    format: (issue) => tableEdit.formatOptionValue(issue[attribute] as string | null, options(lookups())(issue)),
    edit: (issue, text) => {
      const l = lookups()
      if (l.canEdit?.(issue, attribute) === false) return fail('readonly')
      const parsed = tableEdit.parseOptionValue(text, options(l)(issue))
      return parsed.ok ? setAttribute(issue, attribute, parsed.value) : parsed
    }
  }
}

function numberColumn (
  key: string,
  attribute: 'estimation',
  lookups: () => IssueCellLookups
): CellColumn {
  return {
    key,
    clearable: true,
    // Zero hours is how an issue without an estimate is stored
    format: (issue) => (issue[attribute] > 0 ? tableEdit.formatNumberValue(issue[attribute]) : ''),
    edit: (issue, text) => {
      if (lookups().canEdit?.(issue, attribute) === false) return fail('readonly')
      const parsed = tableEdit.parseNumberValue(text, { min: 0 })
      return parsed.ok ? setAttribute(issue, attribute, parsed.value ?? 0) : parsed
    }
  }
}

function labelsColumn (lookups: () => IssueCellLookups): CellColumn {
  const options = (l: IssueCellLookups): Array<ValueOption<string>> => l.labels.map((it) => ({ id: it.id, label: it.title }))
  return {
    key: 'labels',
    clearable: true,
    format: (issue) =>
      lookups()
        .labelRefs(issue._id)
        .map((r) => r.title)
        .join(', '),
    edit: (issue, text) => {
      const l = lookups()
      if (l.canEdit?.(issue, 'labels') === false) return fail('readonly')
      const parsed = tableEdit.parseMultiOptionValue(text, options(l))
      if (!parsed.ok) return parsed
      const wanted = new Set(parsed.value)
      const current = l.labelRefs(issue._id)
      const ops: EditOp[] = []
      // The labels are a collection of references, so the value is set by adding and removing references
      for (const ref of current) {
        if (!wanted.has(ref.tag)) {
          ops.push({
            kind: 'remove',
            target: {
              _id: ref._id,
              _class: tags.class.TagReference,
              space: issue.space,
              attachedTo: issue._id,
              attachedToClass: issue._class,
              collection: 'labels'
            },
            attributes: { tag: ref.tag, title: ref.title, color: ref.color }
          })
        }
      }
      const have = new Set(current.map((r) => r.tag))
      for (const id of parsed.value) {
        if (have.has(id)) continue
        const label = l.labels.find((it) => it.id === id)
        if (label === undefined) continue
        ops.push({
          kind: 'add',
          target: {
            _id: generateId(),
            _class: tags.class.TagReference,
            space: issue.space,
            attachedTo: issue._id,
            attachedToClass: issue._class,
            collection: 'labels'
          },
          attributes: { tag: label.id, title: label.title, color: label.color }
        })
      }
      return ok(ops)
    }
  }
}

function fieldOptions (field: ProjectField): Array<ValueOption<string>> {
  return (field.options ?? []).map((o) => ({ id: o.value, label: o.label }))
}

function customFieldColumn (field: ProjectField, lookups: () => IssueCellLookups): CellColumn | undefined {
  const key = customFieldColumnKey(field.key)
  const read = (issue: Issue): ReturnType<typeof getFieldValue> => getFieldValue(issue.customFields, field)

  let format: (issue: Issue) => string
  let parse: (text: string, now: number) => tableEdit.ParseResult<string | number | string[] | null>
  switch (field.type) {
    case ProjectFieldType.Text:
      format = (issue) => (read(issue) as string | null) ?? ''
      parse = (text) => tableEdit.parseTextValue(text)
      break
    case ProjectFieldType.Number:
      format = (issue) => tableEdit.formatNumberValue(read(issue) as number | null)
      parse = (text) => tableEdit.parseNumberValue(text)
      break
    case ProjectFieldType.Date:
      format = (issue) => tableEdit.formatDateValue(read(issue) as number | null)
      parse = (text, now) => tableEdit.parseDateValue(text, now)
      break
    case ProjectFieldType.SingleSelect:
      format = (issue) => tableEdit.formatOptionValue(read(issue) as string | null, fieldOptions(field))
      parse = (text) => tableEdit.parseOptionValue(text, fieldOptions(field))
      break
    case ProjectFieldType.MultiSelect:
      format = (issue) => tableEdit.formatMultiOptionValue(read(issue) as string[] | null, fieldOptions(field))
      parse = (text) => tableEdit.parseMultiOptionValue(text, fieldOptions(field))
      break
    default:
      // Iteration values are managed by the iteration features
      return undefined
  }
  return {
    key,
    clearable: true,
    format,
    edit: (issue, text) => {
      const l = lookups()
      if (l.canEdit?.(issue, 'customFields') === false) return fail('readonly')
      const parsed = parse(text, l.now?.() ?? Date.now())
      if (!parsed.ok) return parsed
      const customFields = mergeCustomFieldValue(issue.customFields, field.key, parsed.value)
      const op = tableEdit.updateOp(issueTarget(issue), issue as unknown as Record<string, unknown>, { customFields })
      // An issue without custom fields goes back to an empty record, not to null
      if (op.kind === 'update') op.before.customFields = issue.customFields ?? {}
      return ok([op])
    }
  }
}

/**
 * Cells of the issue table: how each column is shown on the clipboard and how pasted text becomes an update.
 * The lookups are read on every call, so the adapter follows the data the view currently has.
 */
export function createIssueCellColumns (lookups: () => IssueCellLookups): (key: string) => CellColumn | undefined {
  const columns = new Map<string, CellColumn>()
  columns.set('title', {
    key: 'title',
    format: (issue) => issue.title,
    edit: (issue, text) => {
      if (lookups().canEdit?.(issue, 'title') === false) return fail('readonly')
      const title = text.trim()
      // An issue cannot lose its title
      return title === '' ? fail('notClearable') : setAttribute(issue, 'title', title)
    }
  })
  columns.set('status', {
    key: 'status',
    format: (issue) => tableEdit.formatOptionValue(issue.status, lookups().statuses(issue)),
    edit: (issue, text) => {
      const l = lookups()
      if (l.canEdit?.(issue, 'status') === false) return fail('readonly')
      const parsed = tableEdit.parseOptionValue(text, l.statuses(issue))
      if (!parsed.ok) return parsed
      // Every issue has a status
      return parsed.value === null ? fail('notClearable') : setAttribute(issue, 'status', parsed.value)
    }
  })
  columns.set('priority', {
    key: 'priority',
    clearable: true,
    format: (issue) => tableEdit.formatOptionValue(issue.priority, lookups().priorities),
    edit: (issue, text) => {
      const l = lookups()
      if (l.canEdit?.(issue, 'priority') === false) return fail('readonly')
      const parsed = tableEdit.parseOptionValue(text, l.priorities)
      // Clearing the priority sets "No priority"
      return parsed.ok ? setAttribute(issue, 'priority', parsed.value ?? IssuePriority.NoPriority) : parsed
    }
  })
  columns.set('assignee', optionColumn('assignee', 'assignee', (l) => () => l.assignees, lookups))
  columns.set('component', optionColumn('component', 'component', (l) => () => l.components, lookups))
  columns.set('milestone', optionColumn('milestone', 'milestone', (l) => () => l.milestones, lookups))
  columns.set('dueDate', {
    key: 'dueDate',
    clearable: true,
    format: (issue) => tableEdit.formatDateValue(issue.dueDate),
    edit: (issue, text) => {
      const l = lookups()
      if (l.canEdit?.(issue, 'dueDate') === false) return fail('readonly')
      const parsed = tableEdit.parseDateValue(text, l.now?.() ?? Date.now())
      return parsed.ok ? setAttribute(issue, 'dueDate', parsed.value) : parsed
    }
  })
  columns.set('estimation', numberColumn('estimation', 'estimation', lookups))
  columns.set('labels', labelsColumn(lookups))

  return (key) => {
    const known = columns.get(key)
    if (known !== undefined) return known
    if (!key.startsWith(CELL_FIELD_PREFIX)) return undefined
    const field = lookups().fields.get(key.slice(CELL_FIELD_PREFIX.length))
    return field === undefined ? undefined : customFieldColumn(field, lookups)
  }
}

/**
 * Applies edit operations to the issues in one atomic batch.
 */
export async function runIssueOps (client: TxOperations, ops: readonly EditOp[]): Promise<void> {
  const batch = client.apply()
  for (const op of ops) {
    const t = op.target
    switch (op.kind) {
      case 'update':
        await batch.updateCollection(
          t._class as Issue['_class'],
          t.space as Issue['space'],
          t._id as Issue['_id'],
          t.attachedTo as Issue['attachedTo'],
          t.attachedToClass as Issue['attachedToClass'],
          t.collection as string,
          op.after as DocumentUpdate<Issue>
        )
        break
      case 'add':
        await batch.addCollection(
          t._class as any,
          t.space as any,
          t.attachedTo as any,
          t.attachedToClass as any,
          t.collection as string,
          op.attributes as any,
          t._id as any
        )
        break
      case 'remove':
        await batch.removeCollection(
          t._class as any,
          t.space as any,
          t._id as any,
          t.attachedTo as any,
          t.attachedToClass as any,
          t.collection as string
        )
        break
    }
  }
  const res = await batch.commit()
  if (!res.result) throw new Error('The changes were rejected: the data was changed meanwhile')
}
