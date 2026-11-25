// SPDX-License-Identifier: EPL-2.0

import { ClassifierKind, type Class, type Doc, type DocumentUpdate, type Ref } from '@hcengineering/core'
import type { ProjectType, TaskType } from '@hcengineering/task'

export function getTaskTypeDeletionUpdate (taskType: Ref<TaskType>): DocumentUpdate<ProjectType> {
  return {
    $pull: {
      tasks: taskType,
      statuses: { taskType }
    }
  }
}

export function getChildTaskTypeDeletionUpdate (taskType: Ref<TaskType>): DocumentUpdate<TaskType> {
  return {
    $pull: { allowedAsChildOf: taskType }
  }
}

export function shouldHideTaskTypeTargetClass (
  targetClass: Pick<Class<Doc>, 'kind'> | undefined,
  taskTypeCount: number
): boolean {
  return targetClass?.kind === ClassifierKind.MIXIN && taskTypeCount === 1
}
