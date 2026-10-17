// SPDX-License-Identifier: EPL-2.0
// Adapted from services/github/pod-github/src/workspaceUtils.ts (Copyright © 2026 Hardcore Engineering Inc., EPL-2.0).

import { isActiveMode, isArchivingMode, isDeletingMode, type WorkspaceInfoWithStatus } from '@hcengineering/core'

/**
 * Whether a workspace gets a GitLab worker:
 * connect: run one; wait: start none, keep a running one; inactive and skip: run none, close a running one.
 */
export type WorkspaceWorkerState = 'connect' | 'wait' | 'inactive' | 'skip'

export const DAY_MS = 24 * 60 * 60 * 1000

export function workspaceWorkerState (
  info: WorkspaceInfoWithStatus | undefined,
  inactivityDays: number,
  now: number
): WorkspaceWorkerState {
  if (info?.uuid === undefined) return 'skip'
  if (info.isDisabled === true || isDeletingMode(info.mode) || isArchivingMode(info.mode)) return 'skip'
  // Upgrading, creating, restoring: try again later
  if (!isActiveMode(info.mode)) return 'wait'
  if (inactivityDays > 0 && now - (info.lastVisit ?? 0) > inactivityDays * DAY_MS) return 'inactive'
  return 'connect'
}
