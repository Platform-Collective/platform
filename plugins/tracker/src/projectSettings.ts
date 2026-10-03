//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Markup } from '@hcengineering/core'
import type { Project } from './index'

/** Items one project can hold, like GitHub Projects. @public */
export const MAX_PROJECT_ITEMS = 50000
/** Longest short description of a project, like GitHub. @public */
export const MAX_PROJECT_SHORT_DESCRIPTION = 256
/** Longest README (characters of the stored markup). Our own limit, GitHub does not state one. @public */
export const MAX_PROJECT_README = 100000

/**
 * Whether a project that holds `count` items cannot take another one.
 * @public
 */
export function isProjectItemLimitReached (count: number, limit: number = MAX_PROJECT_ITEMS): boolean {
  return count >= limit
}

/**
 * The newly created items a project has to give up again because it holds more than `limit` after the batch.
 * `created` are the ids of the items the batch created, in the order they were created; the newest go first.
 * @public
 */
export function itemsOverProjectLimit<T extends string> (
  created: readonly T[],
  total: number,
  limit: number = MAX_PROJECT_ITEMS
): T[] {
  const excess = total - limit
  if (excess <= 0 || created.length === 0) return []
  return created.slice(Math.max(0, created.length - excess))
}

/**
 * @public
 */
export type ProjectDetailsError = 'shortDescriptionTooLong' | 'readmeTooLong'

/**
 * Check the short description and the README of a project.
 * @public
 */
export function validateProjectDetails (details: {
  shortDescription?: string
  readme?: Markup
}): ProjectDetailsError | undefined {
  if ((details.shortDescription ?? '').length > MAX_PROJECT_SHORT_DESCRIPTION) return 'shortDescriptionTooLong'
  if ((details.readme ?? '').length > MAX_PROJECT_README) return 'readmeTooLong'
  return undefined
}

/**
 * The short description to show: the one of the project, or the description of the space of projects that were
 * created before the short description existed.
 * @public
 */
export function projectShortDescription (project: Pick<Project, 'shortDescription' | 'description'>): string {
  const own = project.shortDescription?.trim() ?? ''
  if (own !== '') return own
  return (project.description ?? '').trim()
}

/**
 * Whether the text typed to confirm the deletion is the name of the project (GitHub asks for the name).
 * @public
 */
export function isDeleteConfirmed (projectName: string, typed: string): boolean {
  const name = projectName.trim()
  return name !== '' && typed.trim() === name
}

/**
 * A private project needs members, and at least one owner who is a member, or nobody could open it (the same rule as
 * the form that creates a project).
 * @public
 */
export function canMakeProjectPrivate (project: Pick<Project, 'members' | 'owners'>): boolean {
  const members = project.members ?? []
  if (members.length === 0) return false
  return (project.owners ?? []).some((owner) => members.includes(owner))
}
