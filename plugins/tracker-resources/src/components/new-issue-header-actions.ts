// SPDX-License-Identifier: EPL-2.0

import tracker from '../plugin'

interface NewIssueHeaderActions {
  mainActionId: string
  visibleActions: string[]
}

/** Select the tracker header actions for the current project and draft state. */
export function getNewIssueHeaderActions (draft: boolean, project: boolean, closed: boolean): NewIssueHeaderActions {
  const mainActionId = draft || !closed ? tracker.string.ResumeDraft : tracker.string.NewIssue
  const visibleActions = project ? [tracker.string.CreateProject, mainActionId] : [tracker.string.CreateProject]

  return { mainActionId, visibleActions }
}
