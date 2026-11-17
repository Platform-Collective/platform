// SPDX-License-Identifier: EPL-2.0

import { ClassifierKind, type Class, type Doc } from '@hcengineering/core'
import type { TaskType } from '@hcengineering/task'
import {
  getChildTaskTypeDeletionUpdate,
  getTaskTypeDeletionUpdate,
  shouldHideTaskTypeTargetClass
} from '../task-type-deletion'

describe('getTaskTypeDeletionUpdate', () => {
  it('pulls only the deleted task type and its statuses', () => {
    const removedTaskType = 'task-type-removed' as TaskType['_id']

    expect(getTaskTypeDeletionUpdate(removedTaskType)).toEqual({
      $pull: {
        tasks: removedTaskType,
        statuses: { taskType: removedTaskType }
      }
    })
  })

  it('pulls the deleted task type from child type parents', () => {
    const removedTaskType = 'task-type-removed' as TaskType['_id']

    expect(getChildTaskTypeDeletionUpdate(removedTaskType)).toEqual({
      $pull: { allowedAsChildOf: removedTaskType }
    })
  })

  it('hides a target class only when the deleted task type is its sole mixin user', () => {
    const mixinClass: Pick<Class<Doc>, 'kind'> = { kind: ClassifierKind.MIXIN }
    const classClass: Pick<Class<Doc>, 'kind'> = { kind: ClassifierKind.CLASS }

    expect(shouldHideTaskTypeTargetClass(mixinClass, 1)).toBe(true)
    expect(shouldHideTaskTypeTargetClass(mixinClass, 2)).toBe(false)
    expect(shouldHideTaskTypeTargetClass(classClass, 1)).toBe(false)
    expect(shouldHideTaskTypeTargetClass(undefined, 1)).toBe(false)
  })
})
