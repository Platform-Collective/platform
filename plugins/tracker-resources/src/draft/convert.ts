//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { type Ref, type TxOperations } from '@hcengineering/core'
import tracker, { convertDraftUpdate, isIssueDraft, type Issue, type Project } from '@hcengineering/tracker'

/** Drafts one conversion handles at most, so that one click never turns into an unbounded write. */
export const MAX_CONVERT_BATCH = 500

/** A draft that could not be converted (somebody changed it meanwhile, or its project is gone). */
export class DraftConvertError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'DraftConvertError'
  }
}

/** The drafts a conversion handles: the ones that are still drafts, each once, up to the cap. */
export function selectDraftsToConvert<T extends Pick<Issue, '_id' | 'isDraft'>> (drafts: readonly T[]): T[] {
  const seen = new Set<Ref<Issue>>()
  const result: T[] = []
  for (const draft of drafts) {
    if (seen.has(draft._id) || !isIssueDraft(draft)) continue
    seen.add(draft._id)
    result.push(draft)
    if (result.length >= MAX_CONVERT_BATCH) break
  }
  return result
}

/**
 * Converts draft items to issues (GitHub "Convert to issue"). The numbers come from the sequence of the project, the
 * way the create issue form takes them: the sequence is incremented first (the new value is needed to build the
 * identifier), then the drafts of all projects are updated in one `apply` batch that only goes through when every one
 * of them is still a draft, so that a draft converted by somebody else in the meantime is never renumbered. When the
 * batch is refused, the numbers that were taken stay unused, as after a failed create.
 *
 * Returns the identifiers the drafts got, by draft id.
 */
export async function convertDraftsToIssues (
  client: TxOperations,
  drafts: readonly Issue[]
): Promise<Map<Ref<Issue>, string>> {
  const targets = selectDraftsToConvert(drafts)
  const result = new Map<Ref<Issue>, string>()
  if (targets.length === 0) return result

  const projects = new Map<Ref<Project>, Project>()
  for (const draft of targets) {
    if (projects.has(draft.space)) continue
    const project = await client.findOne(tracker.class.Project, { _id: draft.space })
    if (project === undefined) throw new DraftConvertError(`Project ${draft.space} was not found`)
    projects.set(draft.space, project)
  }

  const batch = client.apply(undefined, 'tracker.convertDraft')
  for (const draft of targets) {
    const project = projects.get(draft.space) as Project
    const incResult = await client.updateDoc(
      tracker.class.Project,
      core.space.Space,
      project._id,
      { $inc: { sequence: 1 } },
      true
    )
    const number = (incResult as any).object.sequence as number
    const update = convertDraftUpdate(number, project.identifier)
    batch.match(tracker.class.Issue, { _id: draft._id, isDraft: true })
    await batch.update(draft, update)
    result.set(draft._id, update.identifier)
  }
  const committed = await batch.commit()
  if (!committed.result) throw new DraftConvertError('The draft was changed meanwhile and is not converted')
  return result
}
