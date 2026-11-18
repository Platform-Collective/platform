//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Ref } from '@hcengineering/core'
import type { Issue } from '@hcengineering/tracker'
import type { PrimaryEdit } from './types'
import { getIssueBarRange } from './bar-range'

export interface DragMember {
  issueId: string
  originStart: number
  originEnd: number
}

export type IssueDragCommitState =
  | { kind: 'dragging-body', originStart: number, originEnd: number, previewStart: number, previewEnd: number }
  | { kind: 'resizing-left', originStart: number, originEnd: number, previewStart: number }
  | { kind: 'resizing-right', originStart: number, originEnd: number, previewEnd: number }

/** Return every selected issue with a drawable range, including due-only bars. */
export function selectedDragMembers (
  issues: Issue[],
  selectedIssueIds: ReadonlySet<Ref<Issue> | string>
): DragMember[] {
  return issues.flatMap((issue) => {
    const range = getIssueBarRange(issue)
    return selectedIssueIds.has(issue._id) && range !== null
      ? [{ issueId: issue._id, originStart: range.startDate, originEnd: range.dueDate }]
      : []
  })
}

/** Build the complete date pair persisted after an issue body drag or resize. */
export function issueDragPrimaryEdit (issue: Issue, state: IssueDragCommitState): PrimaryEdit {
  if (state.kind === 'dragging-body') {
    return { issue, newStart: state.previewStart, newDue: state.previewEnd }
  }
  if (state.kind === 'resizing-left') {
    return { issue, newStart: state.previewStart, newDue: state.originEnd }
  }
  return { issue, newStart: state.originStart, newDue: state.previewEnd }
}

/** Convert a co-drag preview into the exact complete schedule written for each selected issue. */
export function bulkDragPrimaryEdits (
  members: DragMember[],
  issues: Issue[],
  anchorDeltaMs: number
): PrimaryEdit[] {
  const issuesByRef = new Map<string, Issue>(issues.map((issue) => [issue._id, issue]))
  return members.flatMap((member) => {
    const issue = issuesByRef.get(member.issueId)
    return issue === undefined
      ? []
      : [{ issue, newStart: member.originStart + anchorDeltaMs, newDue: member.originEnd + anchorDeltaMs }]
  })
}
