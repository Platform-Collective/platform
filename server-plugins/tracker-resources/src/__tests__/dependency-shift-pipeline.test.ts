//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

// Pins the ordering contract of the dependency-shift e-mail suppression through
// the real trigger pipeline (TriggersMiddleware + Triggers):
//
//  - the summary trigger runs in the sync phase and writes the request-local
//    provider coverage,
//  - the due-date notifications are evaluated in the deferred async phase,
//    which must still see that coverage and the summary transaction.
//
// The async evaluator mirrors the production registration of the activity
// trigger (`isAsync: true`, issue updates) and calls the real notification
// routing (`isShouldNotifyTx`).

import contact from '@hcengineering/contact'
import core, {
  ClassifierKind,
  DOMAIN_MODEL,
  Hierarchy,
  MeasureMetricsContext,
  TxFactory,
  type AccountUuid,
  type Class,
  type Data,
  type Doc,
  type MeasureContext,
  type ModelDb,
  type Obj,
  type PersonId,
  type Ref,
  type SessionData,
  type Tx,
  type TxUpdateDoc
} from '@hcengineering/core'
import gmail from '@hcengineering/gmail'
import { TriggersMiddleware } from '@hcengineering/middleware'
import notification, { type NotificationType } from '@hcengineering/notification'
import { addLocation, type Plugin } from '@hcengineering/platform'
import serverCore, { type Middleware, type PipelineContext, type TriggerControl } from '@hcengineering/server-core'
import type { ReceiverInfo } from '@hcengineering/server-notification'
import { isShouldNotifyTx, NotificationProviderControl } from '@hcengineering/server-notification-resources'
import tracker, { type Issue } from '@hcengineering/tracker'

const getAccountBySocialId = jest.fn()
jest.mock('@hcengineering/server-contact', () => ({
  getAccountBySocialId: (...a: unknown[]) => getAccountBySocialId(...a),
  getEmployeeByAcc: async () => ({ _id: 'employee' }),
  getPerson: async () => undefined
}))

// Imported after the mocks are registered.
import { OnDependencyShiftRequest } from '../index'

const AUTHOR = 'acc-author' as AccountUuid
const MEMBER = 'acc-member' as AccountUuid
const AUTHOR_SOCIAL = 'author-social' as PersonId
const HOME = 'project1'
const TEST_PLUGIN = 'test-dependency-shift' as Plugin

const factory = new TxFactory(core.account.System)

function classTx (
  _id: Ref<Class<Obj>>,
  ext: Ref<Class<Obj>> | undefined,
  domain: string | undefined,
  kind = ClassifierKind.CLASS
): Tx {
  return factory.createTxCreateDoc(
    core.class.Class,
    core.space.Model,
    { kind, extends: ext, label: 'x', domain } as unknown as Data<Class<Obj>>,
    _id
  )
}

function makeHierarchy (): Hierarchy {
  const h = new Hierarchy()
  const txes: Array<[Ref<Class<Obj>>, Ref<Class<Obj>> | undefined, string | undefined, ClassifierKind?]> = [
    [core.class.Obj, undefined, undefined],
    [core.class.Doc, core.class.Obj, undefined],
    [core.class.Class, core.class.Doc, DOMAIN_MODEL],
    [core.class.Tx, core.class.Doc, 'tx'],
    [core.class.TxCUD, core.class.Tx, 'tx'],
    [core.class.TxCreateDoc, core.class.TxCUD, 'tx'],
    [core.class.TxUpdateDoc, core.class.TxCUD, 'tx'],
    [core.class.TxRemoveDoc, core.class.TxCUD, 'tx'],
    [core.class.TxMixin, core.class.TxCUD, 'tx'],
    [core.class.Collaborator, core.class.Doc, 'collaborator'],
    [tracker.class.Issue, core.class.Doc, 'task'],
    [tracker.class.DependencyShiftRequest, core.class.Doc, 'tracker'],
    [notification.class.DocNotifyContext, core.class.Doc, 'notification'],
    [notification.class.InboxNotification, core.class.Doc, 'notification'],
    [notification.class.CommonInboxNotification, notification.class.InboxNotification, 'notification'],
    [tracker.class.DependencyShiftedNotification, notification.class.CommonInboxNotification, 'notification'],
    [contact.class.Person, core.class.Doc, 'contact'],
    [contact.mixin.Employee, contact.class.Person, undefined, ClassifierKind.MIXIN],
    [contact.class.PersonSpace, core.class.Doc, 'space']
  ]
  for (const [id, ext, domain, kind] of txes) {
    h.tx(classTx(id, ext, domain, kind))
  }
  return h
}

const dueDateType: NotificationType = {
  _id: 'tracker:notification:Issue_dueDate' as Ref<NotificationType>,
  _class: notification.class.NotificationType,
  space: core.space.Model,
  modifiedBy: core.account.System,
  modifiedOn: 0,
  label: notification.string.Notifications,
  generated: false,
  hidden: false,
  group: notification.ids.NotificationGroup,
  field: 'dueDate',
  defaultEnabled: true,
  txClasses: [core.class.TxUpdateDoc],
  objectClass: tracker.class.Issue
}
const summaryType: NotificationType = {
  ...dueDateType,
  _id: tracker.ids.DependencyShiftedNotification,
  objectClass: tracker.class.DependencyShiftedNotification,
  txClasses: [core.class.TxCreateDoc],
  field: undefined
}
const providers = [gmail.providers.EmailNotificationProvider, notification.providers.InboxNotificationProvider].map(
  (_id) => ({ _id, defaultEnabled: true })
)
const receiver: ReceiverInfo = {
  account: MEMBER,
  socialIds: ['member-social' as PersonId],
  space: 'person-space' as ReceiverInfo['space'],
  employee: 'emp-acc-member' as ReceiverInfo['employee'],
  role: undefined
}

function world (_class: Ref<Class<Doc>>, q: any): any[] {
  if (_class === tracker.class.Issue) {
    return [
      { _id: 'issueA', space: HOME, identifier: 'PROJ-1', title: 'Trigger issue' },
      { _id: 'issueB', space: HOME, identifier: 'PROJ-2', title: 'Shifted issue' }
    ].filter((it) => (q._id?.$in ?? [q._id]).includes(it._id) && it.space === q.space)
  }
  if (_class === core.class.Collaborator) return [{ attachedTo: 'issueB', collaborator: MEMBER }]
  if (_class === contact.mixin.Employee) {
    return q.personUuid !== undefined ? [{ _id: `emp-${MEMBER}`, personUuid: MEMBER }] : []
  }
  if (_class === contact.class.PersonSpace) return [{ _id: `ps-${MEMBER}`, person: `emp-${MEMBER}` }]
  return []
}

describe('dependency-shift e-mail coverage through the trigger pipeline', () => {
  it('runs the summary in the sync phase and the due-date evaluation in the deferred async phase', async () => {
    getAccountBySocialId.mockResolvedValue(AUTHOR)
    const order: string[] = []
    const evaluated: Array<{ email: boolean, inbox: boolean, covered: string[] | undefined }> = []

    const summary = async (txes: Tx[], control: TriggerControl): Promise<Tx[]> => {
      order.push('summary')
      return await OnDependencyShiftRequest(txes, control)
    }
    const dueDateNotifications = async (txes: Tx[], control: TriggerControl): Promise<Tx[]> => {
      order.push('due-date')
      for (const tx of txes as Array<TxUpdateDoc<Issue>>) {
        const doc = { _id: tx.objectId, _class: tx.objectClass, space: tx.objectSpace } as unknown as Doc
        const result = await isShouldNotifyTx(
          control,
          tx,
          doc,
          receiver,
          false,
          false,
          new NotificationProviderControl([], [])
        )
        evaluated.push({
          email: result.has(gmail.providers.EmailNotificationProvider),
          inbox: result.has(notification.providers.InboxNotificationProvider),
          covered: result.coveredProviders
        })
      }
      return []
    }
    addLocation(TEST_PLUGIN, async () => ({ default: async () => ({ trigger: { summary, dueDateNotifications } }) }))

    // Same registration shape as the production models: summary sync, activity async.
    const triggers = [
      {
        _id: 'test:trigger:summary',
        _class: serverCore.class.Trigger,
        trigger: `${TEST_PLUGIN}:trigger:summary`,
        txMatch: { _class: core.class.TxCreateDoc, objectClass: tracker.class.DependencyShiftRequest }
      },
      {
        _id: 'test:trigger:due-date',
        _class: serverCore.class.Trigger,
        trigger: `${TEST_PLUGIN}:trigger:dueDateNotifications`,
        isAsync: true,
        txMatch: { _class: core.class.TxUpdateDoc, objectClass: tracker.class.Issue }
      }
    ]
    const modelDb = {
      findAllSync: (clazz: unknown) => {
        if (clazz === serverCore.class.Trigger) return triggers
        if (clazz === notification.class.NotificationProvider) return providers
        if (clazz === notification.class.NotificationType) return [dueDateType]
        return []
      },
      findObject: (id: unknown) => (id === summaryType._id ? summaryType : undefined)
    } as unknown as ModelDb

    const derived = jest.fn(async (..._args: unknown[]) => ({}))
    const next = {
      findAll: async (_ctx: unknown, _class: Ref<Class<Doc>>, q: any) => world(_class, q),
      tx: async () => ({})
    } as unknown as Middleware
    const context = {
      hierarchy: makeHierarchy(),
      modelDb,
      workspace: { uuid: 'ws' },
      storageAdapter: {},
      lowLevelStorage: {},
      derived: { tx: derived },
      head: { handleBroadcast: jest.fn() }
    } as unknown as PipelineContext
    const middleware = await TriggersMiddleware.create(new MeasureMetricsContext('test', {}), context, next)

    const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
    ctx.contextData = {
      account: { uuid: AUTHOR },
      sessionId: 'session',
      admin: false,
      broadcast: { txes: [], targets: {}, queue: [], sessions: {} },
      removedMap: new Map(),
      contextCache: new Map(),
      isAsyncContext: false
    } as unknown as SessionData

    const user = new TxFactory(AUTHOR_SOCIAL)
    const dateTx = user.createTxUpdateDoc(tracker.class.Issue, HOME as any, 'issueB' as Ref<Issue>, { dueDate: 10 })
    const requestTx = user.createTxCreateDoc(tracker.class.DependencyShiftRequest, HOME as any, {
      triggerIssueId: 'issueA',
      shiftedIssues: [{ issueId: 'issueB' }],
      cascadeToken: 'tok'
    } as any)

    await middleware.tx(ctx, [dateTx, requestTx])

    // Sync phase done, async phase only queued (regular user request).
    expect(order).toEqual(['summary'])
    const syncDerived = derived.mock.calls.flatMap((call) => call[1] as Tx[])
    expect(syncDerived.some((tx: any) => tx.objectClass === tracker.class.DependencyShiftedNotification)).toBe(true)
    const asyncRequests = (ctx.contextData as any).asyncRequests as Array<(ctx: MeasureContext, id?: string) => Promise<void>>
    expect(asyncRequests).toHaveLength(1)

    await asyncRequests[0](ctx, 'async')

    expect(order).toEqual(['summary', 'due-date'])
    expect(evaluated).toEqual([{ email: false, inbox: true, covered: [gmail.providers.EmailNotificationProvider] }])
    await (middleware as TriggersMiddleware).close()
  })

  it('keeps the per-issue e-mail when the summary trigger fails', async () => {
    getAccountBySocialId.mockRejectedValue(new Error('account store down'))
    const control: any = {
      ctx: { error: jest.fn() },
      txFactory: new TxFactory(AUTHOR_SOCIAL),
      txes: [],
      contextCache: new Map(),
      findAll: async (_ctx: unknown, _class: Ref<Class<Doc>>, q: any) => world(_class, q)
    }
    const requestTx = control.txFactory.createTxCreateDoc(tracker.class.DependencyShiftRequest, HOME, {
      triggerIssueId: 'issueA',
      shiftedIssues: [{ issueId: 'issueB' }]
    })

    const result = await OnDependencyShiftRequest([requestTx], control)

    expect(result).toEqual([expect.objectContaining({ _class: core.class.TxRemoveDoc, objectId: requestTx.objectId })])
    expect(control.contextCache.has('notification:provider-coverage')).toBe(false)
    expect(control.ctx.error).toHaveBeenCalledTimes(1)
  })

  it('publishes no summary and no coverage when one recipient of a request fails', async () => {
    getAccountBySocialId.mockResolvedValue(AUTHOR)
    const OTHER = 'acc-other' as AccountUuid
    let contextLookups = 0
    const control: any = {
      ctx: { error: jest.fn() },
      txFactory: new TxFactory(AUTHOR_SOCIAL),
      contextCache: new Map(),
      findAll: async (_ctx: unknown, _class: Ref<Class<Doc>>, q: any) => {
        if (_class === core.class.Collaborator) {
          return [
            { attachedTo: 'issueB', collaborator: MEMBER },
            { attachedTo: 'issueB', collaborator: OTHER }
          ]
        }
        if (_class === contact.mixin.Employee && q.personUuid !== undefined) {
          return [MEMBER, OTHER].map((acc) => ({ _id: `emp-${acc}`, personUuid: acc }))
        }
        if (_class === contact.class.PersonSpace) {
          return [MEMBER, OTHER].map((acc) => ({ _id: `ps-${acc}`, person: `emp-${acc}` }))
        }
        if (_class === notification.class.DocNotifyContext) {
          contextLookups++
          if (contextLookups === 2) throw new Error('context lookup failed')
          return []
        }
        return world(_class, q)
      }
    }
    const dateTx = control.txFactory.createTxUpdateDoc(tracker.class.Issue, HOME, 'issueB', { dueDate: 10 })
    const requestTx = control.txFactory.createTxCreateDoc(tracker.class.DependencyShiftRequest, HOME, {
      triggerIssueId: 'issueA',
      shiftedIssues: [{ issueId: 'issueB' }]
    })
    control.txes = [dateTx, requestTx]

    const result = await OnDependencyShiftRequest([requestTx], control)

    expect(contextLookups).toBe(2)
    expect(result).toEqual([expect.objectContaining({ _class: core.class.TxRemoveDoc, objectId: requestTx.objectId })])
    expect(control.contextCache.has('notification:provider-coverage')).toBe(false)
  })
})

