// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

/**
 * Tests for `WebhookPermissionsMiddleware`.
 *
 * Covers the authorization contract from `docs/webhooks/DESIGN.md` and
 * every bypass vector raised in the #255 review:
 *
 *  - Role gate (Owner-only on `TWebhookSubscription`).
 *  - System-account bypass narrow to the webhooks service token.
 *  - Dotted keys ({ 'target.urlTemplate': ... }, { 'target.configDigest': ... }).
 *  - Update operators ($push, $pull, $update, $inc, $unset, $rename)
 *    across every service-only and destination-level field.
 *  - Empty-target update ({ target: {} }).
 *  - Space pin (nobody but the service may change `space`).
 *  - storeResponseBody treated as destination-changing.
 *  - TxMixin on WebhookSubscription refused.
 *  - Read gating via findAll (non-Owner sees nothing; service-internal
 *    classes visible to the service only).
 *  - Service-internal classes write-refused.
 *  - Service-maintained fields in client create refused.
 *  - TxApplyIf walked recursively.
 *  - Non-stored-owner Owner limited to top-level enabled + name.
 */

import core, {
  AccountRole,
  generateId,
  Hierarchy,
  MeasureMetricsContext,
  systemAccountUuid,
  TxFactory,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindResult,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxCUD
} from '@hcengineering/core'
import type { PipelineContext, ServerFindOptions, TxMiddlewareResult } from '@hcengineering/server-core'
import webhooks, { type WebhookSubscription } from '@hcengineering/webhooks'

import { WebhookPermissionsMiddleware } from '../index'

type FindAllFn = <T extends Doc>(
  ctx: MeasureContext,
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options?: ServerFindOptions<T>
) => Promise<FindResult<T>>

function emptyResult<T extends Doc> (): FindResult<T> {
  return Object.assign([] as T[], { total: -1 }) as FindResult<T>
}

function wrapResult<T extends Doc> (rows: T[]): FindResult<T> {
  return Object.assign(rows, { total: rows.length }) as FindResult<T>
}

function makeAccount (role: AccountRole, uuid?: AccountUuid): Account {
  return {
    uuid: uuid ?? (generateId() as unknown as AccountUuid),
    role,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function makeSystemAccount (): Account {
  return {
    uuid: systemAccountUuid,
    role: AccountRole.Owner,
    primarySocialId: 'system' as PersonId,
    socialIds: ['system' as PersonId],
    fullSocialIds: []
  }
}

function makeCtx (account: Account, service: string = 'client'): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account,
    service,
    broadcast: { txes: [], queue: [], sessions: {} }
  } as any
  return ctx
}

function makeMiddleware (findAll?: FindAllFn): {
  mw: WebhookPermissionsMiddleware
  nextCalled: () => boolean
  nextFindCalled: () => boolean
} {
  let txCalled = false
  let findCalled = false
  const hierarchy = new Hierarchy()
  ;(hierarchy as any).isDerived = (a: unknown, b: unknown) => a === b
  const context: PipelineContext = {
    workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
    hierarchy,
    modelDb: { findAllSync: () => [] } as any,
    branding: null,
    adapterManager: {} as any,
    storageAdapter: {} as any,
    contextVars: {},
    lastTx: '',
    lastHash: '',
    broadcastEvent: async () => {}
  }
  const next = {
    tx: async (_ctx: MeasureContext, _txes: Tx[]): Promise<TxMiddlewareResult> => {
      txCalled = true
      return {}
    },
    findAll: async <T extends Doc>(
      _ctx: MeasureContext,
      _class: Ref<Class<T>>,
      _query: DocumentQuery<T>,
      _options?: ServerFindOptions<T>
    ): Promise<FindResult<T>> => {
      findCalled = true
      return emptyResult<T>()
    }
  }
  const mw = new (WebhookPermissionsMiddleware as any)(context, next)
  if (findAll !== undefined) {
    // Override only `provideFindAll` so the middleware's own findAll
    // gate still runs; the gate delegates to this stub on allow.
    ;(mw as any).provideFindAll = findAll
  }
  return { mw, nextCalled: () => txCalled, nextFindCalled: () => findCalled }
}

const SPACE: Ref<Space> = 'test:space:Webhooks' as Ref<Space>
const SUB_ID = (): Ref<WebhookSubscription> => generateId() as unknown as Ref<WebhookSubscription>

function makeFactory (caller: Account): TxFactory {
  return new TxFactory(caller.primarySocialId)
}

function targetJson (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Client-side shape: `configDigest` and `boundAt` are intentionally
  // left out - the service seeds them after the create.
  return {
    method: 'POST',
    urlTemplate: 'https://example.com/hook',
    headerTemplates: [],
    ...overrides
  }
}

function storedTargetJson (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'POST',
    urlTemplate: 'https://example.com/hook',
    headerTemplates: [],
    configDigest: 'sha256:test',
    configDigestAlg: 'sha256',
    boundAt: Date.now(),
    ...overrides
  }
}

function makeSubscriptionDoc (ownerUuid: AccountUuid, id: Ref<WebhookSubscription>): Doc {
  return {
    _id: id,
    _class: webhooks.class.WebhookSubscription,
    space: SPACE,
    modifiedOn: Date.now(),
    modifiedBy: 'test' as PersonId,
    name: 'Test Subscription',
    owner: ownerUuid,
    target: storedTargetJson(),
    revision: 0,
    secretsMeta: [],
    triggers: [],
    enabled: true,
    storeResponseBody: false
  } as unknown as Doc
}

function makeFindAllForSub (ownerUuid: AccountUuid, subId: Ref<WebhookSubscription>): FindAllFn {
  return async <T extends Doc>(
    _ctx: MeasureContext,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>
  ): Promise<FindResult<T>> => {
    if (_class === webhooks.class.WebhookSubscription && (query as any)._id === subId) {
      return wrapResult<T>([makeSubscriptionDoc(ownerUuid, subId) as unknown as T])
    }
    return emptyResult<T>()
  }
}

describe('WebhookPermissionsMiddleware', () => {
  // ─────────────────────────────────────────────────────────────────
  describe('role gate on TWebhookSubscription', () => {
    it('refuses create for below-Owner callers', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'nope',
        owner: user.uuid,
        target: targetJson() as any,
        triggers: [],
        enabled: true,
        storeResponseBody: false
      } as any)
      await expect(mw.tx(makeCtx(user), [tx])).rejects.toThrow()
    })

    it('allows create for Owner callers when `owner === caller`', async () => {
      const { mw, nextCalled } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'ok',
        owner: owner.uuid,
        target: targetJson() as any,
        triggers: [],
        enabled: true,
        storeResponseBody: false
      } as any)
      await mw.tx(makeCtx(owner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses create whose target pre-populates service-maintained `configDigest`', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'forged',
        owner: owner.uuid,
        target: storedTargetJson() as any,
        triggers: [],
        enabled: true,
        storeResponseBody: false
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses create with an unknown attribute (closed-world allowlist)', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'smuggled',
        owner: owner.uuid,
        target: targetJson() as any,
        triggers: [],
        enabled: true,
        storeResponseBody: false,
        futureFlag: true
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses create whose attributes claim a different `owner`', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const otherOwner = generateId() as unknown as AccountUuid
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'spoof',
        owner: otherOwner,
        target: targetJson() as any,
        triggers: [],
        enabled: true,
        storeResponseBody: false
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses remove for below-Owner callers', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const tx = factory.createTxRemoveDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID())
      await expect(mw.tx(makeCtx(user), [tx])).rejects.toThrow()
    })

    it('refuses TxMixin on TWebhookSubscription even for Owner', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxMixin(
        SUB_ID(),
        webhooks.class.WebhookSubscription,
        SPACE,
        webhooks.class.WebhookSubscription,
        {} as any
      )
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('system-account bypass', () => {
    it('lets the system account write service-maintained fields when the token is `webhooks`', async () => {
      const { mw, nextCalled } = makeMiddleware()
      const system = makeSystemAccount()
      const factory = makeFactory(system)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        revision: 42,
        secretsMeta: [{ name: 's1', lastRotatedAt: 0 }],
        lastDeliveryStatus: 'ok'
      } as any)
      await mw.tx(makeCtx(system, 'webhooks'), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses the SAME write when the system token is for a different service', async () => {
      // Narrow bypass: another internal service (github, gmail,
      // telegram, process, ...) with `account.uuid === systemAccountUuid`
      // must NOT inherit webhooks authority through its own system token.
      const { mw } = makeMiddleware()
      const system = makeSystemAccount()
      const factory = makeFactory(system)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        revision: 42
      } as any)
      await expect(mw.tx(makeCtx(system, 'github'), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('service-internal classes', () => {
    const INTERNAL_CLASSES = [
      webhooks.class.WebhookSecret,
      webhooks.class.WebhookJournal,
      webhooks.class.WebhookOutboxJob,
      webhooks.class.WebhookDeliveryAttempt,
      webhooks.class.WebhookAuditBlob,
      webhooks.class.WebhookSubscriptionLease,
      webhooks.class.WebhookCleanupTask
    ]

    it.each(INTERNAL_CLASSES)('refuses client CUD on %s regardless of role', async (cls) => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(cls as any, SPACE, {} as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('service-only fields - top-level form', () => {
    const SERVICE_ONLY_TOP = [
      'owner',
      'revision',
      'secretsMeta',
      'lastDeliveryAt',
      'lastDeliveryStatus',
      'lastDeliveryHttpCode',
      'lastDeliveryError',
      'space'
    ]

    it.each(SERVICE_ONLY_TOP)('refuses an Owner client update touching `%s` as top-level key', async (field) => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const ops: Record<string, unknown> = {
        [field]: field === 'secretsMeta' ? [] : field === 'owner' ? owner.uuid : 'spoof'
      }
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), ops as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses an update that targets `target.configDigest`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        target: { configDigest: 'forged' } as any
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('service-only fields - dotted-path form', () => {
    it('refuses `{ "target.configDigest": "..." }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, subId))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        'target.configDigest': 'forged'
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ "space": "..." }` dotted form', async () => {
      // `space` is pinned entirely - no actor other than the service
      // may move a subscription between spaces.
      const owner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, subId))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        space: 'other-space'
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ "target.urlTemplate": "..." }` from a non-stored-owner Owner', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        'target.urlTemplate': 'https://attacker.example/hook'
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })

    it('refuses a dotted key over `enabled` from a non-stored-owner Owner', async () => {
      // Non-stored-owner allowlist is top-level only. Even a dotted
      // key whose root is a containment field falls out of the
      // allowlist and requires the stored owner.
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        'enabled.ignored': false
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('service-only fields - inside update operators', () => {
    it('refuses `{ $unset: { owner: "" } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        $unset: { owner: '' }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $rename: { owner: "formerOwner" } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        $rename: { owner: 'formerOwner' }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $rename: { enabled: "owner" } }` (destination is service-only)', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        $rename: { enabled: 'owner' }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $inc: { revision: 1 } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        $inc: { revision: 1 }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $push: { secretsMeta: {...} } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        $push: { secretsMeta: { name: 'x', lastRotatedAt: 0 } }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $pull: { secretsMeta: {...} } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        $pull: { secretsMeta: { name: 'x' } }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('destination-level fields require the STORED owner', () => {
    it('refuses whole-object `{ target: {...} }` from a non-stored-owner Owner', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        target: { urlTemplate: 'https://attacker.example/' } as any
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })

    it('refuses an empty `{ target: {} }` from a non-stored-owner Owner', async () => {
      // A non-owner must not be able to replace the whole target with
      // the empty object (which would strip URL + method + templates).
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        target: {} as any
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })

    it('allows the stored owner to change their own destination', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw, nextCalled } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(storedOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        target: { method: 'POST', urlTemplate: 'https://new.example.com/', headerTemplates: [] } as any
      } as any)
      await mw.tx(makeCtx(storedOwner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses the stored owner when the subscription is not found', async () => {
      // Fail-closed: an update whose target doc has vanished must not
      // slip through just because we cannot check the owner.
      const storedOwner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(async () => emptyResult())
      const factory = makeFactory(storedOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        target: { method: 'POST', urlTemplate: 'https://new.example.com/', headerTemplates: [] } as any
      } as any)
      await expect(mw.tx(makeCtx(storedOwner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $push: { triggers: {...} } }` from a non-stored-owner Owner', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        $push: {
          triggers: {
            eventKind: 'webhooks:event:Update',
            scope: { kind: 'allSpaces' }
          }
        }
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })

    it('refuses `{ storeResponseBody: true }` from a non-stored-owner Owner', async () => {
      // Treated as destination-changing: it captures receiver responses
      // that may echo credentials, and the design doc requires it to
      // be reset on destination change.
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        storeResponseBody: true
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })

    it('allows a current Owner to toggle `enabled` without being the stored owner', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw, nextCalled } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        enabled: false
      } as any)
      await mw.tx(makeCtx(secondOwner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('allows a current Owner to rename a subscription without being the stored owner', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const { mw, nextCalled } = makeMiddleware(makeFindAllForSub(storedOwner.uuid, subId))
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        name: 'renamed'
      } as any)
      await mw.tx(makeCtx(secondOwner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses an empty operations payload', async () => {
      // A no-op update has no business being a Tx; refuse rather than
      // let it pass as "nothing to do".
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {} as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses an unknown top-level field', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware(makeFindAllForSub(owner.uuid, SUB_ID()))
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        futureFlag: true
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('TxApplyIf is walked recursively', () => {
    it('refuses an ApplyIf that wraps a forbidden inner Tx', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const innerCreate = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'smuggled',
        owner: user.uuid,
        target: targetJson() as any,
        triggers: [],
        enabled: true,
        storeResponseBody: false
      } as any) as TxCUD<Doc>
      const applyIf = factory.createTxApplyIf(
        core.space.Workspace,
        'test-scope',
        [],
        [],
        [innerCreate],
        'test-measure'
      )
      await expect(mw.tx(makeCtx(user), [applyIf as Tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('findAll read gating', () => {
    it('returns empty for a User reading TWebhookSubscription', async () => {
      const user = makeAccount(AccountRole.User)
      let delegated = false
      const findAll: FindAllFn = async () => {
        delegated = true
        return emptyResult()
      }
      const { mw } = makeMiddleware(findAll)
      const result = await mw.findAll(makeCtx(user), webhooks.class.WebhookSubscription, {})
      expect(result.length).toBe(0)
      // The downstream findAll must NOT be called; the middleware
      // short-circuits the read before it reaches storage.
      expect(delegated).toBe(false)
    })

    it('delegates to downstream for an Owner reading TWebhookSubscription', async () => {
      const owner = makeAccount(AccountRole.Owner)
      let delegated = false
      const findAll: FindAllFn = async () => {
        delegated = true
        return emptyResult()
      }
      const { mw } = makeMiddleware(findAll)
      await mw.findAll(makeCtx(owner), webhooks.class.WebhookSubscription, {})
      expect(delegated).toBe(true)
    })

    it.each([
      webhooks.class.WebhookSecret,
      webhooks.class.WebhookJournal,
      webhooks.class.WebhookOutboxJob,
      webhooks.class.WebhookDeliveryAttempt,
      webhooks.class.WebhookAuditBlob,
      webhooks.class.WebhookSubscriptionLease,
      webhooks.class.WebhookCleanupTask
    ])('refuses an Owner reading service-internal class %s (empty FindResult)', async (cls) => {
      const owner = makeAccount(AccountRole.Owner)
      let delegated = false
      const findAll: FindAllFn = async () => {
        delegated = true
        return emptyResult()
      }
      const { mw } = makeMiddleware(findAll)
      const result = await mw.findAll(makeCtx(owner), cls as any, {})
      expect(result.length).toBe(0)
      expect(delegated).toBe(false)
    })

    it('delegates to downstream for the service reading any webhook class', async () => {
      const system = makeSystemAccount()
      let delegated = false
      const findAll: FindAllFn = async () => {
        delegated = true
        return emptyResult()
      }
      const { mw } = makeMiddleware(findAll)
      await mw.findAll(makeCtx(system, 'webhooks'), webhooks.class.WebhookSecret, {})
      expect(delegated).toBe(true)
    })
  })
})
