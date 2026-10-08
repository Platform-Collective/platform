//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import { AccountRole, type Ref } from '@hcengineering/core'
import type { ProjectType } from '@hcengineering/task'
import { isProjectItemLimitReached, IssuePriority, type Project } from '@hcengineering/tracker'

import type { DraftValues } from './create'

/**
 * Whether the "Add item" row of a project takes input: `ok`, `readonly` (a read-only viewer, or somebody who may not
 * create issues in the project), or `limit` (the project holds the most items it can).
 */
export type AddItemAvailability = 'ok' | 'readonly' | 'limit'

export interface AddItemAvailabilityInput {
  // The view is read-only (the restrictions of the workspace or of the view)
  readonly: boolean
  role: AccountRole | undefined
  // Whether the permissions of the project allow the user to create issues
  canCreate: boolean
  // Items the project holds now, drafts and archived items included
  itemCount: number
}

export function addItemAvailability (input: AddItemAvailabilityInput): AddItemAvailability {
  if (input.readonly || input.role === AccountRole.ReadOnlyGuest || !input.canCreate) return 'readonly'
  return isProjectItemLimitReached(input.itemCount) ? 'limit' : 'ok'
}

const PRIORITIES = new Set<number>(Object.values(IssuePriority).filter((it): it is number => typeof it === 'number'))

/**
 * The values a draft starts with, taken from what dropping a card on a board cell writes (`resolveDropUpdate`): the
 * column and the swimlane. Only what a draft has is taken over, anything else is ignored.
 */
export function draftValuesFromUpdate (update: Record<string, unknown> | undefined): DraftValues {
  const values: DraftValues = {}
  if (update === undefined) return values
  if (typeof update.status === 'string') values.status = update.status as DraftValues['status']
  if (typeof update.priority === 'number' && PRIORITIES.has(update.priority)) values.priority = update.priority
  for (const key of ['assignee', 'component', 'milestone'] as const) {
    const value = update[key]
    if (typeof value === 'string' || value === null) (values as Record<string, unknown>)[key] = value
  }
  const custom = update.customFields
  if (custom !== null && typeof custom === 'object' && !Array.isArray(custom)) {
    values.customFields = { ...(custom as Record<string, unknown>) }
  }
  return values
}

/**
 * What picking an issue from the search of the "Add item" row does:
 * - `in-project`: it is an item of this project already, nothing to do;
 * - `restore`: it is an archived item of this project, it is restored;
 * - `move`: it is an issue of another project of the same type, which can be moved here (an issue belongs to exactly
 *   one project, so it leaves the other one);
 * - `not-movable`: it cannot be moved here (another project type, a project that is closed, an archived issue, or an
 *   issue the user may not change).
 */
export type SearchResultAction = 'in-project' | 'restore' | 'move' | 'not-movable'

export interface SearchResultContext {
  project: Ref<Project>
  projectType: Ref<ProjectType>
  // Type of the project with the given id, `undefined` for a project that is closed or not known
  typeOfProject: (project: Ref<Project>) => Ref<ProjectType> | undefined
  // Whether the user may change the issue
  canEdit: (issueId: string) => boolean
}

export function classifySearchResult (
  issue: { _id: string, space: Ref<Project>, archivedAt?: number | null },
  ctx: SearchResultContext
): SearchResultAction {
  const archived = issue.archivedAt !== undefined && issue.archivedAt !== null
  if (issue.space === ctx.project) {
    if (!archived) return 'in-project'
    return ctx.canEdit(issue._id) ? 'restore' : 'not-movable'
  }
  if (archived || ctx.typeOfProject(issue.space) !== ctx.projectType || !ctx.canEdit(issue._id)) return 'not-movable'
  return 'move'
}
