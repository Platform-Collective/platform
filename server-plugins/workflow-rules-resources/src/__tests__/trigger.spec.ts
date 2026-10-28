// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Trigger-level tests for OnWorkflowRuleMirror. Validates the behavior
// Michael flagged in the review: derived-tx skip, isValidRule shape
// enforcement, own-property forwardMap lookup, missing TaskType and
// ambiguous child counterpart as absence, batch pending-status map across
// multiple rules and multiple source transactions, target-side
// authorization gate, and PluginConfiguration kill switch.

import core, { AccountRole, type AccountUuid, type Ref } from '@hcengineering/core'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'
import workflowRules, { workflowRulesId } from '@hcengineering/workflow-rules'

import { OnWorkflowRuleMirror as _OnWorkflowRuleMirror, isValidRule } from '../index'

// Cast once so each test can pass plain fixture objects as Tx[].
const OnWorkflowRuleMirror = _OnWorkflowRuleMirror as unknown as (txes: any[], control: any) => Promise<any[]>

type Any = Record<string, any>

const S = {
  backlog: 'status:backlog',
  todo: 'status:todo',
  inProgress: 'status:in-progress',
  review: 'status:review',
  done: 'status:done'
}

const PROJ_A = 'proj:a'
const PROJ_B = 'proj:b'

const ACC_ADMIN = 'acc-admin' as AccountUuid
const ACC_MEMBER = 'acc-member' as AccountUuid
const ACC_OUTSIDER = 'acc-outsider' as AccountUuid

const SOC_ADMIN = 'social:admin'
const SOC_MEMBER = 'social:member'
const SOC_OUTSIDER = 'social:outsider'

function issue (over: Any = {}): Any {
  return {
    _id: 'issue:default',
    _class: tracker.class.Issue,
    space: PROJ_A,
    kind: 'task-type:a',
    status: S.backlog,
    attachedTo: undefined,
    attachedToClass: tracker.class.Issue,
    collection: 'subIssues',
    ...over
  }
}

function updateTx (newStatus: string, over: Any = {}): Any {
  return {
    _class: core.class.TxUpdateDoc,
    space: core.space.Tx,
    objectId: 'issue:a1',
    objectClass: tracker.class.Issue,
    modifiedBy: SOC_MEMBER,
    modifiedOn: 1000,
    operations: { status: newStatus },
    ...over
  }
}

function rule (over: Any = {}): Any {
  return {
    _id: 'rule:a-to-b',
    _class: workflowRules.class.WorkflowRule,
    space: PROJ_A,
    linkedProject: PROJ_B,
    linkKind: 'subIssue',
    forwardMap: { [S.inProgress]: S.inProgress, [S.review]: S.done },
    allowedLoops: [],
    enabled: true,
    ...over
  }
}

function project (over: Any = {}): Any {
  return {
    _id: PROJ_B,
    _class: tracker.class.Project,
    members: [ACC_MEMBER],
    owners: [],
    ...over
  }
}

/** Compact helper for the common "parent in A + child in B linked to it" fixture. */
function linkedPair (childOver: Any = {}): Any[] {
  return [
    issue({ _id: 'issue:a1' }),
    issue({ _id: 'issue:b1', space: PROJ_B, attachedTo: 'issue:a1', ...childOver })
  ]
}

function matches (value: unknown, criteria: any): boolean {
  if (criteria !== null && typeof criteria === 'object') {
    if (Array.isArray(criteria.$in)) return criteria.$in.includes(value)
    return false
  }
  return value === criteria
}

interface WorldOptions {
  issues?: Any[]
  rules?: Any[]
  projects?: Any[]
  taskTypes?: Any[]
  pluginEnabled?: boolean
  authAccount?: AccountUuid
  authRole?: AccountRole
  modifiedBySocial?: string
}

function makeControl (opts: WorldOptions = {}): any {
  const issues = opts.issues ?? []
  const rulesList = opts.rules ?? []
  const projects = opts.projects ?? [project()]
  const taskTypes = opts.taskTypes ?? [
    { _id: 'task-type:a', _class: task.class.TaskType, statuses: [S.backlog, S.todo, S.inProgress, S.review, S.done] },
    { _id: 'task-type:b', _class: task.class.TaskType, statuses: [S.backlog, S.todo, S.inProgress, S.review, S.done] }
  ]
  const configs = opts.pluginEnabled === false
    ? [{ _id: 'pc:1', _class: core.class.PluginConfiguration, pluginId: workflowRulesId, enabled: false }]
    : []

  const socialStringsToUsers = new Map<string, { accontUuid: AccountUuid, role: AccountRole }>()
  socialStringsToUsers.set(SOC_ADMIN, { accontUuid: ACC_ADMIN, role: AccountRole.Admin })
  socialStringsToUsers.set(SOC_MEMBER, { accontUuid: ACC_MEMBER, role: AccountRole.User })
  socialStringsToUsers.set(SOC_OUTSIDER, { accontUuid: ACC_OUTSIDER, role: AccountRole.User })

  const findAll = jest.fn(async (_ctx: unknown, _class: Ref<any>, q: any, _o?: any) => {
    if (_class === tracker.class.Issue) {
      return issues.filter((i) => {
        if (q._id !== undefined && !matches(i._id, q._id)) return false
        if (q.space !== undefined && !matches(i.space, q.space)) return false
        if (q.attachedTo !== undefined && !matches(i.attachedTo, q.attachedTo)) return false
        if (q.attachedToClass !== undefined && !matches(i.attachedToClass, q.attachedToClass)) return false
        if (q.collection !== undefined && !matches(i.collection, q.collection)) return false
        return true
      })
    }
    if (_class === workflowRules.class.WorkflowRule) {
      return rulesList.filter((r) =>
        (q.space === undefined || matches(r.space, q.space)) &&
        (q.enabled === undefined || r.enabled === q.enabled)
      )
    }
    if (_class === tracker.class.Project) {
      return projects.filter((p) => q._id === undefined || matches(p._id, q._id))
    }
    if (_class === task.class.TaskType) {
      return taskTypes.filter((t) => q._id === undefined || matches(t._id, q._id))
    }
    return []
  })

  const modelDb = {
    findAllSync: (cls: Ref<any>, q: any): any[] => {
      if (cls === core.class.PluginConfiguration) {
        return configs.filter((c) => q.pluginId === undefined || c.pluginId === q.pluginId)
      }
      return []
    }
  }

  const txFactory = {
    createTxUpdateDoc: (
      _cls: any,
      space: any,
      objectId: any,
      operations: any,
      _retrieve: boolean,
      modifiedOn: number
    ): any => ({
      _class: core.class.TxUpdateDoc,
      space: core.space.DerivedTx,
      objectClass: _cls,
      objectSpace: space,
      objectId,
      operations,
      modifiedOn
    })
  }

  const hierarchy = {
    isDerived: (child: any, base: any): boolean => child === base || child === tracker.class.Issue
  }

  const ctx: any = {
    contextData: { socialStringsToUsers },
    warn: jest.fn(),
    info: jest.fn()
  }

  return { ctx, findAll, modelDb, txFactory, hierarchy }
}

describe('OnWorkflowRuleMirror', () => {
  it('mirrors a status change to the counterpart on the linked project', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)

    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      objectId: 'issue:b1',
      operations: { status: S.done }
    })
  })

  it('skips updates whose own space is DerivedTx so a mirror cannot cascade', async () => {
    const control = makeControl({ issues: linkedPair(), rules: [rule()] })

    const derived = updateTx(S.review, { space: core.space.DerivedTx })
    const res = await OnWorkflowRuleMirror([derived], control)

    expect(res).toHaveLength(0)
  })

  it('skips a rule whose stored shape is malformed and keeps processing the rest', async () => {
    const bad = rule({ _id: 'rule:bad', forwardMap: null as any })
    const good = rule({ _id: 'rule:good', forwardMap: { [S.review]: S.done } })
    const control = makeControl({ issues: linkedPair(), rules: [bad, good] })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ operations: { status: S.done } })
  })

  it('ignores inherited forwardMap keys (prototype pollution guard)', async () => {
    const r = rule({ forwardMap: Object.create({ constructor: 'status:injected' }) })
    r.forwardMap[S.review] = S.done
    const control = makeControl({ issues: linkedPair(), rules: [r] })

    // A real tracker never emits status 'constructor', but if it did, the
    // trigger must not reach the inherited key and write 'status:injected'.
    const res = await OnWorkflowRuleMirror([updateTx('constructor' as any)], control)
    expect(res).toHaveLength(0)
  })

  it('refuses to mirror when the counterpart TaskType is unknown', async () => {
    const control = makeControl({
      issues: linkedPair({ kind: 'task-type:gone' }),
      rules: [rule()],
      taskTypes: [] // missing on purpose
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it('treats an ambiguous subIssue counterpart as absence', async () => {
    const control = makeControl({
      issues: [
        issue({ _id: 'issue:a1' }),
        issue({ _id: 'issue:b1', space: PROJ_B, attachedTo: 'issue:a1' }),
        issue({ _id: 'issue:b2', space: PROJ_B, attachedTo: 'issue:a1' })
      ],
      rules: [rule()]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it('allows a backward move only when it matches an allowedLoops entry', async () => {
    const r = rule({
      forwardMap: { [S.review]: S.inProgress },
      allowedLoops: [{ from: S.review, to: S.inProgress }]
    })
    const control = makeControl({
      issues: linkedPair({ status: S.review }),
      rules: [r]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ operations: { status: S.inProgress } })
  })

  it('blocks a backward move when no allowedLoops entry matches', async () => {
    const r = rule({ forwardMap: { [S.review]: S.inProgress } })
    const control = makeControl({
      issues: linkedPair({ status: S.review }),
      rules: [r]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it('pending map blocks a regression across two source transactions on one counterpart', async () => {
    // Two source transactions on the same source issue in one invocation,
    // the first maps the counterpart to Done, the second to InProgress.
    // Against the persisted Backlog both would pass. With the pending map,
    // the second read sees the queued Done and the backward move is blocked.
    const r1 = rule({ _id: 'rule:to-done', forwardMap: { [S.review]: S.done } })
    const r2 = rule({ _id: 'rule:to-ip', forwardMap: { [S.todo]: S.inProgress } })
    const control = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r1, r2]
    })

    const txA = updateTx(S.review, { modifiedOn: 1000 })
    const txB = updateTx(S.todo, { modifiedOn: 1001 })
    const res = await OnWorkflowRuleMirror([txA, txB], control)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ operations: { status: S.done } })
  })

  it('batches two rules on one source and pending map blocks the second regression', async () => {
    // Two rules both triggered by one source status change, mapping the
    // same counterpart to Done then to InProgress. Without the pending
    // map both read the stale Backlog and both pass. With it, the second
    // sees the queued Done and the InProgress move is blocked.
    const r1 = rule({ _id: 'rule:to-done', forwardMap: { [S.review]: S.done } })
    const r2 = rule({ _id: 'rule:to-ip', forwardMap: { [S.review]: S.inProgress } })
    const control = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r1, r2]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ operations: { status: S.done } })
  })

  it('fails closed when the acting account cannot be resolved', async () => {
    const control = makeControl({ issues: linkedPair(), rules: [rule()] })
    // 'social:ghost' is not in the socialStringsToUsers map.
    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: 'social:ghost' })], control)
    expect(res).toHaveLength(0)
  })

  it('allows a mirror authored by the system account even without a resolvable session', async () => {
    const control = makeControl({ issues: linkedPair(), rules: [rule()] })
    // core.account.System is not present in socialStringsToUsers; the
    // explicit modifiedBy check must allow this write anyway.
    const tx = updateTx(S.review, { modifiedBy: core.account.System })
    const res = await OnWorkflowRuleMirror([tx], control)
    expect(res).toHaveLength(1)
  })

  it('refuses to mirror when the acting user is not authorized on the target project', async () => {
    const control = makeControl({
      issues: [issue({ _id: 'issue:a1' }), issue({ _id: 'issue:b1', space: PROJ_B, attachedTo: 'issue:a1' })],
      rules: [rule()],
      projects: [project({ members: [], owners: [] })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: SOC_OUTSIDER })], control)
    expect(res).toHaveLength(0)
  })

  it('allows the mirror when the acting user is an Admin even without membership', async () => {
    const control = makeControl({
      issues: [issue({ _id: 'issue:a1' }), issue({ _id: 'issue:b1', space: PROJ_B, attachedTo: 'issue:a1' })],
      rules: [rule()],
      projects: [project({ members: [], owners: [] })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: SOC_ADMIN })], control)
    expect(res).toHaveLength(1)
  })

  it('is a no-op when the plugin is disabled via PluginConfiguration', async () => {
    const control = makeControl({
      issues: [issue({ _id: 'issue:a1' }), issue({ _id: 'issue:b1', space: PROJ_B, attachedTo: 'issue:a1' })],
      rules: [rule()],
      pluginEnabled: false
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })
})

describe('isValidRule', () => {
  it('accepts a well-formed rule', () => {
    expect(isValidRule(rule() as any)).toBe(true)
  })

  it('rejects unknown linkKind', () => {
    expect(isValidRule(rule({ linkKind: 'bogus' }) as any)).toBe(false)
  })

  it('rejects null forwardMap', () => {
    expect(isValidRule(rule({ forwardMap: null }) as any)).toBe(false)
  })

  it('rejects array forwardMap (object shape expected)', () => {
    expect(isValidRule(rule({ forwardMap: [] as any }) as any)).toBe(false)
  })

  it('rejects a mapping value that is not a non-empty string', () => {
    expect(isValidRule(rule({ forwardMap: { [S.review]: 42 as any } }) as any)).toBe(false)
    expect(isValidRule(rule({ forwardMap: { [S.review]: '' } }) as any)).toBe(false)
  })

  it('rejects malformed allowedLoops', () => {
    expect(isValidRule(rule({ allowedLoops: [{ from: '', to: S.inProgress }] as any }) as any)).toBe(false)
    expect(isValidRule(rule({ allowedLoops: [{ to: S.inProgress }] as any }) as any)).toBe(false)
    expect(isValidRule(rule({ allowedLoops: 'nope' as any }) as any)).toBe(false)
  })

  it('rejects malformed autoCreate.triggerStatuses', () => {
    expect(isValidRule(rule({ autoCreate: { triggerStatuses: ['', S.review] } as any }) as any)).toBe(false)
  })

  it('accepts an empty autoCreate.triggerStatuses', () => {
    expect(isValidRule(rule({ autoCreate: { triggerStatuses: [] } as any }) as any)).toBe(true)
  })
})
