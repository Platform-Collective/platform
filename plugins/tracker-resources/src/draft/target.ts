//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import type { ProjectType, TaskType } from '@hcengineering/task'
import type { IssueStatus } from '@hcengineering/tracker'

import type { DraftProject, DraftTarget } from './create'

/** What a draft needs to know about a task type. */
export interface DraftTaskType {
  _id: Ref<TaskType>
  parent: Ref<ProjectType>
  statuses: ReadonlyArray<Ref<IssueStatus> | string>
}

/**
 * The kind and the status a draft of the project starts with. The kind is the first task type of the project type that
 * issues can be created of (like the type selector of the create issue form); the status is the default status of the
 * project, or else the first status of that kind. `undefined` when the project type has no such task type or status.
 */
export function resolveDraftTarget<T extends DraftTaskType> (
  project: DraftProject,
  taskTypes: Iterable<T>,
  canCreate: (taskType: T) => boolean
): DraftTarget | undefined {
  for (const taskType of taskTypes) {
    if (taskType.parent !== (project.type as unknown) || !canCreate(taskType)) continue
    const status = project.defaultIssueStatus ?? (taskType.statuses[0] as Ref<IssueStatus> | undefined)
    if (status === undefined) continue
    return { project, kind: taskType._id, status }
  }
  return undefined
}
