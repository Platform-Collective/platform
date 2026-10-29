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

import core, { AccountRole, TxFactory, type AccountUuid, type PersonId, type Ref } from '@hcengineering/core'
import task from '@hcengineering/task'
import tracker from '@hcengineering/tracker'
import workflowRules, { workflowRulesId } from '@hcengineering/workflow-rules'

import { OnWorkflowRuleMirror as _OnWorkflowRuleMirror, isValidRule } from '../index'

// Cast once so each test can pass plain fixture objects as Tx[].
const invokeMirror = _OnWorkflowRuleMirror as unknown as (txes: Any[], control: Any) => Promise<Any[]>

async function OnWorkflowRuleMirror (txes: Any[], control: Any): Promise<Any[]> {
  // Single-invocation fixtures use their input as the complete request.
  return await invokeMirror(txes, { ...control, txes: control.txes ?? txes })
}

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

function projectA (over: Any = {}): Any {
  return {
    _id: PROJ_A,
    _class: tracker.class.Project,
    members: [ACC_MEMBER],
    owners: [],
    ...over
  }
}

/** Compact helper for the common "parent in A + child in B linked to it" fixture. */
function linkedPair (childOver: Any = {}): Any[] {
  return [issue({ _id: 'issue:a1' }), issue({ _id: 'issue:b1', space: PROJ_B, attachedTo: 'issue:a1', ...childOver })]
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
  pluginConfigs?: Any[]
  contextCache?: Map<string, any>
  // Complete request and identity for `control.txes`. Sharing the SAME
  // array simulates dispatcher groups within one request; different
  // arrays simulate wrapPipeline reuse across requests.
  controlTxes?: any[]
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
  // Default: an explicitly enabled PluginConfiguration row exists. This
  // mirrors what the Configure page writes when an Owner opts in. The
  // trigger fails closed when the row is missing or disabled, so the
  // positive tests need the row to be present.
  const configs =
    opts.pluginEnabled === false
      ? [{ _id: 'pc:1', _class: core.class.PluginConfiguration, pluginId: workflowRulesId, enabled: false }]
      : opts.pluginEnabled === undefined && opts.pluginConfigs !== undefined
        ? opts.pluginConfigs
        : [{ _id: 'pc:1', _class: core.class.PluginConfiguration, pluginId: workflowRulesId, enabled: true }]

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
      return rulesList.filter(
        (r) =>
          (q.space === undefined || matches(r.space, q.space)) && (q.enabled === undefined || r.enabled === q.enabled)
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

  const txFactory = new TxFactory(SOC_MEMBER as PersonId, true)

  const hierarchy = {
    isDerived: (child: any, base: any): boolean => child === base || child === tracker.class.Issue
  }

  const ctx: any = {
    contextData: { socialStringsToUsers },
    warn: jest.fn(),
    info: jest.fn()
  }

  // Per-root-tx (per-request) store. Shared across invocations within one
  // request by passing the same Map in via opts.contextCache.
  const contextCache = opts.contextCache ?? new Map<string, any>()
  // Request identity. The trigger tracks each `control.txes` array on a
  // reused `SessionData` (wrapPipeline case).
  const txes = opts.controlTxes

  return { ctx, findAll, modelDb, txFactory, hierarchy, contextCache, txes }
}

const DISPATCH_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0]
]

async function dispatchRequest (request: Any[], groups: Any[][], opts: WorldOptions): Promise<Any[]> {
  const control = makeControl({ ...opts, controlTxes: [...request] })
  const result: Any[] = []
  for (const group of groups) {
    // Like Triggers.applyTrigger: change the group factory, retain the
    // complete request identity, and append outputs for later triggers.
    control.txFactory = new TxFactory(group[0].modifiedBy, true)
    const emitted = await OnWorkflowRuleMirror(group, control)
    result.push(...emitted)
    control.txes.push(...emitted)
  }
  return result.sort((a, b) => a.modifiedOn - b.modifiedOn)
}

describe.each([false, true])('request chronology (allowedLoops=%s)', (withLoops) => {
  const allowedLoops = withLoops ? [{ from: S.done, to: S.inProgress }] : []
  const identityRule = rule({
    forwardMap: { [S.review]: S.review, [S.done]: S.done, [S.inProgress]: S.inProgress },
    allowedLoops
  })

  it.each(DISPATCH_ORDERS)('evaluates three moves in time order for dispatch %s,%s,%s', async (...order) => {
    const request = [
      updateTx(S.review, { modifiedBy: SOC_MEMBER, modifiedOn: 1001 }),
      updateTx(S.done, { modifiedBy: SOC_ADMIN, modifiedOn: 1002 }),
      updateTx(S.inProgress, { modifiedBy: core.account.System, modifiedOn: 1003 })
    ]
    const emitted = await dispatchRequest(
      request,
      order.map((i) => [request[i]]),
      {
        issues: linkedPair(),
        rules: [identityRule]
      }
    )
    const legal = withLoops ? request : request.slice(0, 2)
    expect(
      emitted.map((tx) => ({
        status: tx.operations.status,
        modifiedOn: tx.modifiedOn,
        modifiedBy: tx.modifiedBy
      }))
    ).toEqual(
      legal.map((tx) => ({
        status: tx.operations.status,
        modifiedOn: tx.modifiedOn,
        modifiedBy: tx.modifiedBy
      }))
    )
    expect(emitted.every((tx) => tx.space === core.space.DerivedTx && tx.objectId === 'issue:b1')).toBe(true)
  })

  describe.each([
    {
      name: 'newer no-op against persisted status',
      base: S.inProgress,
      targets: [S.done, S.inProgress],
      legal: [S.done, S.inProgress],
      withoutLoops: [S.done]
    },
    {
      name: 'older refused against persisted status',
      base: S.done,
      targets: [S.review, S.inProgress],
      legal: [S.inProgress],
      withoutLoops: []
    },
    {
      name: 'newer refused against persisted status',
      base: S.done,
      targets: [S.inProgress, S.review],
      legal: [S.inProgress, S.review],
      withoutLoops: []
    }
  ])('$name', ({ base, targets, legal, withoutLoops }) => {
    it.each([
      [0, 1],
      [1, 0]
    ])('evaluates both candidates for dispatch %s,%s', async (first, second) => {
      const request = targets.map((status, i) =>
        updateTx(status, {
          modifiedOn: 1001 + i,
          modifiedBy: i === 0 ? SOC_ADMIN : SOC_MEMBER
        })
      )
      const emitted = await dispatchRequest(request, [[request[first]], [request[second]]], {
        issues: linkedPair({ status: base }),
        rules: [identityRule]
      })
      expect(emitted.map((tx) => tx.operations.status)).toEqual(withLoops ? legal : withoutLoops)
      for (const tx of emitted) {
        const source = request.find((candidate) => candidate.modifiedOn === tx.modifiedOn)
        expect(tx.modifiedBy).toBe(source?.modifiedBy)
      }
    })
  })
})

describe('request chronology ties and authorization', () => {
  it('retries the complete request in a later group after evaluation throws', async () => {
    const request = [
      updateTx(S.inProgress, { modifiedBy: SOC_MEMBER, modifiedOn: 1001 }),
      updateTx(S.review, { modifiedBy: SOC_ADMIN, modifiedOn: 1002 })
    ]
    const control = makeControl({ issues: linkedPair(), rules: [rule()], controlTxes: request })
    const findAll = control.findAll.getMockImplementation()
    control.findAll.mockImplementation(async (...args: unknown[]) => {
      // Fail on the second source lookup, after the first mirror is queued.
      if (
        args[1] === tracker.class.Issue &&
        (args[2] as Any)._id === 'issue:a1' &&
        control.txFactory.createTxUpdateDoc.mock.calls.length === 1
      ) {
        throw new Error('source lookup failed')
      }
      return await findAll(...args)
    })
    jest.spyOn(control.txFactory, 'createTxUpdateDoc')

    await expect(OnWorkflowRuleMirror([request[0]], control)).rejects.toThrow('source lookup failed')
    expect(control.txFactory.createTxUpdateDoc).toHaveBeenCalledTimes(1)
    control.findAll.mockImplementation(findAll)

    const emitted = await OnWorkflowRuleMirror([request[1]], control)
    expect(
      emitted.map((tx) => ({
        status: tx.operations.status,
        modifiedOn: tx.modifiedOn,
        modifiedBy: tx.modifiedBy
      }))
    ).toEqual([
      { status: S.inProgress, modifiedOn: 1001, modifiedBy: SOC_MEMBER },
      { status: S.done, modifiedOn: 1002, modifiedBy: SOC_ADMIN }
    ])
    request.push(...emitted)
    expect(await OnWorkflowRuleMirror([request[0]], control)).toEqual([])
  })

  it('emits each interleaved request exactly once across multiple actor groups on a shared session', async () => {
    const contextCache = new Map<string, unknown>()
    const controls = [0, 1].map((i) =>
      makeControl({
        issues: linkedPair(),
        rules: [rule()],
        contextCache,
        controlTxes: [
          updateTx(S.inProgress, { modifiedBy: SOC_MEMBER, modifiedOn: 1001 + i * 10 }),
          updateTx(S.review, { modifiedBy: SOC_ADMIN, modifiedOn: 1002 + i * 10 })
        ]
      })
    )
    const requests = controls.map((control) => [...control.txes])
    const emitted: Any[][] = [[], []]

    // Both first groups enter before either completes, then the second
    // groups revisit their own arrays with the other request in between.
    for (let group = 0; group < 2; group++) {
      const results = await Promise.all(
        controls.map(async (control, i) => {
          control.txFactory = new TxFactory(requests[i][group].modifiedBy, true)
          return await OnWorkflowRuleMirror([requests[i][group]], control)
        })
      )
      results.forEach((result, i) => {
        if (group === 1) expect(result).toEqual([])
        emitted[i].push(...result)
        controls[i].txes.push(...result)
      })
    }

    emitted.forEach((result, i) => {
      expect(
        result.map((tx) => ({
          status: tx.operations.status,
          modifiedOn: tx.modifiedOn,
          modifiedBy: tx.modifiedBy
        }))
      ).toEqual([
        { status: S.inProgress, modifiedOn: 1001 + i * 10, modifiedBy: SOC_MEMBER },
        { status: S.done, modifiedOn: 1002 + i * 10, modifiedBy: SOC_ADMIN }
      ])
    })
  })

  it('evaluates the request only once even when every move is refused or a no-op', async () => {
    const request = [
      updateTx(S.review, { modifiedBy: SOC_ADMIN, modifiedOn: 1001 }),
      updateTx(S.done, { modifiedBy: SOC_MEMBER, modifiedOn: 1002 })
    ]
    const control = makeControl({
      issues: linkedPair({ status: S.done }),
      rules: [rule({ forwardMap: { [S.review]: S.review, [S.done]: S.done } })],
      controlTxes: request
    })
    expect(await OnWorkflowRuleMirror([request[0]], control)).toEqual([])
    expect(control.findAll).toHaveBeenCalled()
    control.findAll.mockClear()
    expect(await OnWorkflowRuleMirror([request[1]], control)).toEqual([])
    expect(control.findAll).not.toHaveBeenCalled()
  })

  it.each(DISPATCH_ORDERS)('breaks equal timestamps by request order for dispatch %s,%s,%s', async (...order) => {
    const request = [
      updateTx(S.review, { modifiedBy: SOC_MEMBER }),
      updateTx(S.done, { modifiedBy: SOC_ADMIN }),
      updateTx(S.inProgress, { modifiedBy: core.account.System })
    ]
    const r = rule({
      forwardMap: { [S.review]: S.review, [S.done]: S.done, [S.inProgress]: S.inProgress },
      allowedLoops: [{ from: S.done, to: S.inProgress }]
    })
    for (const txes of [request, [...request].reverse()]) {
      const emitted = await dispatchRequest(
        txes,
        order.map((i) => [request[i]]),
        {
          issues: linkedPair(),
          rules: [r]
        }
      )
      const legal = txes === request ? [S.review, S.done, S.inProgress] : [S.inProgress, S.done]
      expect(emitted.map((tx) => tx.operations.status)).toEqual(legal)
      expect(emitted.map((tx) => tx.modifiedBy)).toEqual(txes.slice(0, legal.length).map((tx) => tx.modifiedBy))
      expect(emitted.every((tx) => tx.modifiedOn === 1000)).toBe(true)
    }
  })

  it.each([
    [0, 1],
    [1, 0]
  ])('uses each source actor for authorization in dispatch %s,%s', async (first, second) => {
    const request = [
      updateTx(S.review, { modifiedBy: SOC_OUTSIDER, modifiedOn: 1001 }),
      updateTx(S.inProgress, { modifiedBy: SOC_MEMBER, modifiedOn: 1002 })
    ]
    const emitted = await dispatchRequest(request, [[request[first]], [request[second]]], {
      issues: linkedPair(),
      rules: [rule()]
    })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      operations: { status: S.inProgress },
      modifiedBy: SOC_MEMBER,
      modifiedOn: 1002
    })
  })
})

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
    const res = await OnWorkflowRuleMirror([updateTx('constructor')], control)
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
      issues: linkedPair(),
      rules: [rule()],
      projects: [project({ members: [], owners: [] })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: SOC_OUTSIDER })], control)
    expect(res).toHaveLength(0)
  })

  it('allows the mirror when the acting user is an Admin even without membership', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      projects: [project({ members: [], owners: [] })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: SOC_ADMIN })], control)
    expect(res).toHaveLength(1)
  })

  it('refuses to mirror onto an archived target project', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      projects: [project({ archived: true })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it.each([{ archived: 'false' }, { archived: 1 }, { archived: null }])(
    'allows a mirror when the target archived field is not strictly boolean true ($archived)',
    async ({ archived }) => {
      const control = makeControl({
        issues: linkedPair(),
        rules: [rule()],
        projects: [project({ archived })]
      })

      const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
      expect(res).toHaveLength(1)
      expect(res[0]).toMatchObject({ objectId: 'issue:b1', operations: { status: S.done } })
    }
  )

  it('refuses to mirror onto an archived target even for an Admin', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      projects: [project({ archived: true })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: SOC_ADMIN })], control)
    expect(res).toHaveLength(0)
  })

  it('refuses to mirror onto an archived target even for the system account', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      projects: [project({ archived: true })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: core.account.System })], control)
    expect(res).toHaveLength(0)
  })

  it('refuses to mirror onto a restricted TypedSpace', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      projects: [project({ restricted: true })]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review, { modifiedBy: SOC_ADMIN })], control)
    expect(res).toHaveLength(0)
  })

  it('is a no-op when the plugin is disabled via PluginConfiguration', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      pluginEnabled: false
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it('is a no-op when no PluginConfiguration row exists (fail closed)', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      pluginConfigs: [] // no row at all - matches a workspace that never opted in
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it('is a no-op when more than one PluginConfiguration row is present', async () => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      pluginConfigs: [
        { _id: 'pc:1', _class: core.class.PluginConfiguration, pluginId: workflowRulesId, enabled: true },
        { _id: 'pc:2', _class: core.class.PluginConfiguration, pluginId: workflowRulesId, enabled: true }
      ]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it.each([
    { enabled: 'yes' },
    { enabled: 'true' },
    { enabled: 1 },
    { enabled: 0 },
    { enabled: '' },
    { enabled: {} },
    { enabled: [] },
    { enabled: null },
    { enabled: undefined }
  ])('is a no-op when the enabled field is not strictly boolean true ($enabled)', async ({ enabled }) => {
    const control = makeControl({
      issues: linkedPair(),
      rules: [rule()],
      pluginConfigs: [{ _id: 'pc:1', _class: core.class.PluginConfiguration, pluginId: workflowRulesId, enabled }]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(0)
  })

  it('cross-group dispatcher scenario: without allowedLoops, both orderings end at Done (older move kept, newer blocked after it)', async () => {
    // The complete request includes an unmapped move and two mapped
    // moves in different actor groups. Time order applies Done@1001,
    // then refuses InProgress@1002, regardless of which group is visited.
    const r = rule({
      forwardMap: { [S.review]: S.done, [S.inProgress]: S.inProgress }
    })
    const sharedCache = new Map<string, any>()
    const sharedTxes: any[] = []

    const txA1 = updateTx('status:unmapped', {
      modifiedBy: SOC_MEMBER,
      modifiedOn: 1000
    })
    const txA2 = updateTx(S.inProgress, {
      modifiedBy: SOC_MEMBER,
      modifiedOn: 1002
    })
    const txB = updateTx(S.review, {
      modifiedBy: SOC_ADMIN,
      modifiedOn: 1001
    })

    sharedTxes.push(txA1, txA2, txB)

    // Group-A-first
    const ctrlA1 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache,
      controlTxes: sharedTxes
    })
    const resA = await OnWorkflowRuleMirror([txA1, txA2], ctrlA1)
    const ctrlB1 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache,
      controlTxes: sharedTxes
    })
    const resB = await OnWorkflowRuleMirror([txB], ctrlB1)
    const combined = [...resA, ...resB].sort((a: any, b: any) => a.modifiedOn - b.modifiedOn)
    expect(resB).toEqual([])
    expect(combined).toHaveLength(1)
    expect(combined[0]).toMatchObject({ operations: { status: S.done }, modifiedOn: 1001, modifiedBy: SOC_ADMIN })

    // Group-B-first
    const sharedCache2 = new Map<string, any>()
    const sharedTxes2 = [txA1, txA2, txB]
    const ctrlB2 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache2,
      controlTxes: sharedTxes2
    })
    const resB2 = await OnWorkflowRuleMirror([txB], ctrlB2)
    const ctrlA2 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache2,
      controlTxes: sharedTxes2
    })
    const resA2 = await OnWorkflowRuleMirror([txA1, txA2], ctrlA2)
    const combined2 = [...resB2, ...resA2].sort((a: any, b: any) => a.modifiedOn - b.modifiedOn)
    expect(resA2).toEqual([])
    expect(combined2).toHaveLength(1)
    expect(combined2[0]).toMatchObject({ operations: { status: S.done } })
  })

  it('cross-group dispatcher scenario WITH allowedLoops: both orderings agree on the newer target (InProgress)', async () => {
    // The allowed loop makes both chronological moves legal. The first
    // group visit emits both with their source actors and timestamps.
    const r = rule({
      forwardMap: { [S.review]: S.done, [S.inProgress]: S.inProgress },
      allowedLoops: [{ from: S.done, to: S.inProgress }]
    })
    const txA1 = updateTx('status:unmapped', {
      modifiedBy: SOC_MEMBER,
      modifiedOn: 1000
    })
    const txA2 = updateTx(S.inProgress, {
      modifiedBy: SOC_MEMBER,
      modifiedOn: 1002
    })
    const txB = updateTx(S.review, {
      modifiedBy: SOC_ADMIN,
      modifiedOn: 1001
    })

    // Group-A-first
    const sharedCache = new Map<string, any>()
    const sharedTxes = [txA1, txA2, txB]
    const ctrlA1 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache,
      controlTxes: sharedTxes
    })
    const resA = await OnWorkflowRuleMirror([txA1, txA2], ctrlA1)
    const ctrlB1 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache,
      controlTxes: sharedTxes
    })
    const resB = await OnWorkflowRuleMirror([txB], ctrlB1)
    const combined = [...resA, ...resB].sort((a: any, b: any) => a.modifiedOn - b.modifiedOn)
    expect(resB).toEqual([])
    expect(combined.map((t: any) => t.operations.status)).toEqual([S.done, S.inProgress])
    expect(combined.map((t: any) => t.modifiedBy)).toEqual([SOC_ADMIN, SOC_MEMBER])
    expect(combined.map((t: any) => t.modifiedOn)).toEqual([1001, 1002])

    // Group-B-first
    const sharedCache2 = new Map<string, any>()
    const sharedTxes2 = [txA1, txA2, txB]
    const ctrlB2 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache2,
      controlTxes: sharedTxes2
    })
    const resB2 = await OnWorkflowRuleMirror([txB], ctrlB2)
    const ctrlA2 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache2,
      controlTxes: sharedTxes2
    })
    const resA2 = await OnWorkflowRuleMirror([txA1, txA2], ctrlA2)
    const combined2 = [...resB2, ...resA2].sort((a: any, b: any) => a.modifiedOn - b.modifiedOn)
    expect(resA2).toEqual([])
    expect(combined2.map((t: any) => t.operations.status)).toEqual([S.done, S.inProgress])
    expect(combined2.map((t: any) => t.modifiedBy)).toEqual([SOC_ADMIN, SOC_MEMBER])
    expect(combined2.map((t: any) => t.modifiedOn)).toEqual([1001, 1002])
  })

  it('evaluates independent control.txes arrays separately (wrapPipeline reuse)', async () => {
    // wrapPipeline reuses one SessionData across successive pipeline.tx()
    // calls, so the contextCache is reused too. The trigger must track
    // each request identity independently, or a mirror queued in request 1
    // would still block an unrelated move in request 2.
    const r = rule({ forwardMap: { [S.review]: S.done, [S.todo]: S.todo } })
    const sharedCache = new Map<string, any>()

    // Request 1: different `txes` array. Queues Done at t=1000.
    const req1Txes = [updateTx(S.review, { modifiedOn: 1000 })]
    const ctrl1 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache,
      controlTxes: req1Txes
    })
    const res1 = await OnWorkflowRuleMirror(req1Txes, ctrl1)
    expect(res1).toHaveLength(1)

    // Request 2: NEW complete-request array. A stale processed marker
    // would skip it; stale authorization must not leak across requests.
    const req2Txes = [updateTx(S.todo, { modifiedOn: 500 })]
    const ctrl2 = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r],
      contextCache: sharedCache,
      controlTxes: req2Txes
    })
    const res2 = await OnWorkflowRuleMirror(req2Txes, ctrl2)
    expect(res2).toHaveLength(1)
    expect(res2[0]).toMatchObject({ operations: { status: S.todo } })
  })

  it('sorts input by modifiedOn even when supplied in reverse order', async () => {
    // The dispatcher does not guarantee the order of transactions inside
    // one group. The trigger must sort by modifiedOn itself so the pending
    // map reflects causal order.
    const r1 = rule({ _id: 'rule:to-done', forwardMap: { [S.review]: S.done } })
    const r2 = rule({ _id: 'rule:to-ip', forwardMap: { [S.todo]: S.inProgress } })
    const control = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [r1, r2]
    })

    // Supplied in reverse (t=1001 then t=1000). If the trigger used the
    // supplied order, the InProgress move would be queued first and the
    // Done move would then be refused as a forward move over InProgress -
    // wrong answer. Sorted by modifiedOn, Done lands first and InProgress
    // is refused as the backward move.
    const txLater = updateTx(S.todo, { modifiedOn: 1001 })
    const txEarlier = updateTx(S.review, { modifiedOn: 1000 })
    const res = await OnWorkflowRuleMirror([txLater, txEarlier], control)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ operations: { status: S.done } })
  })

  it('reciprocal non-convergent rules terminate because the mirror is a DerivedTx', async () => {
    // A->B maps review -> done, B->A maps done -> review. Without the
    // DerivedTx-space check, the mirror onto B would fire the trigger on
    // the mirror onto A and back forever. The fixture is deliberately
    // generous so every OTHER guard would pass on a replay: Project A
    // exists with SOC_MEMBER in members, the txFactory stamps
    // modifiedBy = SOC_MEMBER on derived outputs, and the counterpart
    // resolver has a valid parentIssue path. The ONLY thing that stops
    // the loop is the DerivedTx-space short circuit.
    const forward = rule({ _id: 'rule:a-to-b', forwardMap: { [S.review]: S.done } })
    const reverse = rule({
      _id: 'rule:b-to-a',
      space: PROJ_B,
      linkedProject: PROJ_A,
      linkKind: 'parentIssue',
      forwardMap: { [S.done]: S.review }
    })
    const control = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [forward, reverse],
      // Both target projects exist with SOC_MEMBER membership so authz
      // on the replay would otherwise succeed.
      projects: [projectA(), project()]
    })

    const res = await OnWorkflowRuleMirror([updateTx(S.review)], control)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ operations: { status: S.done } })
    // Replay the derived output through the trigger. Only the DerivedTx
    // space short-circuit should stop it; everything else is set up to
    // pass.
    const replay = await OnWorkflowRuleMirror(res, control)
    expect(replay).toHaveLength(0)

    // Sanity: if we strip the DerivedTx space from the "mirror" and
    // feed it as if it were an ordinary user write, the reverse rule
    // DOES fire. That proves the fixture would otherwise cascade and
    // the only reason it does not is the trigger's own DerivedTx check.
    const asOrdinary = res.map((t: any) => ({ ...t, space: core.space.Tx }))
    const sharedCache = new Map<string, any>()
    const freshCtrl = makeControl({
      issues: linkedPair({ status: S.backlog }),
      rules: [forward, reverse],
      projects: [projectA(), project()],
      contextCache: sharedCache
    })
    const forcedReplay = await OnWorkflowRuleMirror(asOrdinary, freshCtrl)
    expect(forcedReplay).toHaveLength(1)
  })

  it('an allowedLoops entry naming a status not in the TaskType is still blocked', async () => {
    // Rank check runs before loop allow-list, so an attacker-authored
    // loop pointing at a stale or foreign status does not wave the move.
    const unknown = 'status:unknown-to-task-type' as any
    const r = rule({
      forwardMap: { [S.review]: unknown },
      allowedLoops: [{ from: S.review, to: unknown }]
    })
    const control = makeControl({
      issues: linkedPair({ status: S.review }),
      rules: [r]
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
