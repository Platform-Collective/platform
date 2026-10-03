//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/** How many sub-issues of an issue are done (GitHub's "Sub-issues progress"). */
export interface SubIssueProgress {
  done: number
  total: number
}

/** What the progress needs to know about a sub-issue. */
export interface SubIssueRef {
  attachedTo: string
  status: string
}

/**
 * Progress of every parent, over its direct sub-issues. A sub-issue is done when its status is one of
 * `closedStatuses` (done or cancelled, the same rule as the sub-issues button of a row). The progress counts all
 * sub-issues of the parent, whether the view shows them or not.
 * `noParentId` is the value of `attachedTo` of an issue without a parent.
 */
export function buildProgressIndex (
  subIssues: readonly SubIssueRef[],
  closedStatuses: ReadonlySet<string>,
  noParentId: string
): Map<string, SubIssueProgress> {
  const index = new Map<string, SubIssueProgress>()
  for (const sub of subIssues) {
    if (sub.attachedTo === noParentId || sub.attachedTo === '' || sub.attachedTo === undefined) continue
    let progress = index.get(sub.attachedTo)
    if (progress === undefined) {
      progress = { done: 0, total: 0 }
      index.set(sub.attachedTo, progress)
    }
    progress.total++
    if (closedStatuses.has(sub.status)) progress.done++
  }
  return index
}

/** The progress of one parent; undefined when it has no sub-issues. */
export function progressOf (index: ReadonlyMap<string, SubIssueProgress>, parentId: string): SubIssueProgress | undefined {
  return index.get(parentId)
}

/** Share of the sub-issues that are done, 0..1; 0 when there are none. */
export function progressRatio (progress: SubIssueProgress | undefined): number {
  if (progress === undefined || progress.total <= 0) return 0
  return Math.min(1, Math.max(0, progress.done / progress.total))
}

/** `done/total`, e.g. `2/5`. */
export function formatProgress (progress: SubIssueProgress): string {
  return `${progress.done}/${progress.total}`
}
