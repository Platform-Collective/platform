//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, {
  TxProcessor,
  type Doc,
  type Ref,
  type Space,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxUpdateDoc
} from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import task from '@hcengineering/task'
import tracker, {
  archiveUpdate,
  isAutomationAuthor,
  isFieldWorkflowKind,
  planIssueWorkflows,
  resolveWorkflows,
  restoreUpdate,
  WorkflowKind,
  type EffectiveWorkflow,
  type Issue,
  type IssueChange,
  type Project,
  type Workflow
} from '@hcengineering/tracker'

import { replayAround } from '../history'
import { logTrigger } from '../log'
import { planFilterWorkflows } from './engine'

// Server side of the built-in workflows.
//
//  - Loop protection: every write of a workflow is authored by the system account, and a workflow never reacts to a
//    change authored by it (`isAutomationAuthor`). All writes are idempotent too: they are skipped when the value is
//    already there, so nothing can ping-pong. The system account is also what the activity timeline shows for such a
//    change ("System"), which tells the viewer it was not a person.
//  - Caps: a filter workflow changes at most `MAX_WORKFLOW_ITEMS_PER_RUN` issues per run and reads at most
//    `WORKFLOW_SCAN_LIMIT`, oldest first; the rest is picked up by the next run.

/** Evaluations of a project triggered by issue changes are at most this often apart. */
export const WORKFLOW_RUN_INTERVAL_MS = 60 * 1000

const lastRunKey = (project: Ref<Project>): string => `tracker:workflow:last-run:${project}`

async function projectWorkflows (control: TriggerControl, project: Ref<Project>): Promise<EffectiveWorkflow[]> {
  const docs = await control.findAll(control.ctx, tracker.class.Workflow, { space: project })
  return resolveWorkflows(docs as Workflow[])
}

function isIssueTx (tx: Tx, control: TriggerControl): tx is TxCUD<Issue> {
  if (!TxProcessor.isExtendsCUD(tx._class)) return false
  return control.hierarchy.isDerived((tx as TxCUD<Doc>).objectClass, tracker.class.Issue)
}

/**
 * The "set a field" workflows (item closed, item reopened, item added to project), run with the transaction that
 * causes them. A new issue or a status change sets the value of the project's Status field when the matching
 * workflow is enabled. The write is a second update of the issue in the same transaction batch.
 * @public
 */
export async function OnIssueWorkflow (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  const workflowCache = new Map<Ref<Project>, EffectiveWorkflow[]>()
  let closedStatuses: Set<string> | undefined

  for (const tx of txes) {
    if (isAutomationAuthor(tx.modifiedBy, core.account.System)) continue
    if (!isIssueTx(tx, control)) continue

    let change: IssueChange | undefined
    let issue: Pick<Issue, '_id' | '_class' | 'space' | 'customFields'> | undefined
    let prevOf: (() => Promise<string | undefined>) | undefined

    if (tx._class === core.class.TxCreateDoc) {
      const created = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Issue>)
      change = { type: 'created' }
      issue = created
    } else if (tx._class === core.class.TxUpdateDoc) {
      const next = (tx as TxUpdateDoc<Issue>).operations.status
      if (typeof next !== 'string') continue
      change = { type: 'status', next }
      prevOf = async () => (await replayAround<Issue>(control, tx)).before?.status as string | undefined
    } else {
      continue
    }

    const project = tx.objectSpace as Ref<Project>
    let workflows = workflowCache.get(project)
    if (workflows === undefined) {
      workflows = await projectWorkflows(control, project)
      workflowCache.set(project, workflows)
    }
    const fieldWorkflows = workflows.filter((w) => w.enabled && isFieldWorkflowKind(w.kind))
    if (fieldWorkflows.length === 0) continue

    const fields = await control.findAll(control.ctx, tracker.class.ProjectField, { space: project })
    if (fields.length === 0) continue

    if (closedStatuses === undefined) {
      const statuses = await control.findAll(control.ctx, tracker.class.IssueStatus, {})
      closedStatuses = new Set(
        statuses
          .filter((s) => s.category === task.statusCategory.Won || s.category === task.statusCategory.Lost)
          .map((s) => s._id as string)
      )
    }

    // The previous status is only needed to tell a close from a move between closed statuses (and a reopen)
    if (change.type === 'status' && prevOf !== undefined) {
      change = { ...change, prev: await prevOf() }
    }
    if (issue === undefined) {
      // The issue as it is now (the status update is already applied)
      issue = (await control.findAll(control.ctx, tracker.class.Issue, { _id: tx.objectId as Ref<Issue> }, { limit: 1 }))[0]
    }
    if (issue === undefined) continue

    const customFields = planIssueWorkflows(fieldWorkflows, change, issue, closedStatuses, fields)
    if (customFields === undefined) continue
    result.push(
      control.txFactory.createTxUpdateDoc<Issue>(
        issue._class,
        issue.space,
        issue._id,
        { customFields },
        false,
        undefined,
        core.account.System
      )
    )
  }
  return result
}

/**
 * Auto-archive and Auto-add (restore) of a project, evaluated after the fact (asynchronously). It runs
 *
 *  - when a workflow of the project is created or changed (GitHub also archives what already matches when the
 *    workflow is switched on),
 *  - when an issue of the project changes, at most once a minute per project, which is how items that age into a
 *    filter such as `updated:<@today-2w` are found without a timer,
 *  - when a client that opens the project asks for it by touching a workflow (`runRequestedAt`).
 * There is no periodic runner in the server: a project in which nothing happens and nobody looks at is not evaluated.
 * @public
 */
export async function OnWorkflowEvaluate (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const forced = new Set<Ref<Project>>()
  const soft = new Set<Ref<Project>>()
  for (const tx of txes) {
    // Loop protection: a change made by the automation never starts another evaluation
    if (isAutomationAuthor(tx.modifiedBy, core.account.System)) continue
    if (!TxProcessor.isExtendsCUD(tx._class)) continue
    const cud = tx as TxCUD<Doc>
    if (cud._class === core.class.TxRemoveDoc) continue
    const project = cud.objectSpace as Ref<Space> as Ref<Project>
    if (control.hierarchy.isDerived(cud.objectClass, tracker.class.Workflow)) forced.add(project)
    else if (control.hierarchy.isDerived(cud.objectClass, tracker.class.Issue)) soft.add(project)
  }

  const now = Date.now()
  const result: Tx[] = []
  for (const project of new Set([...forced, ...soft])) {
    if (!forced.has(project)) {
      const last = control.cache.get(lastRunKey(project)) as number | undefined
      if (last !== undefined && now - last < WORKFLOW_RUN_INTERVAL_MS) continue
    }
    control.cache.set(lastRunKey(project), now)

    try {
      const workflows = await projectWorkflows(control, project)
      if (!workflows.some((w) => w.enabled && (w.kind === WorkflowKind.AutoArchive || w.kind === WorkflowKind.AutoAddFromQuery))) {
        continue
      }
      const plan = await planFilterWorkflows(control, project, workflows, now)
      for (const issue of plan.archive) {
        result.push(
          control.txFactory.createTxUpdateDoc<Issue>(
            issue._class,
            issue.space,
            issue._id,
            archiveUpdate(now),
            false,
            undefined,
            core.account.System
          )
        )
      }
      for (const issue of plan.restore) {
        result.push(
          control.txFactory.createTxUpdateDoc<Issue>(
            issue._class,
            issue.space,
            issue._id,
            restoreUpdate(),
            false,
            undefined,
            core.account.System
          )
        )
      }
      if (plan.archive.length + plan.restore.length > 0) {
        logTrigger(control, 'info', 'tracker workflows changed issues', {
          project,
          archived: plan.archive.length,
          restored: plan.restore.length
        })
      }
    } catch (err: any) {
      // One project must not stop the others, and a failing evaluation is retried by the next one
      logTrigger(control, 'error', 'tracker workflow evaluation failed', { project, err })
    }
  }
  return result
}
