//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Doc, Markup, Ref, Timestamp } from '@hcengineering/core'
import type { Project } from './index'

/**
 * Status of a project, the values of GitHub's `ProjectV2StatusUpdateStatus`.
 * @public
 */
export enum ProjectStatus {
  Inactive = 'INACTIVE',
  OnTrack = 'ON_TRACK',
  AtRisk = 'AT_RISK',
  OffTrack = 'OFF_TRACK',
  Complete = 'COMPLETE'
}

/**
 * A status update of a project (GitHub "Project status updates"). `space` is the project, the author is
 * `createdBy` / `modifiedBy` of the document. The latest update gives the status of the project.
 * @public
 */
export interface ProjectStatusUpdate extends Doc {
  space: Ref<Project>
  status: ProjectStatus
  // Start and target of the period the update is about; null once cleared (an update cannot remove a property)
  startDate?: Timestamp | null
  targetDate?: Timestamp | null
  body: Markup
}

/** All statuses in the order GitHub lists them. @public */
export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  ProjectStatus.Inactive,
  ProjectStatus.OnTrack,
  ProjectStatus.AtRisk,
  ProjectStatus.OffTrack,
  ProjectStatus.Complete
]

/** Longest body of a status update (characters of the stored markup). Our own limit, GitHub does not state one. @public */
export const MAX_STATUS_UPDATE_BODY = 65536

/**
 * @public
 */
export type ProjectStatusUpdateError = 'invalidStatus' | 'invalidDates' | 'bodyTooLong'

/**
 * Check the values of a status update before it is stored.
 * @public
 */
export function validateStatusUpdate (
  update: Pick<ProjectStatusUpdate, 'status' | 'startDate' | 'targetDate' | 'body'>
): ProjectStatusUpdateError | undefined {
  if (!PROJECT_STATUSES.includes(update.status)) return 'invalidStatus'
  const { startDate, targetDate } = update
  if (startDate != null && targetDate != null && targetDate < startDate) return 'invalidDates'
  if ((update.body ?? '').length > MAX_STATUS_UPDATE_BODY) return 'bodyTooLong'
  return undefined
}

/**
 * Newest first (by creation time, the id breaks ties so the order is stable).
 * @public
 */
export function sortStatusUpdates<T extends Pick<ProjectStatusUpdate, '_id' | 'createdOn'>> (list: readonly T[]): T[] {
  return [...list].sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0) || String(b._id).localeCompare(String(a._id)))
}

/**
 * The latest update, which gives the status of the project. Undefined when there is none.
 * @public
 */
export function latestStatusUpdate<T extends Pick<ProjectStatusUpdate, '_id' | 'createdOn'>> (
  list: readonly T[]
): T | undefined {
  return sortStatusUpdates(list)[0]
}

/**
 * Whether the person may edit or delete the update: its author, or someone who manages the project.
 * @public
 */
export function canModifyStatusUpdate (
  update: Pick<ProjectStatusUpdate, 'createdBy'>,
  authorIds: readonly string[],
  canManageProject: boolean
): boolean {
  if (canManageProject) return true
  return update.createdBy !== undefined && authorIds.includes(update.createdBy as string)
}
