// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

import contact, { type Employee } from '@hcengineering/contact'
import core, {
  AccountRole,
  generateId,
  roleOrder,
  systemAccountUuid,
  type AccountUuid,
  type Data,
  type DocumentClassQuery,
  type Doc,
  type PersonId,
  type Ref,
  type Space,
  type Tx,
  type TxApplyIf,
  type TxCUD,
  type TxResult,
  type TxUpdateDoc
} from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import task, { type ProjectType, type TaskType } from '@hcengineering/task'
import tracker, {
  IssuePriority,
  type Component,
  type Issue,
  type IssueParentInfo,
  type IssueStatus,
  type Project
} from '@hcengineering/tracker'
import workflowRules, {
  workflowRulesId,
  type WorkflowRule,
  type WorkflowRuleInheritField
} from '@hcengineering/workflow-rules'

import { isRegression } from './logic'

export { isRegression } from './logic'

/**
 * Cache key for processed request arrays in `control.contextCache`.
 * The pipeline normally scopes this map to one root transaction (one
 * request), but `wrapPipeline()` can reuse the `SessionData` across
 * concurrent `pipeline.tx()` calls. A WeakSet tracks each request's
 * `control.txes` identity independently without retaining finished arrays.
 */
const PROCESSED_CACHE_KEY = 'workflow-rules.processed'

/**
 * Trigger body for `OnWorkflowRuleMirror`. Fires on `TxUpdateDoc` whose
 * `objectClass` derives from `tracker.class.Issue`. Short circuits early
 * when the update is not a status change so the hot path stays cheap: most
 * issue updates are not status moves.
 *
 * Cascade behavior (one hop). The trigger skips updates whose own tx `space`
 * is `core.space.DerivedTx`, so a mirror update produced by this trigger
 * cannot trigger another mirror. Derived status writes emitted by other
 * server triggers are also excluded. For v1 this is the intended
 * one hop semantics; multi hop would want a cascade-scoped visited set and
 * a hard depth bound instead. See `docs/workflow-rules/DESIGN.md`.
 *
 * Rules read back from storage are validated per invocation. A malformed
 * rule is skipped with a warn log; it does not abort the batch for other
 * rules on the same source. Interface types do not validate persisted docs,
 * so the trigger treats stored JSON as untrusted.
 *
 * Authorization. The derived mirror update bypasses the ordinary space
 * permission middleware AND the `GuestPermissionsMiddleware`, so this
 * trigger enforces authorization itself before emitting a write.
 * Target-level checks run first and apply to every caller including the
 * system account and workspace admins: a missing target, an archived
 * target, or a `restricted` TypedSpace is refused unconditionally. After
 * those pass, the acting account is checked against the actor-level
 * rules below.
 *
 * Guest-class roles (`Guest`, `DocGuest`, `ReadOnlyGuest`) are refused
 * outright. `GuestPermissionsMiddleware` only lets a Guest write their
 * own doc, and a mirror onto a counterpart issue the guest did not
 * create is exactly the write that middleware would have refused. Rather
 * than replicate the guest's own-doc model here (and the role-forbid
 * `ModulePermissionGroup` consultation that goes with it), the trigger
 * refuses every below-User role until the full guest-permission
 * integration lands in a follow-up PR. This matches the rule
 * "refuse the unsupported case" and is strictly a strict first step:
 * widening Guest access later is additive. The acting account is
 * accepted only when the tx was authored by the system account, the
 * resolved role is `AccountRole.User` or higher AND (the role is
 * `AccountRole.Admin` or higher OR the account is a member or owner of
 * the target space). Source-project membership alone is not sufficient.
 * The rule management side (who may create a rule on project A that
 * writes to B) is out of scope for the trigger today: the kill switch
 * in `models/all/src/index.ts` ships the plugin disabled, so an Owner
 * has to opt in via Settings > Configure before any rule fires. A
 * dedicated rule-management permission and full permission-pipeline
 * integration (per-role class forbids on unrestricted projects,
 * guest-own-doc semantics) are tracked as a follow-up.
 *
 * Cross-request concurrency. The pending-status map protects within one
 * invocation; the dispatcher also reorders groups within one request by
 * `modifiedOn`, so two groups in one request never race. Two CONCURRENT
 * requests, however, can each read the same persisted counterpart
 * status (say `Backlog`) and independently decide to move the
 * counterpart to incompatible targets (say `Done` and `InProgress`),
 * with the second applying after the first and performing a forbidden
 * regression that the first-request read did not anticipate. Every
 * derived update is therefore wrapped in a `TxApplyIf` whose `match`
 * asserts the counterpart's live status equals the `effectiveStatus`
 * the trigger evaluated against. If a concurrent request has advanced
 * the counterpart since the read, the match fails and the derived tx
 * is dropped (not partially applied). The dispatcher will fire the
 * trigger again on the latest write and re-evaluate from scratch.
 *
 * Conflict ordering. The first invocation evaluates the complete request
 * (`control.txes`) in `modifiedOn` order, with request-array order breaking
 * ties. A local pending-status map keyed by counterpart starts from the
 * stored (post-request) status and advances only after an authorized, legal
 * mirror is emitted. No-op and refused candidates are evaluated at their
 * place in that sequence, so allowedLoops and intermediate moves have the same
 * result regardless of the dispatcher's actor-group visit order. Each
 * emitted update retains its source actor and timestamp.
 *
 * A WeakSet in `control.contextCache` makes later actor groups skip each
 * successfully evaluated request. Request arrays are tracked independently
 * even when concurrent `pipeline.tx()` calls share a `SessionData` through
 * `wrapPipeline()`. A failed evaluation leaves the request unmarked so a
 * later group can retry it. Authorization is memoized within each evaluation.
 *
 * Plugin enable. If the `PluginConfiguration` row for this plugin is
 * disabled in the workspace model, the whole trigger is a no-op. The
 * Settings > Configure toggle is the kill switch and takes effect without
 * a server restart because this is checked on every invocation.
 *
 * @public
 */
export async function OnWorkflowRuleMirror (_txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  if (!isPluginEnabled(control)) return []

  const processed: WeakSet<Tx[]> = control.contextCache.get(PROCESSED_CACHE_KEY) ?? new WeakSet()
  control.contextCache.set(PROCESSED_CACHE_KEY, processed)
  if (processed.has(control.txes)) return []

  // Snapshot the full request across actor groups. Stable sort preserves
  // request-array order for equal timestamps, independently of group order.
  const sorted = [...control.txes].sort((a, b) => a.modifiedOn - b.modifiedOn)
  const result: Tx[] = []
  const pendingStatuses = new Map<Ref<Issue>, Ref<IssueStatus>>()
  // A request can contain multiple actors, so memoize by actor+space.
  const targetSpaceAuthz = new Map<string, boolean>()
  // Per-request guard against duplicate auto-creates: if the same (source,
  // rule) fires auto-create twice in one request (two actor groups),
  // emit only the first. The second would fail the TxApplyIf notMatch
  // predicate at apply time, but suppressing it here avoids a wasted
  // sequence allocation and keeps the emitted tx list clean.
  const pendingCreates = new Set<string>()

  for (const actualTx of sorted) {
    if (actualTx._class !== core.class.TxUpdateDoc) continue
    // Skip derived writes to bound mirror cascades to one hop.
    if (actualTx.space === core.space.DerivedTx) continue
    const updateTx = actualTx as TxUpdateDoc<Issue>
    if (!control.hierarchy.isDerived(updateTx.objectClass, tracker.class.Issue)) continue

    const newStatus = updateTx.operations.status
    if (newStatus == null) continue

    const [source] = await control.findAll(control.ctx, tracker.class.Issue, { _id: updateTx.objectId }, { limit: 1 })
    if (source === undefined) continue

    const rules = (await control.findAll(control.ctx, workflowRules.class.WorkflowRule, {
      space: source.space,
      enabled: true
    })) as unknown as WorkflowRule[]
    if (rules.length === 0) continue

    for (const rule of rules) {
      if (!isValidRule(rule)) {
        control.ctx.warn('[workflow-rules] invalid rule skipped', { ruleId: rule._id })
        continue
      }

      const counterpart = await resolveCounterpart(control, source, rule)

      if (counterpart === undefined) {
        // Auto-create path. Emit a TxCreateDoc<Issue> in the linked project
        // when the rule asks for it and all preconditions pass. tryEmitAutoCreate
        // fails closed: a missing TaskType, unmapped status, refused target, or
        // failed sequence allocation each log at info/warn and drop the create.
        if (rule.autoCreate != null && Array.isArray(rule.autoCreate.triggerStatuses)) {
          if (rule.autoCreate.triggerStatuses.includes(newStatus)) {
            const autoTxes = await tryEmitAutoCreate(
              control,
              source,
              rule,
              newStatus,
              updateTx,
              targetSpaceAuthz,
              pendingCreates
            )
            for (const t of autoTxes) {
              result.push(t)
            }
          }
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

      const regressed = await checkRegressionGuard(control, counterpart, effectiveStatus, target, rule)
      if (regressed) {
        control.ctx.info('[workflow-rules] mirror suppressed by regression guard', {
          ruleId: rule._id,
          source: source._id,
          counterpart: counterpart._id,
          from: effectiveStatus,
          to: target
        })
        continue
      }

      const authorized = await isAuthorizedForTarget(control, updateTx.modifiedBy, counterpart.space, targetSpaceAuthz)
      if (!authorized) {
        control.ctx.warn('[workflow-rules] mirror suppressed: actor not authorized on target project', {
          ruleId: rule._id,
          source: source._id,
          counterpart: counterpart._id,
          targetSpace: counterpart.space,
          modifiedBy: updateTx.modifiedBy
        })
        continue
      }

      // Wrap the derived update in TxApplyIf so a concurrent request
      // that advanced the counterpart since our read fails the match
      // and drops the stale derived update instead of applying a
      // regression against someone else's write. The match is strict
      // identity + live status: a concurrent move anywhere else does
      // not race us out of a legal mirror. A match failure is a drop,
      // not a failure, so the pipeline treats the emitted tx as a
      // no-op. The pending-status map within one request already
      // covers the same-request case; this wrapper only handles the
      // cross-request race.
      const update = control.txFactory.createTxUpdateDoc(
        counterpart._class,
        counterpart.space,
        counterpart._id,
        { status: target },
        false,
        updateTx.modifiedOn,
        updateTx.modifiedBy
      ) as unknown as TxCUD<Doc>
      // Mark the inner update as DerivedTx explicitly so the cascade guard
      // catches it when it circles back to the trigger, regardless of
      // whether the pipeline's DerivedEntry wrapping covers the inner txes
      // of a TxApplyIf. Belt-and-braces: if the pipeline already marks it,
      // the second assignment is a no-op; if it does not, the explicit
      // space is what prevents a cascade.
      ;(update as unknown as { space: unknown }).space = core.space.DerivedTx
      const match: DocumentClassQuery<Doc>[] = [
        {
          _class: counterpart._class,
          query: { _id: counterpart._id, status: effectiveStatus }
        }
      ]
      // `scope` MUST be non-null: ApplyTxMiddleware.verifyApplyIf is
      // only run when scope is set (see applyTx.ts). A null scope
      // skips predicate evaluation entirely and the stale mirror
      // would apply. The scope key is per-target so parallel updates
      // to DIFFERENT targets are not serialized, but parallel updates
      // to the SAME target are serialized at the apply stage and the
      // stale write is rejected by the match predicate.
      const applyIf = control.txFactory.createTxApplyIf(
        counterpart.space,
        `workflow-rules.mirror:${counterpart._id}`,
        match,
        [],
        [update],
        'workflow-rules.mirror',
        true,
        [],
        updateTx.modifiedOn,
        updateTx.modifiedBy
      )
      result.push(applyIf)
      pendingStatuses.set(counterpart._id, target)
    }
  }
  processed.add(control.txes)
  return result
}

/**
 * Returns true only if the Workflow Rules plugin is explicitly enabled
 * in the workspace. The Settings > Configure toggle writes a
 * `PluginConfiguration` doc with `pluginId = workflowRulesId`; the model
 * also creates one at model-build time, so a healthy workspace always
 * has exactly one row for this plugin.
 *
 * Fails closed. Returns `false` unless the lookup finds exactly one row
 * for this plugin and that row's `enabled` is strictly `true`. Zero
 * rows, more than one row, any row where `enabled !== true`, malformed
 * data, or a lookup error all return `false` and the trigger emits
 * nothing. The feature ships disabled in `models/all` and a workspace
 * Owner has to opt in via Configure.
 */
function isPluginEnabled (control: TriggerControl): boolean {
  try {
    // Persisted model data can be malformed despite the declared schema.
    const configs = control.modelDb.findAllSync(core.class.PluginConfiguration, {
      pluginId: workflowRulesId
    }) as Array<{ enabled?: unknown }>
    if (configs.length !== 1) return false
    return configs[0].enabled === true
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
 * Target-first order. The target space is looked up before any actor
 * shortcut, so these refusals apply to every caller including the system
 * account and workspace admins:
 *  - target does not exist,
 *  - `archived === true` (nobody writes to an archived project),
 *  - `restricted === true` on a `TypedSpace` (this trigger does not yet
 *    evaluate role grants or forbids; a restricted target is refused
 *    until the full permission pipeline integration lands in the
 *    follow-up PR).
 *
 * Actor-level allowance (only reached after the target checks pass):
 *  - `tx.modifiedBy === core.account.System` (server-side writes,
 *    integrations). This is checked explicitly because the session map
 *    skips system sessions.
 *  - After resolving the acting account from `socialStringsToUsers`:
 *    - the role must be `AccountRole.User` or higher. Guest-class roles
 *      (`Guest`, `DocGuest`, `ReadOnlyGuest`) are refused outright
 *      because `GuestPermissionsMiddleware` only allows them to mutate
 *      their own docs, and the derived mirror-target update is NOT a
 *      doc the guest created. Rather than partially replicate the
 *      guest own-doc model + the `ModulePermissionGroup` role-forbid
 *      consultation here (both of which only matter for Guest-class
 *      roles), the trigger refuses every below-User role until the full
 *      guest-permission integration lands in a follow-up PR;
 *    - AND either the role is `AccountRole.Admin` or higher, OR the
 *      account is a member or owner of the target space.
 *
 * Fails closed when a non-system acting account cannot be resolved from
 * the social id. Results are memoized by `actor + space`; the target
 * lookup is memoized by `space` so a batch of transactions on one source
 * does not re-fetch the same Space document per rule.
 *
 * The member/owner check is deliberately a strict first step. For a
 * public Space a non-member could normally write; this trigger still
 * refuses because the actor is not in the target's membership list.
 * Full permission-pipeline integration (role grants, forbids on
 * unrestricted projects, guest-own-doc semantics, non-member writes to
 * public spaces) is a follow-up tracked alongside the dedicated
 * rule-management permission.
 */
async function isAuthorizedForTarget (
  control: TriggerControl,
  modifiedBy: PersonId,
  targetSpace: Ref<Space>,
  cache: Map<string, boolean>
): Promise<boolean> {
  // Target-first checks. Any caller - system, admin, or ordinary user -
  // is refused if the target doesn't exist, is archived, or is a
  // restricted TypedSpace that this trigger isn't yet equipped to
  // authorize fully. Cache by space so the lookup only runs once per
  // target per request.
  const targetKey = `__space:${targetSpace}`
  const cachedTarget = cache.get(targetKey)
  if (cachedTarget === false) return false
  if (cachedTarget === undefined) {
    const [target] = await control.findAll(
      control.ctx,
      tracker.class.Project,
      { _id: targetSpace as Ref<Project> },
      { limit: 1 }
    )
    // Compare as unknown so lint autofixes cannot loosen the strict checks.
    const flags = target as unknown as { archived?: unknown, restricted?: unknown } | undefined
    const targetOk = target !== undefined && flags?.archived !== true && flags?.restricted !== true
    cache.set(targetKey, targetOk)
    if (!targetOk) return false
  }

  // Fetch target details for the member/owner check. One extra findAll
  // in the uncached-member path is tolerable; the cache key above guards
  // against re-querying for every rule within one request.
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
  // Refuse guest-class roles outright. `GuestPermissionsMiddleware`
  // would normally refuse a Guest writing to a doc they did not
  // create, and the derived mirror would bypass that middleware. Rule
  // "refuse the unsupported case": the follow-up PR lands the full
  // guest-permission integration before this gate relaxes.
  if (roleOrder[resolved.role] < roleOrder[AccountRole.User]) {
    cache.set(cacheKey, false)
    return false
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
          _id: source.attachedTo,
          space: rule.linkedProject
        },
        { limit: 1 }
      )
      return found
    }
    default: {
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
  const [tt] = await control.findAll(control.ctx, task.class.TaskType, { _id: counterpart.kind }, { limit: 1 })
  if (tt === undefined || !Array.isArray(tt.statuses)) return true

  const statuses: Array<Ref<IssueStatus>> = tt.statuses
  if (!statuses.includes(effectiveFrom) || !statuses.includes(target)) return true
  if (!Array.isArray(rule.allowedLoops)) return true
  for (const loop of rule.allowedLoops) {
    if (loop == null || typeof loop.from !== 'string' || typeof loop.to !== 'string') return true
  }

  return isRegression(effectiveFrom, target, statuses, rule.allowedLoops)
}

/**
 * Closed set of fields `autoCreate.inherit` may contain. The persisted list is
 * validated against this set per invocation so a stored rule with an unknown
 * field name does not silently copy an arbitrary attribute onto the new
 * counterpart.
 *
 * @public
 */
export const INHERIT_FIELDS: ReadonlySet<WorkflowRuleInheritField> = new Set<WorkflowRuleInheritField>([
  'title',
  'description',
  'priority',
  'dueDate',
  'milestone',
  'assignee'
])

/**
 * Resolve the TaskType the auto-created counterpart should use. Picks the
 * first TaskType on the target project's ProjectType whose descriptor is
 * `tracker.descriptors.Issue`. Returns undefined when any precondition
 * fails: missing/malformed Project, missing/malformed ProjectType, no
 * eligible TaskType, or a TaskType without a valid `statuses` array.
 *
 * `limit: 2` on the Project and ProjectType lookups treats "more than one
 * row" as a malformed state and refuses, matching rule #6 of the
 * contribution guide.
 *
 * @public
 */
export async function resolveTargetTaskType (
  control: TriggerControl,
  projectId: Ref<Project>
): Promise<{ project: Project, taskType: TaskType } | undefined> {
  const projects = await control.findAll(control.ctx, tracker.class.Project, { _id: projectId }, { limit: 2 })
  if (projects.length !== 1) return undefined
  const project = projects[0]
  if (typeof project.identifier !== 'string' || project.identifier.length === 0) return undefined
  if (typeof project.sequence !== 'number' || !Number.isFinite(project.sequence)) return undefined
  if (typeof project.type !== 'string' || project.type.length === 0) return undefined

  const types = await control.findAll(control.ctx, task.class.ProjectType, { _id: project.type }, { limit: 2 })
  if (types.length !== 1) return undefined
  const projectType = types[0] as ProjectType
  if (!Array.isArray(projectType.tasks) || projectType.tasks.length === 0) return undefined

  const taskTypeIds = projectType.tasks.filter((it) => typeof it === 'string' && it.length > 0)
  if (taskTypeIds.length === 0) return undefined

  const taskTypes = (await control.findAll(control.ctx, task.class.TaskType, {
    _id: { $in: taskTypeIds }
  })) as unknown as TaskType[]
  const issueTaskType = taskTypes.find(
    (tt) => tt.descriptor === tracker.descriptors.Issue && Array.isArray(tt.statuses)
  )
  if (issueTaskType === undefined) return undefined
  if (!Array.isArray(issueTaskType.statuses) || issueTaskType.statuses.length === 0) return undefined

  return { project, taskType: issueTaskType }
}

/**
 * Atomically allocate the next issue sequence for `project`. Emits a
 * `TxUpdateDoc<Project>` with `$inc: { sequence: 1 }` and `retrieve: true`
 * via `control.apply`, then reads the post-update sequence from the
 * returned TxResult.
 *
 * Returns undefined on any failure: the storage adapter refused the apply,
 * the TxResult did not carry the expected `{ object: { sequence } }`
 * shape, or the returned value is not a positive finite integer. A failed
 * allocation drops the auto-create rather than emitting a half-formed
 * TxCreateDoc without a valid identifier.
 *
 * Note: a successful allocation whose downstream TxApplyIf notMatch
 * predicate later fails (concurrent counterpart appeared) burns the
 * sequence - the project's numbering will skip that number. This matches
 * the normal CreateIssue UI flow where the client increments sequence
 * before the commit may fail, and keeps the increment ordering strictly
 * monotonic under concurrency.
 *
 * @public
 */
export async function allocateNextSequence (
  control: TriggerControl,
  project: Project,
  modifiedBy: PersonId,
  modifiedOn: number
): Promise<number | undefined> {
  const incTx = control.txFactory.createTxUpdateDoc<Project>(
    tracker.class.Project,
    core.space.Space,
    project._id,
    { $inc: { sequence: 1 } },
    true,
    modifiedOn,
    modifiedBy
  )
  try {
    const res = (await control.apply(control.ctx, [incTx], true)) as unknown
    const first: TxResult | undefined = Array.isArray(res) ? (res[0] as TxResult) : (res as TxResult)
    const obj = (first as unknown as { object?: { sequence?: unknown } } | undefined)?.object
    const seq = obj?.sequence
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq <= 0 || !Number.isInteger(seq)) {
      control.ctx.warn('[workflow-rules] auto-create sequence allocation returned invalid value', {
        projectId: project._id,
        sequence: seq
      })
      return undefined
    }
    return seq
  } catch (e) {
    control.ctx.warn('[workflow-rules] auto-create sequence allocation failed', {
      projectId: project._id,
      error: String(e)
    })
    return undefined
  }
}

/**
 * Resolve the component for the new counterpart under `rule.autoCreate`.
 *
 * Returns `{ skip: true }` when `componentMap` explicitly maps the source
 * component to `null` (the author chose "do not auto-create for issues
 * with this component"). Returns `{ skip: false, component }` with the
 * mapped value, the `defaultComponent` fallback, or `null` when neither
 * applies. Uses `hasOwnProperty` for the map lookup so prototype-chain
 * keys (`constructor`, `__proto__`) cannot resolve to a non-Ref value.
 *
 * @public
 */
export function resolveAutoCreateComponent (
  rule: WorkflowRule,
  source: Issue
): { skip: boolean, component: Ref<Component> | null } {
  const autoCreate = rule.autoCreate
  if (autoCreate == null) {
    return { skip: false, component: null }
  }
  const map = autoCreate.componentMap
  const defaultComponent = typeof autoCreate.defaultComponent === 'string' ? autoCreate.defaultComponent : null
  const sourceComponent = source.component
  if (sourceComponent == null) {
    return { skip: false, component: defaultComponent ?? null }
  }
  if (map != null && typeof map === 'object' && !Array.isArray(map)) {
    if (Object.prototype.hasOwnProperty.call(map, sourceComponent)) {
      const mapped = (map as Record<string, unknown>)[sourceComponent]
      if (mapped === null) {
        return { skip: true, component: null }
      }
      if (typeof mapped === 'string' && mapped.length > 0) {
        return { skip: false, component: mapped as Ref<Component> }
      }
      // Malformed value: fall through to default.
    }
  }
  return { skip: false, component: defaultComponent ?? null }
}

/**
 * Build the subset of Issue attributes inherited from the source according to
 * `rule.autoCreate.inherit`. Each inheritable field is validated at runtime:
 * the stored inherit list may contain names not in the closed set, and even
 * valid names skip their field when the source value is malformed or the
 * target reference cannot be verified in the destination project.
 *
 * `milestone`: verified by querying `tracker.class.Milestone` in the target
 * project. If the milestone does not exist in the target project, the field
 * is skipped with a warn. Milestones are per-project so copying the source's
 * milestone id unconditionally would produce a dangling reference.
 *
 * `assignee`: verified by querying `contact.mixin.Employee` with
 * `active: true`. A deactivated or missing employee is skipped with a warn
 * rather than copied.
 *
 * @public
 */
export async function resolveInheritedFields (
  control: TriggerControl,
  rule: WorkflowRule,
  source: Issue
): Promise<Partial<Data<Issue>>> {
  const out: Partial<Data<Issue>> = {}
  const autoCreate = rule.autoCreate
  if (autoCreate == null || !Array.isArray(autoCreate.inherit)) return out
  for (const nameRaw of autoCreate.inherit) {
    if (typeof nameRaw !== 'string') continue
    if (!INHERIT_FIELDS.has(nameRaw)) continue
    const name = nameRaw
    switch (name) {
      case 'title': {
        if (typeof source.title === 'string' && source.title.length > 0) {
          out.title = source.title
        }
        break
      }
      case 'description': {
        // Blob refs are strings; null is also a valid persisted value.
        if (source.description === null) {
          out.description = null
        } else if (typeof source.description === 'string') {
          out.description = source.description
        }
        break
      }
      case 'priority': {
        const p = source.priority as unknown
        if (typeof p === 'number' && Number.isFinite(p)) {
          out.priority = p
        }
        break
      }
      case 'dueDate': {
        const d = source.dueDate as unknown
        if (d === null || (typeof d === 'number' && Number.isFinite(d))) {
          out.dueDate = d
        }
        break
      }
      case 'milestone': {
        if (source.milestone == null) {
          out.milestone = null
          break
        }
        const found = await control.findAll(
          control.ctx,
          tracker.class.Milestone,
          { _id: source.milestone, space: rule.linkedProject },
          { limit: 2 }
        )
        if (found.length === 1) {
          out.milestone = source.milestone
        } else {
          control.ctx.warn('[workflow-rules] auto-create skipped milestone inherit: ref not in target project', {
            ruleId: rule._id,
            sourceIssue: source._id,
            milestone: source.milestone,
            targetProject: rule.linkedProject,
            found: found.length
          })
        }
        break
      }
      case 'assignee': {
        if (source.assignee == null) {
          out.assignee = null
          break
        }
        // Task.assignee is Ref<Person>; Employee is a mixin on Person, so
        // the ref values are identical at the storage layer. The cast
        // tells the type system about that identity; the runtime query
        // naturally returns zero rows when the person does not have the
        // Employee mixin applied, which is handled below.
        const found = await control.findAll(
          control.ctx,
          contact.mixin.Employee,
          { _id: source.assignee as Ref<Employee>, active: true },
          { limit: 2 }
        )
        if (found.length === 1) {
          out.assignee = source.assignee
        } else {
          control.ctx.warn('[workflow-rules] auto-create skipped assignee inherit: employee not found/active', {
            ruleId: rule._id,
            sourceIssue: source._id,
            assignee: source.assignee,
            found: found.length
          })
        }
        break
      }
    }
  }
  return out
}

/**
 * Emit the tx sequence that creates a counterpart under `rule.autoCreate`
 * for a source issue whose status just entered one of `triggerStatuses`.
 *
 * Returns an empty array when any precondition refuses the create:
 *  - `rule.autoCreate.triggerStatuses` or `rule.forwardMap` does not map
 *    `newStatus`, or the mapped target is malformed (prototype-pollution
 *    safe via `hasOwnProperty`).
 *  - the caller is not authorized to write to `rule.linkedProject` per
 *    `isAuthorizedForTarget` (target-level deny conditions apply first).
 *  - target TaskType cannot be resolved via `resolveTargetTaskType`.
 *  - `componentMap[source.component]` is explicitly `null` (author-opted-out
 *    for this source component).
 *  - sequence allocation via `allocateNextSequence` returns undefined.
 *  - the same `(source, rule)` pair already emitted an auto-create in this
 *    request (per-request `pendingCreates` guard; the TxApplyIf notMatch
 *    predicate also catches this case at apply time).
 *  - `rule.linkKind === 'parentIssue'` and `source.attachedTo` already
 *    points at a real parent (overwriting it would be destructive).
 *
 * The emitted `TxCreateDoc<Issue>` is wrapped in a `TxApplyIf` whose
 * `notMatch` predicate rejects the apply when a counterpart has appeared
 * in `linkedProject` since this trigger's read. Scope is
 * `workflow-rules.auto-create:${source._id}:${rule._id}` so the
 * `ApplyTxMiddleware.verifyApplyIf` serializes parallel auto-creates on
 * the same source + rule through its `scopes` Promise map.
 *
 * The create tx is emitted with `space = core.space.DerivedTx` so a
 * status-update trigger that fires on the newly created counterpart's
 * status (or any later status change the auto-create seeds) hits the
 * existing one-hop cascade guard and does not re-enter this trigger.
 *
 * @public
 */
export async function tryEmitAutoCreate (
  control: TriggerControl,
  source: Issue,
  rule: WorkflowRule,
  newStatus: Ref<IssueStatus>,
  sourceTx: TxUpdateDoc<Issue>,
  authzCache: Map<string, boolean>,
  pendingCreates: Set<string>
): Promise<Tx[]> {
  const autoCreate = rule.autoCreate
  if (autoCreate == null) return []
  if (!Array.isArray(autoCreate.triggerStatuses) || !autoCreate.triggerStatuses.includes(newStatus)) return []

  // Status must still go through forwardMap. The auto-create section does
  // not authorize creating a counterpart with an unmapped status.
  const forwardMap = rule.forwardMap
  if (forwardMap == null || typeof forwardMap !== 'object' || Array.isArray(forwardMap)) return []
  if (!Object.prototype.hasOwnProperty.call(forwardMap, newStatus)) return []
  const targetStatus = (forwardMap as Record<string, unknown>)[newStatus]
  if (typeof targetStatus !== 'string' || targetStatus.length === 0) return []

  // Per-request duplicate guard.
  const pendingKey = `${source._id}:${rule._id}`
  if (pendingCreates.has(pendingKey)) {
    control.ctx.info('[workflow-rules] auto-create suppressed: already queued this request', {
      ruleId: rule._id,
      sourceIssue: source._id
    })
    return []
  }

  // Target-side authz. Target-level deny conditions (missing, archived,
  // restricted) apply first inside the helper and refuse every caller.
  const authorized = await isAuthorizedForTarget(control, sourceTx.modifiedBy, rule.linkedProject, authzCache)
  if (!authorized) {
    control.ctx.warn('[workflow-rules] auto-create suppressed: actor not authorized on target project', {
      ruleId: rule._id,
      sourceIssue: source._id,
      targetSpace: rule.linkedProject,
      modifiedBy: sourceTx.modifiedBy
    })
    return []
  }

  // Resolve TaskType on the target project. Fails closed on any shape issue.
  const resolved = await resolveTargetTaskType(control, rule.linkedProject)
  if (resolved === undefined) {
    control.ctx.warn('[workflow-rules] auto-create suppressed: target TaskType unresolved', {
      ruleId: rule._id,
      sourceIssue: source._id,
      targetProject: rule.linkedProject
    })
    return []
  }
  const { project, taskType } = resolved

  // The resolved status must live in the target TaskType's status list so the
  // new issue does not open in a status unknown to its own TaskType.
  if (!taskType.statuses.includes(targetStatus as Ref<IssueStatus>)) {
    control.ctx.warn('[workflow-rules] auto-create suppressed: target status not in TaskType', {
      ruleId: rule._id,
      sourceIssue: source._id,
      targetStatus,
      taskType: taskType._id
    })
    return []
  }

  // Component mapping.
  const componentDecision = resolveAutoCreateComponent(rule, source)
  if (componentDecision.skip) {
    control.ctx.info('[workflow-rules] auto-create skipped by componentMap=null for source component', {
      ruleId: rule._id,
      sourceIssue: source._id,
      sourceComponent: source.component
    })
    return []
  }

  // linkKind-specific preconditions and attachment shape.
  let attachedTo: Ref<Issue>
  let counterpartParents: IssueParentInfo[] = []
  let sourceUpdateTx: TxUpdateDoc<Issue> | undefined
  const newId = generateId<Issue>()
  if (rule.linkKind === 'subIssue') {
    attachedTo = source._id
    // The new counterpart is a child of source; its parent chain is the
    // source plus the source's existing parents.
    const srcParents = Array.isArray(source.parents) ? source.parents : []
    counterpartParents = [
      {
        parentId: source._id,
        parentTitle: typeof source.title === 'string' ? source.title : '',
        space: source.space,
        identifier: typeof source.identifier === 'string' ? source.identifier : ''
      },
      ...srcParents
    ]
  } else if (rule.linkKind === 'parentIssue') {
    if (source.attachedTo != null && source.attachedTo !== tracker.ids.NoParent) {
      control.ctx.warn('[workflow-rules] auto-create suppressed: parentIssue would overwrite existing parent', {
        ruleId: rule._id,
        sourceIssue: source._id,
        existingParent: source.attachedTo
      })
      return []
    }
    attachedTo = tracker.ids.NoParent
    // The source-update tx that reattaches the source as a sub-issue of the
    // new counterpart is built below, after `defaultTitle` and `identifier`
    // are known. The entry prepended to source.parents MUST describe the
    // counterpart (its title and identifier), not the source itself; the
    // parent presenter uses it for the link label and target.
  } else {
    // Unknown linkKind; isValidRule should have refused, but fail closed.
    return []
  }

  // Inherited fields.
  const inherited = await resolveInheritedFields(control, rule, source)

  // Sequence allocation. Done last so a preceding refusal does not burn a
  // project sequence number.
  const number = await allocateNextSequence(control, project, sourceTx.modifiedBy, sourceTx.modifiedOn)
  if (number === undefined) return []
  const identifier = `${project.identifier}-${number}`

  // Compose attributes. Defaults match CreateIssue.svelte's DocData<Issue>.
  const defaultTitle =
    typeof inherited.title === 'string' && inherited.title.length > 0
      ? inherited.title
      : `${project.identifier} auto-created`

  // Build the source-update tx for the parentIssue linkKind now that the new
  // counterpart's title (`defaultTitle`) and identifier are known. The entry
  // prepended to source.parents MUST describe the counterpart, not the
  // source; the parent presenter uses it for the link label and target.
  if (rule.linkKind === 'parentIssue') {
    const nextParents: IssueParentInfo[] = [
      {
        parentId: newId,
        parentTitle: defaultTitle,
        space: rule.linkedProject,
        identifier
      },
      ...(Array.isArray(source.parents) ? source.parents : [])
    ]
    sourceUpdateTx = control.txFactory.createTxUpdateDoc(
      tracker.class.Issue,
      source.space,
      source._id,
      {
        attachedTo: newId,
        attachedToClass: tracker.class.Issue,
        collection: 'subIssues',
        parents: nextParents
      },
      false,
      sourceTx.modifiedOn,
      sourceTx.modifiedBy
    )
    // Mark the source update as derived (invariant: every tx we emit is
    // DerivedTx). The source update here does not change status, so the
    // cascade guard would not fire anyway; the mark keeps the invariant
    // visible.
    ;(sourceUpdateTx as unknown as { space: unknown }).space = core.space.DerivedTx
  }

  const attrs: Data<Issue> = {
    attachedTo,
    attachedToClass: tracker.class.Issue,
    collection: rule.linkKind === 'subIssue' ? 'subIssues' : 'subIssues',
    title: defaultTitle,
    description: inherited.description !== undefined ? inherited.description : null,
    status: targetStatus as Ref<IssueStatus>,
    priority: typeof inherited.priority === 'number' ? inherited.priority : IssuePriority.NoPriority,
    assignee: inherited.assignee !== undefined ? inherited.assignee : null,
    component: componentDecision.component,
    milestone: inherited.milestone !== undefined ? inherited.milestone : null,
    dueDate: inherited.dueDate !== undefined ? inherited.dueDate : null,
    startDate: null,
    subIssues: 0,
    parents: counterpartParents,
    reportedTime: 0,
    remainingTime: 0,
    estimation: 0,
    reports: 0,
    childInfo: [],
    kind: taskType._id,
    number,
    identifier,
    rank: ''
  }

  const createTx = control.txFactory.createTxCreateDoc<Issue>(
    tracker.class.Issue,
    rule.linkedProject,
    attrs,
    newId,
    sourceTx.modifiedOn,
    sourceTx.modifiedBy
  )
  // Mark the create as derived explicitly (txFactory is already in derived
  // mode in the server path, but keep the invariant visible to readers).
  ;(createTx as unknown as { space: unknown }).space = core.space.DerivedTx

  // notMatch: no counterpart exists under this rule's linkKind resolution in
  // `linkedProject`. The predicate rejects the apply when a parallel request
  // created a counterpart since this trigger read.
  const notMatch: DocumentClassQuery<Doc>[] = []
  if (rule.linkKind === 'subIssue') {
    notMatch.push({
      _class: tracker.class.Issue,
      query: {
        attachedTo: source._id,
        attachedToClass: tracker.class.Issue,
        collection: 'subIssues',
        space: rule.linkedProject
      }
    })
  } else {
    // parentIssue: the predicate is "source still has no parent in the
    // linked project". The apply is refused if source's attachedTo has
    // been updated by a concurrent request.
    notMatch.push({
      _class: tracker.class.Issue,
      query: {
        _id: source._id,
        attachedTo: { $ne: tracker.ids.NoParent }
      }
    })
  }

  const innerTxes: TxCUD<Doc>[] = [createTx]
  if (sourceUpdateTx !== undefined) {
    innerTxes.push(sourceUpdateTx)
  }

  const applyIf: TxApplyIf = control.txFactory.createTxApplyIf(
    rule.linkedProject,
    `workflow-rules.auto-create:${source._id}:${rule._id}`,
    [],
    notMatch,
    innerTxes,
    'workflow-rules.auto-create',
    true,
    [],
    sourceTx.modifiedOn,
    sourceTx.modifiedBy
  )

  pendingCreates.add(pendingKey)

  return [applyIf]
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    OnWorkflowRuleMirror
  }
})
