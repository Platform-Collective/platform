//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { ItemSchedule } from '../roadmap/dates'
import type { RescheduleMode } from '../roadmap/reschedule'

/**
 * Whole days an event moved when it is dragged from the day cell the pointer grabbed it in to the day cell the pointer
 * is over now. Moving shifts both dates by the distance between the two cells (so grabbing a bar by its third day and
 * dropping that on another day keeps the duration), resizing moves the edge that is dragged to the cell.
 */
export function dragDelta (mode: RescheduleMode, schedule: ItemSchedule, grabDay: number, overDay: number): number {
  switch (mode) {
    case 'move':
      return overDay - grabDay
    case 'resize-start':
      return schedule.kind === 'range' ? overDay - schedule.start : 0
    case 'resize-end':
      return schedule.kind === 'range' ? overDay - schedule.target : 0
  }
}
