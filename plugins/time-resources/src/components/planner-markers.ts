// SPDX-License-Identifier: EPL-2.0

import type { ToDo, WorkSlot } from '@hcengineering/time'
import type { Issue } from '@hcengineering/tracker'

interface PlannerMarkers {
  due: Set<number>
  scheduled: Set<number>
}

/** The visible month's local, half-open timestamp range. */
export function getPlannerMonthRange (month: Date): { start: number, end: number } {
  return {
    start: new Date(month.getFullYear(), month.getMonth(), 1).getTime(),
    end: new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime()
  }
}

/** Build local day markers from the current user's action items and their deadlines and workslots. */
export function getPlannerMarkers (
  month: Date,
  todos: Pick<ToDo, '_id' | 'attachedTo' | 'dueDate'>[],
  issues: Pick<Issue, '_id' | 'dueDate'>[],
  workslots: Pick<WorkSlot, 'attachedTo' | 'date' | 'dueDate'>[]
): PlannerMarkers {
  const { start, end } = getPlannerMonthRange(month)
  const due = new Set<number>()
  const scheduled = new Set<number>()
  const todoIds = new Set(todos.map((todo) => todo._id))
  const attachedIds = new Set(todos.map((todo) => todo.attachedTo))

  for (const item of [...todos, ...issues.filter((issue) => attachedIds.has(issue._id))]) {
    if (item.dueDate == null || item.dueDate < start || item.dueDate >= end) continue
    due.add(new Date(item.dueDate).setHours(0, 0, 0, 0))
  }

  for (const slot of workslots) {
    if (!todoIds.has(slot.attachedTo) || slot.dueDate <= slot.date) continue
    const day = new Date(Math.max(start, slot.date))
    day.setHours(0, 0, 0, 0)
    const slotEnd = Math.min(end, slot.dueDate)
    while (day.getTime() < slotEnd) {
      scheduled.add(day.getTime())
      day.setDate(day.getDate() + 1)
    }
  }

  return { due, scheduled }
}
