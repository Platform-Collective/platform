//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Doc, Ref, Timestamp } from '@hcengineering/core'
import type { Project } from './index'
import { buildIssueFilterSchema, type IssueFilterField, type IssueFilterSchemaInput } from './issueFilterSchema'
import { ProjectFieldType, type ProjectField, type ProjectFieldOption } from './projectField'

// Built-in project workflows, GitHub Projects style (there is no rule builder). The pure logic lives here so that
// the server trigger and the settings UI agree on what a workflow does:
//
//  - the three "set a field" workflows (item closed / reopened / added) write a value of a single-select custom
//    field, the analogue of GitHub's Status field (Huly's own issue status already *is* the open/closed state);
//  - Auto-archive archives the items that match a filter string;
//  - Auto-add (Huly analogue) restores archived items that match a filter string. Huly issues belong to exactly one
//    project and moving one renumbers it, so nothing is ever pulled in from another project.

/**
 * @public
 */
export enum WorkflowKind {
  // GitHub "Item closed": the field is set to Done
  SetStatusDoneOnClose = 'setStatusDoneOnClose',
  // GitHub "Item reopened": the field goes back to the default open value
  ItemReopened = 'itemReopened',
  // GitHub "Item added to project": a new item gets the default value
  ItemAdded = 'itemAdded',
  // GitHub "Auto-archive items"
  AutoArchive = 'autoArchive',
  // GitHub "Auto-add to project", see the note above
  AutoAddFromQuery = 'autoAddFromQuery'
}

/**
 * Kinds that write a custom field value.
 * @public
 */
export type FieldWorkflowKind =
  | WorkflowKind.SetStatusDoneOnClose
  | WorkflowKind.ItemReopened
  | WorkflowKind.ItemAdded

/**
 * Kinds that act on the items that match a filter string.
 * @public
 */
export type FilterWorkflowKind = WorkflowKind.AutoArchive | WorkflowKind.AutoAddFromQuery

/**
 * Which field and option a field workflow writes. Absent: the default (see `resolveFieldTarget`).
 * @public
 */
export interface WorkflowFieldTarget {
  // `ProjectField.key` of a single-select field
  field: string
  // `ProjectFieldOption.value`
  option: string
}

/**
 * @public
 */
export interface WorkflowConfig {
  target?: WorkflowFieldTarget
}

/**
 * Stored settings of one workflow of a project (`space` is the project). A project has at most one per kind; a kind
 * without a doc has its defaults (see `resolveWorkflows`).
 * @public
 */
export interface Workflow extends Doc {
  space: Ref<Project>
  name: string
  enabled: boolean
  kind: WorkflowKind
  // Filter string (the grammar of the project views) of the filter workflows
  filter?: string
  config?: WorkflowConfig
  // Set by a client that opens the project to ask the server to evaluate the filter workflows (there is no
  // periodic runner, see the Phase 10 notes); the value itself is never read
  runRequestedAt?: Timestamp
}

/** All kinds in the order they are listed. @public */
export const WORKFLOW_KINDS: readonly WorkflowKind[] = [
  WorkflowKind.SetStatusDoneOnClose,
  WorkflowKind.ItemReopened,
  WorkflowKind.ItemAdded,
  WorkflowKind.AutoArchive,
  WorkflowKind.AutoAddFromQuery
]

/**
 * Defaults of a project that never changed a workflow. Like GitHub, the three item workflows are on: they only act
 * when the project has a single-select Status field with the usual options, otherwise they do nothing. The two
 * filter workflows are off, and need a filter before they can be switched on.
 * @public
 */
export const DEFAULT_WORKFLOW_ENABLED: Readonly<Record<WorkflowKind, boolean>> = {
  [WorkflowKind.SetStatusDoneOnClose]: true,
  [WorkflowKind.ItemReopened]: true,
  [WorkflowKind.ItemAdded]: true,
  [WorkflowKind.AutoArchive]: false,
  [WorkflowKind.AutoAddFromQuery]: false
}

/** Names stored in `Workflow.name`; the UI shows a translated label for the kind. @public */
export const WORKFLOW_NAMES: Readonly<Record<WorkflowKind, string>> = {
  [WorkflowKind.SetStatusDoneOnClose]: 'Item closed',
  [WorkflowKind.ItemReopened]: 'Item reopened',
  [WorkflowKind.ItemAdded]: 'Item added to project',
  [WorkflowKind.AutoArchive]: 'Auto-archive items',
  [WorkflowKind.AutoAddFromQuery]: 'Auto-add items'
}

/** Filter a new Auto-archive workflow starts with: closed items that were not touched for two weeks. @public */
export const DEFAULT_AUTO_ARCHIVE_FILTER = 'is:closed updated:<@today-2w'

/** Items one workflow changes in one evaluation; the rest waits for the next one. @public */
export const MAX_WORKFLOW_ITEMS_PER_RUN = 100

/** Issues one evaluation looks at, oldest first. @public */
export const WORKFLOW_SCAN_LIMIT = 2000

/** Longest filter string a workflow stores. @public */
export const MAX_WORKFLOW_FILTER_LENGTH = 1000

/**
 * @public
 */
export function isFieldWorkflowKind (kind: WorkflowKind): kind is FieldWorkflowKind {
  return (
    kind === WorkflowKind.SetStatusDoneOnClose || kind === WorkflowKind.ItemReopened || kind === WorkflowKind.ItemAdded
  )
}

/**
 * @public
 */
export function isFilterWorkflowKind (kind: WorkflowKind): kind is FilterWorkflowKind {
  return kind === WorkflowKind.AutoArchive || kind === WorkflowKind.AutoAddFromQuery
}

/**
 * A workflow as it applies to a project: the stored doc, or the defaults of its kind.
 * @public
 */
export interface EffectiveWorkflow {
  kind: WorkflowKind
  name: string
  enabled: boolean
  filter: string
  config: WorkflowConfig
  // Absent while the project never changed this workflow
  doc?: Workflow
}

function isWorkflowKind (value: unknown): value is WorkflowKind {
  return typeof value === 'string' && (WORKFLOW_KINDS as readonly string[]).includes(value)
}

function olderFirst (a: Workflow, b: Workflow): number {
  return (a.createdOn ?? 0) - (b.createdOn ?? 0) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0)
}

/**
 * One workflow per kind in the order of `WORKFLOW_KINDS`. A kind without a doc has its defaults. Should a project
 * have several docs of one kind (two clients created it at the same time), the oldest wins, the same everywhere.
 * Docs of an unknown kind are ignored.
 * @public
 */
export function resolveWorkflows (docs: readonly Workflow[]): EffectiveWorkflow[] {
  const byKind = new Map<WorkflowKind, Workflow>()
  for (const doc of [...docs].sort(olderFirst)) {
    if (!isWorkflowKind(doc.kind) || byKind.has(doc.kind)) continue
    byKind.set(doc.kind, doc)
  }
  return WORKFLOW_KINDS.map((kind) => {
    const doc = byKind.get(kind)
    if (doc === undefined) {
      return {
        kind,
        name: WORKFLOW_NAMES[kind],
        enabled: DEFAULT_WORKFLOW_ENABLED[kind],
        filter: kind === WorkflowKind.AutoArchive ? DEFAULT_AUTO_ARCHIVE_FILTER : '',
        config: {}
      }
    }
    return {
      kind,
      name: doc.name !== undefined && doc.name !== '' ? doc.name : WORKFLOW_NAMES[kind],
      enabled: doc.enabled === true,
      filter: typeof doc.filter === 'string' ? doc.filter : '',
      config: doc.config ?? {},
      doc
    }
  })
}

/**
 * A filter workflow with no filter would act on every item, so it does nothing until it has one.
 * @public
 */
export function isWorkflowFilterUsable (filter: string | undefined): boolean {
  if (filter === undefined) return false
  const text = filter.trim()
  return text !== '' && text.length <= MAX_WORKFLOW_FILTER_LENGTH
}

// ---- the field the "set a field" workflows write ----

/**
 * What a field workflow writes: the field and the option.
 * @public
 */
export interface ResolvedFieldTarget {
  field: Pick<ProjectField, 'key' | 'label' | 'type' | 'options'>
  option: ProjectFieldOption
}

// GitHub's defaults: the field is called Status, the options Todo / Done
const DEFAULT_FIELD_NAMES = ['status']
const DEFAULT_OPTION_NAMES: Readonly<Record<FieldWorkflowKind, readonly string[]>> = {
  [WorkflowKind.SetStatusDoneOnClose]: ['done'],
  [WorkflowKind.ItemReopened]: ['todo', 'to do', 'open'],
  [WorkflowKind.ItemAdded]: ['todo', 'to do', 'open']
}

function sameName (label: string, names: readonly string[]): boolean {
  return names.includes(label.trim().toLowerCase())
}

/**
 * The field and option a field workflow writes. A configured target is used as it is: when its field or option no
 * longer exists the workflow does nothing, it never falls back to something else. Without a target, the default is
 * the first single-select field called Status that has the option the kind expects (Done, or Todo). Undefined when
 * there is nothing to write.
 * @public
 */
export function resolveFieldTarget (
  kind: FieldWorkflowKind,
  config: WorkflowConfig | undefined,
  fields: ReadonlyArray<Pick<ProjectField, 'key' | 'label' | 'type' | 'options'> & { position?: number }>
): ResolvedFieldTarget | undefined {
  const singleSelects = fields.filter((f) => f.type === ProjectFieldType.SingleSelect)
  const target = config?.target
  if (target !== undefined) {
    const field = singleSelects.find((f) => f.key === target.field)
    const option = field?.options?.find((o) => o.value === target.option)
    return field !== undefined && option !== undefined ? { field, option } : undefined
  }
  const ordered = [...singleSelects].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  for (const field of ordered) {
    if (!sameName(field.label, DEFAULT_FIELD_NAMES)) continue
    const option = field.options?.find((o) => sameName(o.label, DEFAULT_OPTION_NAMES[kind]))
    if (option !== undefined) return { field, option }
  }
  return undefined
}

// ---- when a field workflow acts ----

/**
 * What happened to an issue.
 * @public
 */
export type IssueChange =
  | { type: 'created' }
  // The status changed; `prev` is unknown when it could not be read back
  | { type: 'status', prev?: string, next: string }

/**
 * @public
 */
export type StatusTransition = 'closed' | 'reopened' | 'none'

/**
 * A status change is a close when it enters a closed status (done or canceled) from an open one, and a reopen when
 * it leaves a closed status for an open one. An unknown previous status counts as open.
 * @public
 */
export function statusTransition (
  prev: string | undefined,
  next: string,
  closedStatuses: ReadonlySet<string>
): StatusTransition {
  const wasClosed = prev !== undefined && closedStatuses.has(prev)
  const isClosed = closedStatuses.has(next)
  if (isClosed && !wasClosed) return 'closed'
  if (!isClosed && wasClosed) return 'reopened'
  return 'none'
}

/**
 * Whether a change makes a field workflow act.
 * @public
 */
export function fieldWorkflowApplies (
  kind: FieldWorkflowKind,
  change: IssueChange,
  closedStatuses: ReadonlySet<string>
): boolean {
  if (change.type === 'created') return kind === WorkflowKind.ItemAdded
  const transition = statusTransition(change.prev, change.next, closedStatuses)
  if (kind === WorkflowKind.SetStatusDoneOnClose) return transition === 'closed'
  if (kind === WorkflowKind.ItemReopened) return transition === 'reopened'
  return false
}

function isEmptyFieldValue (value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

/**
 * The new `customFields` of an issue after a field workflow, or undefined when nothing has to be written: the
 * value is already there (so a repeated run does nothing), or, for "item added", the issue already has a value.
 * @public
 */
export function planFieldWorkflow (
  kind: FieldWorkflowKind,
  customFields: Record<string, unknown> | undefined,
  target: ResolvedFieldTarget
): Record<string, unknown> | undefined {
  const current = customFields?.[target.field.key]
  if (current === target.option.value) return undefined
  if (kind === WorkflowKind.ItemAdded && !isEmptyFieldValue(current)) return undefined
  return { ...(customFields ?? {}), [target.field.key]: target.option.value }
}

/**
 * The `customFields` an issue gets from the enabled field workflows for a change, or undefined when none changes it.
 * Workflows are applied in the order of `WORKFLOW_KINDS`, each on the result of the previous one.
 * @public
 */
export function planIssueWorkflows (
  workflows: readonly EffectiveWorkflow[],
  change: IssueChange,
  issue: { customFields?: Record<string, unknown> },
  closedStatuses: ReadonlySet<string>,
  fields: ReadonlyArray<Pick<ProjectField, 'key' | 'label' | 'type' | 'options'> & { position?: number }>
): Record<string, unknown> | undefined {
  let customFields = issue.customFields
  let changed = false
  for (const workflow of workflows) {
    if (!workflow.enabled || !isFieldWorkflowKind(workflow.kind)) continue
    if (!fieldWorkflowApplies(workflow.kind, change, closedStatuses)) continue
    const target = resolveFieldTarget(workflow.kind, workflow.config, fields)
    if (target === undefined) continue
    const next = planFieldWorkflow(workflow.kind, customFields, target)
    if (next === undefined) continue
    customFields = next
    changed = true
  }
  return changed ? customFields : undefined
}

// ---- the filter workflows ----

/**
 * The items a filter workflow changes in one run: the first `cap` candidates that match, in the order given (the
 * server passes the oldest first, so a backlog is worked off over several runs). `exclude` holds ids that must be left
 * alone, an id is taken once. The input is not modified.
 * @public
 */
export function selectWorkflowItems<T extends { _id: string }> (
  candidates: readonly T[],
  matches: (item: T) => boolean,
  options: { cap?: number, exclude?: ReadonlySet<string> } = {}
): T[] {
  const cap = Math.max(0, Math.min(options.cap ?? MAX_WORKFLOW_ITEMS_PER_RUN, MAX_WORKFLOW_ITEMS_PER_RUN))
  const taken = new Set<string>()
  const result: T[] = []
  for (const item of candidates) {
    if (result.length >= cap) break
    if (taken.has(item._id) || options.exclude?.has(item._id) === true) continue
    if (!matches(item)) continue
    taken.add(item._id)
    result.push(item)
  }
  return result
}

/**
 * Auto-add restores archived items that the project's Auto-archive would archive again at once; that would only
 * undo itself every run. Archive wins: the items that match the archive filter are left out.
 * @public
 */
export function restoreCandidates<T extends { _id: string }> (
  archived: readonly T[],
  matchesRestore: (item: T) => boolean,
  matchesArchive: ((item: T) => boolean) | undefined,
  cap: number = MAX_WORKFLOW_ITEMS_PER_RUN
): T[] {
  return selectWorkflowItems(archived, (item) => matchesRestore(item) && !(matchesArchive?.(item) ?? false), { cap })
}

// ---- loop protection ----

/**
 * Whether a change was made by the project automation. Every write of a workflow is authored by the system
 * account, and workflows never react to such a change, so a workflow can not wake itself or another workflow up.
 * (All writes are idempotent as well, so a loop would end after one round anyway.)
 * @public
 */
export function isAutomationAuthor (modifiedBy: string | undefined, systemId: string): boolean {
  return modifiedBy !== undefined && modifiedBy === systemId
}

/**
 * Validation of what a user edits.
 * @public
 */
export type WorkflowValidationError = 'filterRequired' | 'filterTooLong' | 'targetMissing'

/**
 * Whether a workflow may be enabled as it is: a filter workflow needs a filter, a field workflow whose target was
 * chosen needs it to exist.
 * @public
 */
export function validateWorkflow (
  workflow: Pick<EffectiveWorkflow, 'kind' | 'filter' | 'config'>,
  fields: ReadonlyArray<Pick<ProjectField, 'key' | 'label' | 'type' | 'options'>>
): WorkflowValidationError | undefined {
  if (isFilterWorkflowKind(workflow.kind)) {
    if (workflow.filter.trim() === '') return 'filterRequired'
    if (workflow.filter.length > MAX_WORKFLOW_FILTER_LENGTH) return 'filterTooLong'
    return undefined
  }
  if (isFieldWorkflowKind(workflow.kind) && workflow.config.target !== undefined) {
    return resolveFieldTarget(workflow.kind, workflow.config, fields) === undefined ? 'targetMissing' : undefined
  }
  return undefined
}

// ---- the filter of the filter workflows ----

/**
 * Priorities as a workflow filter names them. The server can not translate, so these names are English whatever the
 * language of the viewer: `priority:urgent`.
 * @public
 */
export const WORKFLOW_PRIORITY_NAMES: ReadonlyArray<{ id: number, name: string }> = [
  // The values of `IssuePriority` (not imported: this module must not depend on the index at load time)
  { id: 0, name: 'No priority' },
  { id: 1, name: 'Urgent' },
  { id: 2, name: 'High' },
  { id: 3, name: 'Medium' },
  { id: 4, name: 'Low' }
]

/**
 * The fields a workflow filter can use: those of the project views without labels (a label is a separate document
 * per issue that a workflow scan does not load) and with English priority names. The settings form and the server
 * build the schema with this function, so that a filter that is valid in the form is valid in the run.
 * @public
 */
export function buildWorkflowFilterSchema (
  input: Omit<IssueFilterSchemaInput, 'priorities' | 'labels' | 'labelRefs'>
): IssueFilterField[] {
  return buildIssueFilterSchema({
    ...input,
    priorities: WORKFLOW_PRIORITY_NAMES.map((p) => ({ id: p.id, name: p.name })),
    labels: [],
    labelRefs: []
  }).filter((f) => f.name !== 'label')
}
