//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Doc, Ref, TxOperations } from '@hcengineering/core'
import type { Issue, Iteration, ProjectField } from '@hcengineering/tracker'
import { planAddIteration, planIterationChange, planMoveItems, type AddIterationOptions, type IterationChange, type IterationPlanError } from '@hcengineering/tracker'

import tracker from '../plugin'

/**
 * Move the given issues from one iteration of a field to another one (or to none). Issues that are
 * not in `from` are left alone. The change is atomic. Returns the number of issues that were moved.
 */
export async function moveIterationItems (
  client: TxOperations,
  issues: ReadonlyArray<Pick<Doc, '_id'>>,
  field: Pick<ProjectField, 'key' | 'space'>,
  from: string,
  to: string | null
): Promise<number> {
  if (issues.length === 0) return 0
  // The documents of a list group are projections: the full issues are needed to update them
  const full = await client.findAll(tracker.class.Issue, { _id: { $in: issues.map((i) => i._id as Ref<Issue>) } })
  const plan = planMoveItems(full, field.key, from, to)
  if (plan.length === 0) return 0
  const batch = client.apply()
  for (const { issue, customFields } of plan) {
    await batch.updateCollection(
      issue._class,
      issue.space,
      issue._id,
      issue.attachedTo,
      issue.attachedToClass,
      issue.collection,
      { customFields }
    )
  }
  const res = await batch.commit()
  if (!res.result) throw new Error('The items could not be moved: the data was changed meanwhile')
  return plan.length
}

/**
 * Apply a change of one iteration (title, start, duration) and the shift of the later ones in one batch.
 * Returns the reason when the change is not allowed.
 */
export async function changeIteration (
  client: TxOperations,
  iterations: readonly Iteration[],
  id: Ref<Iteration>,
  change: IterationChange
): Promise<IterationPlanError | undefined> {
  const plan = planIterationChange(iterations, id, change)
  if (plan.ok === false) return plan.error
  if (plan.updates.length === 0) return undefined
  const space = iterations.find((it) => it._id === id)?.space
  if (space === undefined) return 'unknown'
  const batch = client.apply()
  for (const u of plan.updates) {
    await batch.updateDoc(tracker.class.Iteration, space, u.id, u.update)
  }
  await batch.commit()
  return undefined
}

/**
 * Add an iteration or a break to a field (see `planAddIteration`) and shift what follows it, in one batch.
 */
export async function addIteration (
  client: TxOperations,
  field: Pick<ProjectField, '_id' | 'space'>,
  iterations: readonly Iteration[],
  options: AddIterationOptions
): Promise<IterationPlanError | undefined> {
  const plan = planAddIteration(iterations, options)
  if (plan.ok === false) return plan.error
  const batch = client.apply()
  for (const u of plan.updates) {
    await batch.updateDoc(tracker.class.Iteration, field.space, u.id, u.update)
  }
  await batch.createDoc(tracker.class.Iteration, field.space, { ...plan.draft, field: field._id })
  await batch.commit()
  return undefined
}

/**
 * Delete an iteration. The server removes it from the issues that were in it.
 */
export async function removeIteration (client: TxOperations, iteration: Iteration): Promise<void> {
  await client.removeDoc(tracker.class.Iteration, iteration.space, iteration._id)
}
