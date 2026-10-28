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
 * Cache keys for `control.contextCache` (scoped to one root tx = one
 * request). The dispatcher groups txes by `modifiedBy` and calls the
 * trigger once per group, so stashing per-request state here lets a
 * later invocation see what an earlier one queued, which the
 * cross-group regression guard relies on.
 */
const PENDING_STATUS_CACHE_KEY = 'workflow-rules.pendingStatuses'
const AUTHZ_CACHE_KEY = 'workflow-rules.targetSpaceAuthz'

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
 * before emitting a write. The tx must have been authored by the system
 * account, OR the acting account resolved from `socialStringsToUsers`
 * must hold `AccountRole.Admin`, OR be a member or owner of the target
 * project. Source-project membership alone is not sufficient. The rule
 * management side (who may create a rule on project A that writes to B)
 * is out of scope for the trigger today: the kill switch in
 * `models/all/src/index.ts` ships the plugin disabled, so an Owner has to
 * opt in via Settings > Configure before any rule fires. A dedicated
 * rule-management permission is tracked as a follow-up.
 *
 * Conflict ordering. Transactions in a single invocation are evaluated in
 * `modifiedOn` order, matching the derived-tx sort downstream in
 * `triggers.ts`. A pending-status map retains the latest target status per
 * counterpart issue so equality and regression checks see the effective
 * pending state rather than the stale persisted one. The map lives in
 * `control.contextCache`, which is scoped to one root transaction (one
 * request) by the server pipeline, so it survives across the per-group
 * invocations the trigger dispatcher produces when transactions in one
 * request are authored by different social ids. A request with changes
 * under two social ids targeting the same counterpart can no longer slip
 * a forbidden regression past the guard: the second invocation reads the
 * queued target status written by the first.
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
  // `control.contextCache` is per root tx (per request); the dispatcher
  // calls this trigger once per `modifiedBy` group but all groups within
  // one request share the same cache, so queueing a pending target
  // status here is seen by every subsequent invocation.
  const pendingStatuses: Map<Ref<Issue>, Ref<IssueStatus>> =
    control.contextCache.get(PENDING_STATUS_CACHE_KEY) ?? new Map()
  control.contextCache.set(PENDING_STATUS_CACHE_KEY, pendingStatuses)
  // Keyed by actor+space on purpose. Upstream groups txes by modifiedBy
  // so one invocation sees a single actor today, but keying both makes
  // the memoization correct independently of that invariant.
  const targetSpaceAuthz: Map<string, boolean> =
    control.contextCache.get(AUTHZ_CACHE_KEY) ?? new Map()
  control.contextCache.set(AUTHZ_CACHE_KEY, targetSpaceAuthz)

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
 * Returns true only if the Workflow Rules plugin is explicitly enabled
 * in the workspace. The Settings > Configure toggle writes a
 * `PluginConfiguration` doc with `pluginId = workflowRulesId`; the model
 * also creates one at model-build time, so a healthy workspace always
 * has exactly one row for this plugin.
 *
 * Fails closed. Missing row, zero rows, any row with `enabled !== true`,
 * malformed data, or a lookup error all return `false` and the trigger
 * emits nothing. The feature ships disabled in `models/all` and a
 * workspace Owner has to opt in via Configure; a safeguard that treated
 * "no row" as "enabled" would weaken that default.
 */
function isPluginEnabled (control: TriggerControl): boolean {
  try {
    const configs = control.modelDb.findAllSync(core.class.PluginConfiguration, {
      pluginId: workflowRulesId
    }) as PluginConfiguration[]
    if (configs.length === 0) return false
    return configs.every((c) => c.enabled === true)
  } catch (e) {
    control.ctx.warn('[workflow-rules] could not read PluginConfiguration, failing closed', { error: String(e) })
    return false
  }
}

/**
 * Returns `true` if the acting account may write to `targetSpace`. The
 * derived mirror update does not go through the ordinary space permission
 * middleware, so this check stands in for it.
 *
 * Allowed when:
 *  - the tx was authored by the system account (server-side writes,
 *    integrations). `tx.modifiedBy === core.account.System` is the
 *    authoritative check; the session-level `socialStringsToUsers` map
 *    skips system sessions so a role-based check never fires for them.
 *  - the acting account holds `AccountRole.Admin` or higher.
 *  - the acting account is a member or owner of the target Space.
 *
 * Fails closed when a non-system acting account cannot be resolved from
 * the social id. Results are memoized by `actor + space` for the duration
 * of one invocation so a batch of transactions on one source does not
 * re-fetch the same Space document per rule.
 *
 * The member/owner check is deliberately a strict first step. Archived
 * targets are refused outright. For a public Space a non-member could
 * normally write; this trigger still refuses because the actor is not
 * in the target's membership list. For a `restricted` TypedSpace or a
 * role with a forbid permission the member list can be looser than the
 * actual write rule; this trigger does not consult role grants or
 * forbids, so a non-admin member of a restricted target still passes
 * here even if the real pipeline would refuse the write. Tightening the
 * match to the full permission pipeline (role grants, forbids) is a
 * follow-up tracked alongside the dedicated rule-management permission.
 */
async function isAuthorizedForTarget (
  control: TriggerControl,
  modifiedBy: PersonId,
  targetSpace: Ref<Space>,
  cache: Map<string, boolean>
): Promise<boolean> {
  // System-authored writes (server integrations) are allowed before
  // consulting the session map because the session map builder omits
  // system sessions, so this check must come first or the branch is
  // dead.
  if (modifiedBy === core.account.System) return true

  const sessionData = control.ctx.contextData
  const resolved = sessionData?.socialStringsToUsers?.get(modifiedBy)
  if (resolved === undefined) return false
  const accountUuid: AccountUuid = resolved.accontUuid

  const cacheKey = `${accountUuid}:${targetSpace}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  if (accountUuid === systemAccountUuid) {
    cache.set(cacheKey, true)
    return true
  }
  if (roleOrder[resolved.role] >= roleOrder[AccountRole.Admin]) {
    cache.set(cacheKey, true)
    return true
  }

  const [target] = await control.findAll(
    control.ctx,
    tracker.class.Project,
    { _id: targetSpace as Ref<Project> },
    { limit: 1 }
  )
  if (target === undefined) {
    cache.set(cacheKey, false)
    return false
  }
  // Archived target: nobody writes.
  if (target.archived === true) {
    cache.set(cacheKey, false)
    return false
  }
  const members = Array.isArray(target.members) ? target.members : []
  const owners = Array.isArray(target.owners) ? target.owners : []
  const ok = members.includes(accountUuid) || owners.includes(accountUuid)
  cache.set(cacheKey, ok)
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
