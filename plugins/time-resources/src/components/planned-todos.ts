// SPDX-License-Identifier: EPL-2.0

import type { WorkSlot } from '@hcengineering/time'

export function isPlannedTodoVisible (
  nearest: Pick<WorkSlot, 'date' | 'dueDate'> | undefined,
  currentDate: Date
): boolean {
  if (nearest === undefined || currentDate.toDateString() === new Date().toDateString()) {
    return true
  }
  return new Date(nearest.date).toDateString() === currentDate.toDateString()
}
