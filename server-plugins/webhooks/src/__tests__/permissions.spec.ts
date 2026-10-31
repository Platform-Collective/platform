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
 * Covers the authorization contract that `docs/webhooks/DESIGN.md` rev 4
 * promises:
 *
 *  - Owner-only on `TWebhookSubscription` CUD.
 *  - System-account bypass (how the service writes service-maintained
 *    fields).
 *  - No client Tx on `TWebhookSecret` or the other service-internal
 *    classes.
 *  - Service-maintained fields read-only to clients.
 *  - Destination-changing fields require the STORED owner, not just any
 *    current workspace Owner.
 *  - `TxApplyIf` walked recursively so a forbidden Tx cannot be
 *    smuggled through a collection.
 *  - Create requires `owner === caller`.
 *  - `enabled` + `name` toggles pass for any current Owner (containment
 *    only, no destination change).
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
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxCUD
} from '@hcengineering/core'
import type { PipelineContext, TxMiddlewareResult } from '@hcengineering/server-core'
import webhooks, { type WebhookSubscription } from '@hcengineering/webhooks'

import { WebhookPermissionsMiddleware } from '../index'

type FindAllFn = (
  ctx: MeasureContext,
  _class: Ref<Class<Doc>>,
  query: Record<string, unknown>,
  options?: Record<string, unknown>
) => Promise<Doc[]>

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

function makeCtx (account: Account): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account,
    broadcast: { txes: [], queue: [], sessions: {} }
  } as any
  return ctx
}

function makeMiddleware (findAll?: FindAllFn): {
  mw: WebhookPermissionsMiddleware
  nextCalled: () => boolean
} {
  let called = false
  const hierarchy = new Hierarchy()
  // Patch isDerived to an identity check: tests pass the webhook class
  // refs directly, no sub-classing is involved.
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
      called = true
      return {}
    }
  }
  const mw = new (WebhookPermissionsMiddleware as any)(context, next)
  if (findAll !== undefined) {
    ;(mw as any).findAll = findAll
  }
  return { mw, nextCalled: () => called }
}

const SPACE: Ref<Space> = 'test:space:Webhooks' as Ref<Space>
const SUB_ID = (): Ref<WebhookSubscription> => generateId() as unknown as Ref<WebhookSubscription>

function makeFactory (caller: Account): TxFactory {
  return new TxFactory(caller.primarySocialId)
}

function targetJson (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Client-side shape: `configDigest` and `boundAt` are intentionally
  // left out — the service seeds them after the create. The permission
  // middleware refuses a client-authored create that pre-populates them.
  return {
    method: 'POST',
    urlTemplate: 'https://example.com/hook',
    headerTemplates: [],
    ...overrides
  }
}

function storedTargetJson (overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Shape of a target that has been through the service bind step; used
  // when a test seeds a stored subscription for the destination-owner
  // check.
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

describe('WebhookPermissionsMiddleware', () => {
  describe('role gate on TWebhookSubscription', () => {
    it('refuses create for below-Owner callers', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'nope',
        owner: user.uuid,
        target: targetJson() as any,
        revision: 0,
        secretsMeta: [],
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
        revision: 0,
        secretsMeta: [],
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
        revision: 0,
        secretsMeta: [],
        triggers: [],
        enabled: true,
        storeResponseBody: false
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
        revision: 0,
        secretsMeta: [],
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
  })

  describe('system account bypass', () => {
    it('lets the system account write service-maintained fields', async () => {
      const { mw, nextCalled } = makeMiddleware()
      const system = makeSystemAccount()
      const factory = makeFactory(system)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        revision: 42,
        secretsMeta: [{ name: 's1', lastRotatedAt: 0 }],
        lastDeliveryStatus: 'ok'
      } as any)
      await mw.tx(makeCtx(system), [tx])
      expect(nextCalled()).toBe(true)
    })
  })

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

  describe('service-maintained fields on TWebhookSubscription updates', () => {
    const PROTECTED_FIELDS = [
      'owner',
      'revision',
      'secretsMeta',
      'lastDeliveryAt',
      'lastDeliveryStatus',
      'lastDeliveryHttpCode',
      'lastDeliveryError'
    ]

    it.each(PROTECTED_FIELDS)('refuses an Owner client update touching `%s`', async (field) => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const ops: Record<string, unknown> = { [field]: field === 'secretsMeta' ? [] : (field === 'owner' ? owner.uuid : 'spoof') }
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), ops as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses an update that targets `target.configDigest`', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        target: { configDigest: 'forged' } as any
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  describe('destination-changing fields require the STORED owner', () => {
    it('refuses a second Owner changing the first Owner\'s destination', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const findAll: FindAllFn = async (_ctx, _class, query) => {
        if (_class === webhooks.class.WebhookSubscription && (query as any)._id === subId) {
          return [makeSubscriptionDoc(storedOwner.uuid, subId)]
        }
        return []
      }
      const { mw } = makeMiddleware(findAll)
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        target: { urlTemplate: 'https://attacker.example.com/' } as any
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })

    it('allows the stored owner to change their own destination', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const findAll: FindAllFn = async (_ctx, _class, query) => {
        if (_class === webhooks.class.WebhookSubscription && (query as any)._id === subId) {
          return [makeSubscriptionDoc(storedOwner.uuid, subId)]
        }
        return []
      }
      const { mw, nextCalled } = makeMiddleware(findAll)
      const factory = makeFactory(storedOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        target: { urlTemplate: 'https://new.example.com/' } as any
      } as any)
      await mw.tx(makeCtx(storedOwner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses the stored owner too when the subscription is not found', async () => {
      // Fail-closed: an update whose target doc has vanished (concurrent
      // delete, mis-typed id) must not slip through just because we
      // can't check the owner.
      const storedOwner = makeAccount(AccountRole.Owner)
      const findAll: FindAllFn = async () => []
      const { mw } = makeMiddleware(findAll)
      const factory = makeFactory(storedOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, SUB_ID(), {
        target: { urlTemplate: 'https://new.example.com/' } as any
      } as any)
      await expect(mw.tx(makeCtx(storedOwner), [tx])).rejects.toThrow()
    })

    it('allows a current Owner to toggle `enabled` without being the stored owner', async () => {
      // Containment: any current Owner can disable or enable any
      // subscription in their workspace. Only destination change needs
      // the stored owner.
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const findAll: FindAllFn = async (_ctx, _class, query) => {
        if (_class === webhooks.class.WebhookSubscription && (query as any)._id === subId) {
          return [makeSubscriptionDoc(storedOwner.uuid, subId)]
        }
        return []
      }
      const { mw, nextCalled } = makeMiddleware(findAll)
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        enabled: false
      } as any)
      await mw.tx(makeCtx(secondOwner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('treats a `triggers` change as destination-changing', async () => {
      const storedOwner = makeAccount(AccountRole.Owner)
      const secondOwner = makeAccount(AccountRole.Owner)
      const subId = SUB_ID()
      const findAll: FindAllFn = async (_ctx, _class, query) => {
        if (_class === webhooks.class.WebhookSubscription && (query as any)._id === subId) {
          return [makeSubscriptionDoc(storedOwner.uuid, subId)]
        }
        return []
      }
      const { mw } = makeMiddleware(findAll)
      const factory = makeFactory(secondOwner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, SPACE, subId, {
        triggers: []
      } as any)
      await expect(mw.tx(makeCtx(secondOwner), [tx])).rejects.toThrow()
    })
  })

  describe('TxApplyIf is walked recursively', () => {
    it('refuses an ApplyIf that wraps a forbidden inner Tx', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const innerCreate = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, SPACE, {
        name: 'smuggled',
        owner: user.uuid,
        target: targetJson() as any,
        revision: 0,
        secretsMeta: [],
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
})
