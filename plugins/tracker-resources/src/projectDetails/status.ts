//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { IntlString } from '@hcengineering/platform'
import { ProjectStatus } from '@hcengineering/tracker'

import tracker from '../plugin'

/** Label of a project status. */
export function projectStatusLabel (status: ProjectStatus): IntlString {
  switch (status) {
    case ProjectStatus.OnTrack:
      return tracker.string.ProjectStatusOnTrack
    case ProjectStatus.AtRisk:
      return tracker.string.ProjectStatusAtRisk
    case ProjectStatus.OffTrack:
      return tracker.string.ProjectStatusOffTrack
    case ProjectStatus.Complete:
      return tracker.string.ProjectStatusComplete
    default:
      return tracker.string.ProjectStatusInactive
  }
}

/** Colour of the dot of a status, the colours GitHub uses (gray, green, yellow, red, purple). */
export function projectStatusColor (status: ProjectStatus): string {
  switch (status) {
    case ProjectStatus.OnTrack:
      return '#2da44e'
    case ProjectStatus.AtRisk:
      return '#d4a72c'
    case ProjectStatus.OffTrack:
      return '#cf222e'
    case ProjectStatus.Complete:
      return '#8250df'
    default:
      return '#8c959f'
  }
}
