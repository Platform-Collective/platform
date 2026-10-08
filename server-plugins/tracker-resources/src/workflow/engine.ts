//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import contact, { getName, type Employee } from '@hcengineering/contact'
import { SortingOrder, type Ref } from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import task from '@hcengineering/task'
import tracker, {
  archivedQuery,
  isFilterWorkflowKind,
  isWorkflowFilterUsable,
  restoreCandidates,
  selectWorkflowItems,
  WORKFLOW_SCAN_LIMIT,
  WorkflowKind,
  type EffectiveWorkflow,
  type Issue,
  type NamedOption,
  type Project
} from '@hcengineering/tracker'

import { logTrigger } from '../log'
import { compileWorkflowFilter, type CompiledWorkflowFilter, type WorkflowFilterData } from './filter'

/**
 * What a project's filter workflows do in one run: the issues to archive and to restore. Each list is capped at
 * `MAX_WORKFLOW_ITEMS_PER_RUN`; what is left is found by the next run.
 */
export interface FilterRunPlan {
  archive: Array<Pick<Issue, '_id' | '_class' | 'space'>>
  restore: Array<Pick<Issue, '_id' | '_class' | 'space'>>
}

/**
 * Loads what the names of a filter resolve against.
 */
export async function loadFilterData (
  control: TriggerControl,
  project: Ref<Project>,
  needAssignees: boolean
): Promise<WorkflowFilterData> {
  const named = (list: Array<{ _id: string, name?: string, label?: string }>): NamedOption[] =>
    list.map((it) => ({ id: it._id, name: it.name ?? it.label ?? '' }))

  const [statuses, components, milestones, fields, iterations] = await Promise.all([
    control.findAll(control.ctx, tracker.class.IssueStatus, {}),
    control.findAll(control.ctx, tracker.class.Component, { space: project }),
    control.findAll(control.ctx, tracker.class.Milestone, { space: project }),
    control.findAll(control.ctx, tracker.class.ProjectField, { space: project }),
    control.findAll(control.ctx, tracker.class.Iteration, { space: project })
  ])
  const assignees: NamedOption[] = needAssignees
    ? (await control.findAll(control.ctx, contact.mixin.Employee, { active: true })).map((e: Employee) => ({
        id: e._id,
        name: getName(control.hierarchy, e)
      }))
    : []
  const closedStatuses = new Set<string>(
    statuses
      .filter((s) => s.category === task.statusCategory.Won || s.category === task.statusCategory.Lost)
      .map((s) => s._id as string)
  )
  return {
    statuses: named(statuses),
    components: named(components),
    milestones: named(milestones),
    assignees,
    fields: [...fields],
    iterations: [...iterations],
    closedStatuses,
    noParentId: tracker.ids.NoParent as string
  }
}

type Scanned = Pick<Issue, '_id' | '_class' | 'space'> & Record<string, any>

async function scan (
  control: TriggerControl,
  project: Ref<Project>,
  query: Record<string, any>,
  properties: readonly string[]
): Promise<Scanned[]> {
  const projection: Record<string, 1> = { _id: 1, _class: 1, space: 1, archivedAt: 1, modifiedOn: 1 }
  for (const key of properties) projection[key] = 1
  const found = await control.findAll(
    control.ctx,
    tracker.class.Issue,
    { ...query, space: project } as any,
    // Oldest first, so that a backlog larger than a run is worked off in order
    { limit: WORKFLOW_SCAN_LIMIT, sort: { modifiedOn: SortingOrder.Ascending }, projection } as any
  )
  return [...found] as unknown as Scanned[]
}

function compileUsable (
  control: TriggerControl,
  workflow: EffectiveWorkflow | undefined,
  data: WorkflowFilterData,
  now: number
): Extract<CompiledWorkflowFilter, { ok: true }> | undefined {
  if (workflow === undefined || !workflow.enabled || !isWorkflowFilterUsable(workflow.filter)) return undefined
  const compiled = compileWorkflowFilter(workflow.filter, data, now)
  if (compiled.ok === false) {
    logTrigger(control, 'warn', 'tracker workflow filter is not valid, skipped', {
      kind: workflow.kind,
      error: compiled.error
    })
    return undefined
  }
  return compiled
}

/**
 * Works out what the enabled filter workflows of a project change now.
 *
 *  - Auto-archive: the not archived issues that match its filter are archived.
 *  - Auto-add (restore): the archived issues that match its filter come back, except those Auto-archive would archive
 *    again at once (archive wins, so the two never undo each other).
 *
 * A filter that is not valid, or that asks for archived items in Auto-archive, is skipped, not guessed at. Nothing is
 * written here.
 */
export async function planFilterWorkflows (
  control: TriggerControl,
  project: Ref<Project>,
  workflows: readonly EffectiveWorkflow[],
  now: number
): Promise<FilterRunPlan> {
  const plan: FilterRunPlan = { archive: [], restore: [] }
  const archiveWf = workflows.find((w) => w.kind === WorkflowKind.AutoArchive)
  const addWf = workflows.find((w) => w.kind === WorkflowKind.AutoAddFromQuery)
  const active = [archiveWf, addWf].filter(
    (w): w is EffectiveWorkflow => w !== undefined && isFilterWorkflowKind(w.kind) && w.enabled && isWorkflowFilterUsable(w.filter)
  )
  if (active.length === 0) return plan

  const needAssignees = active.some((w) => w.filter.toLowerCase().includes('assignee'))
  const data = await loadFilterData(control, project, needAssignees)

  let archiveFilter = compileUsable(control, archiveWf, data, now)
  if (archiveFilter?.mentionsArchived === true) {
    // Archived items are not scanned by Auto-archive, so such a filter can only be a mistake
    logTrigger(control, 'warn', 'tracker auto-archive filter mentions archived items, skipped', { project })
    archiveFilter = undefined
  }
  const addFilter = compileUsable(control, addWf, data, now)

  if (archiveFilter !== undefined) {
    const candidates = await scan(control, project, { ...archiveFilter.query, ...archivedQuery(false) }, archiveFilter.projection)
    // The candidates are not archived (the query says so), and the filter is evaluated on every one again
    plan.archive = selectWorkflowItems(
      candidates,
      (issue) => (issue.archivedAt === undefined || issue.archivedAt === null) && archiveFilter?.matches(issue) === true
    ).map(({ _id, _class, space }) => ({ _id, _class, space }))
  }

  if (addFilter !== undefined) {
    // The archive filter is evaluated on the archived issues too (archive wins), so their properties are read as well
    const properties = [...addFilter.projection, ...(archiveFilter?.projection ?? [])]
    const archived = await scan(control, project, { ...addFilter.query, ...archivedQuery(true) }, properties)
    const archiveMatches = archiveFilter?.matches
    plan.restore = restoreCandidates(
      archived,
      (issue) => issue.archivedAt !== undefined && issue.archivedAt !== null && addFilter.matches(issue),
      archiveMatches !== undefined ? (issue) => archiveMatches({ ...issue, archivedAt: null }) : undefined
    ).map(({ _id, _class, space }) => ({ _id, _class, space }))
  }
  return plan
}
