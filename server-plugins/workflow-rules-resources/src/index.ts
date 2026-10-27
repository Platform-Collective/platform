// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import core, {
  AccountRole,
  roleOrder,
  systemAccountUuid,
  type AccountUuid,
  type PersonId,
  type PluginConfiguration,
  type Ref,
  type Space,
  type Tx,
  type TxUpdateDoc
} from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import task from '@hcengineering/task'
import tracker, { type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'
import workflowRules, { workflowRulesId, type WorkflowRule } from '@hcengineering/workflow-rules'

import { isRegression } from './logic'

export { isRegression } from './logic'

/**
 * Trigger body for `OnWorkflowRuleMirror`. Fires on `TxUpdateDoc` whose
 * `objectClass` derives from `tracker.class.Issue`. Short circuits early
 * when the update is not a status change so the hot path stays cheap: most
 * issue updates are not status moves.
 *
 * Cascade behavior (one hop). The trigger skips updates whose own tx `space`
 * is `core.space.DerivedTx`, so a mirror update produced by this trigger
 * cannot trigger another mirror. That also means status writes emitted by
 * any other server trigger are not mirrored. For v1 this is the intended
 * one hop semantics; multi hop would want a cascade-scoped visited set and
 * a hard depth bound instead. See `docs/workflow-rules/DESIGN.md`.
 *
 * Rules read back from storage are validated per invocation. A malformed
 * rule is skipped with a warn log; it does not abort the batch for other
 * rules on the same source. Interface types do not validate persisted docs,
 * so the trigger treats stored JSON as untrusted.
 *
 * Authorization. The derived mirror update bypasses the ordinary space
 * permission middleware, so this trigger enforces authorization itself
 * before emitting a write. The acting account must either be the system
 * account, hold `AccountRole.Admin`, or be a member or owner of the target
 * project. Source-project membership alone is not sufficient. The rule
 * management side (who may create a rule on project A that writes to B) is
 * out of scope for the trigger: it is enforced by the space permission
 * middleware on the rule document itself via its `space` tie-in to the
 * source project.
 *
 * Conflict ordering. Transactions in a single invocation are evaluated in
 * `modifiedOn` order, matching the derived-tx sort downstream in
 * `triggers.ts`. A pending-status map retains the latest target status per
 * counterpart issue across the whole batch, so equality and regression
 * checks see the effective pending state rather than the stale persisted
 * one. Two rules or two source transactions targeting the same counterpart
 * in one request can no longer slip a forbidden regression past the guard.
 *
 * Plugin enable. If the `PluginConfiguration` row for this plugin is
 * disabled in the workspace model, the whole trigger is a no-op. The
 * Settings > Configure toggle is the kill switch and takes effect without
 * a server restart because this is checked on every invocation.
 *
 * @public
 */
export async function OnWorkflowRuleMirror (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  if (!isPluginEnabled(control)) return []

  const sorted = [...txes].sort((a, b) => a.modifiedOn - b.modifiedOn)
  const result: Tx[] = []
  const pendingStatuses = new Map<Ref<Issue>, Ref<IssueStatus>>()
  const targetSpaceAuthz = new Map<Ref<Space>, boolean>()

  for (const actualTx of sorted) {
    if (actualTx._class !== core.class.TxUpdateDoc) continue
    // Skip derived writes to bound mirror cascades to one hop.
    if (actualTx.space === core.space.DerivedTx) continue
    const updateTx = actualTx as TxUpdateDoc<Issue>
    if (!control.hierarchy.isDerived(updateTx.objectClass, tracker.class.Issue)) continue

    const newStatus = updateTx.operations.status
    if (newStatus == null) continue

    const [source] = await control.findAll(
      control.ctx,
      tracker.class.Issue,
      { _id: updateTx.objectId },
      { limit: 1 }
    )
    if (source === undefined) continue

    const rules = (await control.findAll(
      control.ctx,
      workflowRules.class.WorkflowRule,
      { space: source.space, enabled: true }
    )) as unknown as WorkflowRule[]
    if (rules.length === 0) continue

    for (const rule of rules) {
      if (!isValidRule(rule)) {
        control.ctx.warn('[workflow-rules] invalid rule skipped', { ruleId: rule._id })
        continue
      }

      const counterpart = await resolveCounterpart(control, source, rule)

      if (counterpart === undefined) {
        // Auto-create path: the counterpart does not exist yet, and the new
        // status is in the rule's auto-create trigger set. Phase 3b will fill
        // this in with: resolve target TaskType, allocate next sequence
        // number, build identifier, copy inheritable fields, emit
        // TxCreateDoc<Issue> with attachedTo pointing at `source`. Deferred
        // from the first PR because sequence allocation needs its own review.
        if (rule.autoCreate != null && rule.autoCreate.triggerStatuses.includes(newStatus)) {
          control.ctx.info(
            '[workflow-rules] auto-create requested but not yet implemented',
            { ruleId: rule._id, sourceIssue: source._id, status: newStatus }
          )
        }
        continue
      }

      // Own property only. A persisted rule can contain non string mapping
      // values. For an unmapped source value such as `constructor`, an
      // ordinary object lookup can produce a non status value.
      if (!Object.prototype.hasOwnProperty.call(rule.forwardMap, newStatus)) continue
      const target = rule.forwardMap[newStatus]
      if (typeof target !== 'string' || target.length === 0) continue

      // Evaluate against the pending status for this counterpart, not the
      // stale persisted one. The pending map carries forward updates we
      // already queued for later application against the same target.
      const effectiveStatus = pendingStatuses.get(counterpart._id) ?? counterpart.status
      if (effectiveStatus === target) continue

      const regressed = await checkRegressionGuard(
        control,
        counterpart,
        effectiveStatus,
        target,
        rule
      )
      if (regressed) {
        control.ctx.info(
          '[workflow-rules] mirror suppressed by regression guard',
          {
            ruleId: rule._id,
            source: source._id,
            counterpart: counterpart._id,
            from: effectiveStatus,
            to: target
          }
        )
        continue
      }

      const authorized = await isAuthorizedForTarget(control, updateTx.modifiedBy, counterpart.space, targetSpaceAuthz)
      if (!authorized) {
        control.ctx.warn(
          '[workflow-rules] mirror suppressed: actor not authorized on target project',
          {
            ruleId: rule._id,
            source: source._id,
            counterpart: counterpart._id,
            targetSpace: counterpart.space,
            modifiedBy: updateTx.modifiedBy
          }
        )
        continue
      }

      result.push(
        control.txFactory.createTxUpdateDoc(
          counterpart._class,
          counterpart.space,
          counterpart._id,
          { status: target },
          false,
          updateTx.modifiedOn
        )
      )
      pendingStatuses.set(counterpart._id, target)
    }
  }
  return result
}

/**
 * Returns true if the Workflow Rules plugin is enabled in the current
 * workspace. The Settings > Configure toggle writes a
 * `PluginConfiguration` doc with `pluginId = workflowRulesId`; when it is
 * disabled the trigger should emit no mirror updates.
 *
 * Reads via `modelDb` so the check is a cheap in-memory lookup on every
 * invocation. Missing or malformed config is treated as enabled, matching
 * the default-enabled registration in `models/all`.
 */
function isPluginEnabled (control: TriggerControl): boolean {
  try {
    const configs = control.modelDb.findAllSync(core.class.PluginConfiguration, {
      pluginId: workflowRulesId
    }) as PluginConfiguration[]
    if (configs.length === 0) return true
    return configs.every((c) => c.enabled !== false)
  } catch (e) {
    control.ctx.warn('[workflow-rules] could not read PluginConfiguration', { error: String(e) })
    return true
  }
}

/**
 * Returns `true` if the acting account may write to `targetSpace`. The
 * derived mirror update does not go through the ordinary space permission
 * middleware, so this check stands in for it.
 *
 * Allowed when:
 *  - the account is the system account (server-side writes),
 *  - the account holds `AccountRole.Admin` (workspace admins),
 *  - the account is a member or owner of the target Space.
 *
 * Fails closed when the acting account cannot be resolved from the social
 * id. Results are memoized per target space for the duration of one
 * invocation so a batch of transactions on one source does not re-fetch
 * the same Space document per rule.
 */
async function isAuthorizedForTarget (
  control: TriggerControl,
  modifiedBy: PersonId,
  targetSpace: Ref<Space>,
  cache: Map<Ref<Space>, boolean>
): Promise<boolean> {
  const cached = cache.get(targetSpace)
  if (cached !== undefined) return cached

  const sessionData = control.ctx.contextData
  const resolved = sessionData?.socialStringsToUsers?.get(modifiedBy)
  if (resolved === undefined) {
    cache.set(targetSpace, false)
    return false
  }
  const accountUuid: AccountUuid = resolved.accontUuid
  if (accountUuid === systemAccountUuid) {
    cache.set(targetSpace, true)
    return true
  }
  if (roleOrder[resolved.role] >= roleOrder[AccountRole.Admin]) {
    cache.set(targetSpace, true)
    return true
  }

  const [target] = await control.findAll(
    control.ctx,
    tracker.class.Project,
    { _id: targetSpace as Ref<Project> },
    { limit: 1 }
  )
  if (target === undefined) {
    cache.set(targetSpace, false)
    return false
  }
  const members = Array.isArray(target.members) ? target.members : []
  const owners = Array.isArray(target.owners) ? target.owners : []
  const ok = members.includes(accountUuid) || owners.includes(accountUuid)
  cache.set(targetSpace, ok)
  return ok
}

/**
 * Shape check for a persisted `WorkflowRule` doc. The TypeScript interface
 * does not validate stored JSON, so the trigger treats everything read from
 * storage as untrusted. A malformed rule is skipped with a warn log; it
 * does not abort processing for other rules on the same source.
 *
 * @public
 */
export function isValidRule (rule: WorkflowRule): boolean {
  if (typeof rule.linkedProject !== 'string' || rule.linkedProject.length === 0) return false
  if (rule.linkKind !== 'subIssue' && rule.linkKind !== 'parentIssue') return false
  if (rule.forwardMap == null || typeof rule.forwardMap !== 'object' || Array.isArray(rule.forwardMap)) return false
  for (const [from, to] of Object.entries(rule.forwardMap)) {
    if (from.length === 0) return false
    if (typeof to !== 'string' || to.length === 0) return false
  }
  if (!Array.isArray(rule.allowedLoops)) return false
  for (const loop of rule.allowedLoops) {
    if (loop == null) return false
    if (typeof loop.from !== 'string' || loop.from.length === 0) return false
    if (typeof loop.to !== 'string' || loop.to.length === 0) return false
  }
  if (rule.autoCreate != null) {
    if (!Array.isArray(rule.autoCreate.triggerStatuses)) return false
    for (const s of rule.autoCreate.triggerStatuses) {
      if (typeof s !== 'string' || s.length === 0) return false
    }
  }
  return true
}

/**
 * Resolve the counterpart Issue for a source Issue under a rule. Returns
 * `undefined` if no counterpart exists OR if the match is ambiguous
 * (multiple children). The caller must treat ambiguity as absence and
 * never silently update one of several candidates. Separate so the unit
 * tests can exercise each `linkKind` branch directly.
 *
 * @public
 */
export async function resolveCounterpart (
  control: TriggerControl,
  source: Issue,
  rule: WorkflowRule
): Promise<Issue | undefined> {
  switch (rule.linkKind) {
    case 'subIssue': {
      const found = await control.findAll(
        control.ctx,
        tracker.class.Issue,
        {
          attachedTo: source._id,
          attachedToClass: tracker.class.Issue,
          collection: 'subIssues',
          space: rule.linkedProject
        },
        { limit: 2 }
      )
      // Require a unique match. Ambiguity (two or more children) is treated
      // as absence; the mirror does not pick one at the database's whim.
      if (found.length !== 1) return undefined
      return found[0]
    }
    case 'parentIssue': {
      if (source.attachedTo == null) return undefined
      if (source.attachedToClass !== tracker.class.Issue) return undefined
      const [found] = await control.findAll(
        control.ctx,
        tracker.class.Issue,
        {
          _id: source.attachedTo as Ref<Issue>,
          space: rule.linkedProject
        },
        { limit: 1 }
      )
      return found
    }
    default: {
      const _exhaustive: never = rule.linkKind
      return undefined
    }
  }
}

/**
 * Decide whether a proposed mirror update would move the counterpart to a
 * lower rank status without an explicit `allowedLoops` entry. Rank is the
 * index position of a status in the TaskType's `statuses` list of the
 * target project; the TaskType is the authority on ordering.
 *
 * Takes the effective "from" status so the batched pending-status map can
 * feed in the queued-but-not-yet-persisted target status for the same
 * counterpart. Without that, two queued updates on one counterpart would
 * both read the stale persisted status and could together apply a
 * forbidden regression.
 *
 * Fails closed. Returns `true` (BLOCK) when the counterpart's TaskType
 * cannot be read, when either the effective `from` or the proposed
 * `target` is not a member of that TaskType's status list, or when
 * `allowedLoops` is malformed. Only a verified pair is subject to the
 * ordinary rank comparison. An `allowedLoops` entry must not authorize a
 * status that does not exist in the target.
 *
 * @public
 */
export async function checkRegressionGuard (
  control: TriggerControl,
  counterpart: Issue,
  effectiveFrom: Ref<IssueStatus>,
  target: Ref<IssueStatus>,
  rule: WorkflowRule
): Promise<boolean> {
  const [tt] = await control.findAll(
    control.ctx,
    task.class.TaskType,
    { _id: counterpart.kind },
    { limit: 1 }
  )
  if (tt === undefined || !Array.isArray(tt.statuses)) return true

  const statuses: Array<Ref<IssueStatus>> = tt.statuses as Array<Ref<IssueStatus>>
  if (!statuses.includes(effectiveFrom) || !statuses.includes(target)) return true
  if (!Array.isArray(rule.allowedLoops)) return true
  for (const loop of rule.allowedLoops) {
    if (loop == null || typeof loop.from !== 'string' || typeof loop.to !== 'string') return true
  }

  return isRegression(effectiveFrom, target, statuses, rule.allowedLoops)
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    OnWorkflowRuleMirror
  }
})
