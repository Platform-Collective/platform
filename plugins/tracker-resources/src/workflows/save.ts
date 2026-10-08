//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { Data, DocumentUpdate, Ref, TxOperations } from '@hcengineering/core'
import {
  isFilterWorkflowKind,
  MAX_WORKFLOW_FILTER_LENGTH,
  type EffectiveWorkflow,
  type Project,
  type Workflow,
  type WorkflowConfig
} from '@hcengineering/tracker'

import tracker from '../plugin'

/**
 * What the user changed in a workflow.
 */
export interface WorkflowPatch {
  enabled?: boolean
  filter?: string
  config?: WorkflowConfig
}

/**
 * What saving a patch writes: a new doc (the project never stored this workflow) or an update of the stored one.
 */
export type WorkflowSaveOp =
  | { type: 'create', data: Data<Workflow> }
  | { type: 'update', id: Ref<Workflow>, ops: DocumentUpdate<Workflow> }

function sameConfig (a: WorkflowConfig, b: WorkflowConfig): boolean {
  return a.target?.field === b.target?.field && a.target?.option === b.target?.option
}

/**
 * Turns a patch into the write that saves it, or undefined when it changes nothing of a stored workflow. A workflow
 * that was never stored is created with the patch applied to its defaults, even when the patch equals them, so that the
 * choice of the user is kept if the defaults change later. The filter is trimmed and bounded; it is only kept for a
 * workflow that has one.
 */
export function planWorkflowSave (current: EffectiveWorkflow, patch: WorkflowPatch): WorkflowSaveOp | undefined {
  const enabled = patch.enabled ?? current.enabled
  const filter = isFilterWorkflowKind(current.kind)
    ? (patch.filter ?? current.filter).trim().slice(0, MAX_WORKFLOW_FILTER_LENGTH)
    : ''
  const config = patch.config ?? current.config
  if (current.doc === undefined) {
    const data: Data<Workflow> = { name: current.name, kind: current.kind, enabled }
    if (isFilterWorkflowKind(current.kind)) data.filter = filter
    else data.config = config
    return { type: 'create', data }
  }
  const ops: DocumentUpdate<Workflow> = {}
  if (enabled !== current.enabled) ops.enabled = enabled
  if (isFilterWorkflowKind(current.kind)) {
    if (filter !== current.filter) ops.filter = filter
  } else if (!sameConfig(config, current.config)) {
    ops.config = config
  }
  return Object.keys(ops).length === 0 ? undefined : { type: 'update', id: current.doc._id, ops }
}

/**
 * Saves a patch of a workflow.
 */
export async function saveWorkflow (
  client: TxOperations,
  project: Ref<Project>,
  current: EffectiveWorkflow,
  patch: WorkflowPatch
): Promise<void> {
  const op = planWorkflowSave(current, patch)
  if (op === undefined) return
  if (op.type === 'create') await client.createDoc(tracker.class.Workflow, project, op.data)
  else await client.updateDoc(tracker.class.Workflow, project, op.id, op.ops)
}

/**
 * The stored, enabled filter workflows: what a client asks the server to evaluate when the project is opened.
 */
export function workflowsToKick (workflows: readonly EffectiveWorkflow[]): Array<Ref<Workflow>> {
  return workflows
    .filter((w) => w.enabled && w.doc !== undefined && isFilterWorkflowKind(w.kind))
    .map((w) => (w.doc as Workflow)._id)
}

const requested = new Set<string>()

/**
 * Asks the server to evaluate the filter workflows of a project, once per session and project. There is no timer on
 * the server, so a project in which nothing happens would never see items age into a filter such as
 * `updated:<@today-2w`; opening the project is the moment to look. The request is a harmless touch of the workflow doc
 * (`runRequestedAt`); a viewer who may not write simply does not send it.
 */
export async function requestWorkflowRun (
  client: TxOperations,
  project: Ref<Project>,
  workflows: readonly EffectiveWorkflow[]
): Promise<void> {
  if (requested.has(project)) return
  const ids = workflowsToKick(workflows)
  if (ids.length === 0) return
  requested.add(project)
  const now = Date.now()
  try {
    for (const id of ids) await client.updateDoc(tracker.class.Workflow, project, id, { runRequestedAt: now })
  } catch (err: any) {
    // Not allowed or offline: the server evaluates on the next change instead
    console.debug('[requestWorkflowRun] skipped', err?.message)
  }
}
