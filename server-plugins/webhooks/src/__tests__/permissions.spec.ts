// SPDX-License-Identifier: EPL-2.0
//
// Copyright © 2026 Platform Collective Contributors
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

/**
 * Tests for `WebhookPermissionsMiddleware` (rev 6).
 *
 * Rev 6 shape: destination-level writes are refused for every client,
 * including the stored owner. The management RPC (service-authored)
 * is the only write path. Containment-only writes (`enabled`, `name`)
 * stay allowed for current Owners. `TWebhookSubscription` is pinned
 * to `webhooks.space.Webhooks`. Read-side gating keeps class-level
 * refusal AND adds a Tx-history gate.
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
  type Tx,
  type TxCUD
} from '@hcengineering/core'
import type { PipelineContext, ServerFindOptions, TxMiddlewareResult } from '@hcengineering/server-core'
import webhooks from '@hcengineering/webhooks'

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
    ;(mw as any).provideFindAll = findAll
  }
  return { mw, nextCalled: () => txCalled, nextFindCalled: () => findCalled }
}

const WEBHOOKS_SPACE = webhooks.space.Webhooks
const SUB_ID = (): Ref<Doc> => generateId() as unknown as Ref<Doc>

function makeFactory (caller: Account): TxFactory {
  return new TxFactory(caller.primarySocialId)
}

describe('WebhookPermissionsMiddleware (rev 6)', () => {
  // ─────────────────────────────────────────────────────────────────
  describe('create: role gate + space pin + attribute allowlist', () => {
    it('refuses create for below-Owner callers', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, {
        name: 'nope',
        owner: user.uuid,
        enabled: true
      } as any)
      await expect(mw.tx(makeCtx(user), [tx])).rejects.toThrow()
    })

    it('allows create for Owner callers with only containment attributes + owner', async () => {
      const { mw, nextCalled } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, {
        name: 'ok',
        owner: owner.uuid,
        enabled: true
      } as any)
      await mw.tx(makeCtx(owner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses create outside webhooks.space.Webhooks', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, core.space.Workspace, {
        name: 'wrong-space',
        owner: owner.uuid,
        enabled: true
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses create pre-populating a destination field', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, {
        name: 'forged',
        owner: owner.uuid,
        enabled: true,
        target: { method: 'POST', urlTemplate: 'https://attacker.example/' }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses create pre-populating `triggers`', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, {
        name: 'forged',
        owner: owner.uuid,
        enabled: true,
        triggers: []
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses create with an unknown attribute (closed-world)', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, {
        name: 'smuggled',
        owner: owner.uuid,
        enabled: true,
        futureFlag: true
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses create whose attributes claim a different `owner`', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const otherOwner = generateId() as unknown as AccountUuid
      const factory = makeFactory(owner)
      const tx = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, {
        name: 'spoof',
        owner: otherOwner,
        enabled: true
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses remove for below-Owner callers', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const tx = factory.createTxRemoveDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID())
      await expect(mw.tx(makeCtx(user), [tx])).rejects.toThrow()
    })

    it('refuses TxMixin on TWebhookSubscription', async () => {
      const { mw } = makeMiddleware()
      const owner = makeAccount(AccountRole.Owner)
      const factory = makeFactory(owner)
      const tx = factory.createTxMixin(
        SUB_ID(),
        webhooks.class.WebhookSubscription,
        WEBHOOKS_SPACE,
        webhooks.class.WebhookSubscription,
        {} as any
      )
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('system-account bypass', () => {
    it('allows the webhooks service to write service-only fields', async () => {
      const { mw, nextCalled } = makeMiddleware()
      const system = makeSystemAccount()
      const factory = makeFactory(system)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        revision: 42,
        target: { method: 'POST', urlTemplate: 'https://new.example/' } as any,
        storeResponseBody: true
      } as any)
      await mw.tx(makeCtx(system, 'webhooks'), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses the SAME write under a different system service token', async () => {
      // github, gmail, telegram, process must NOT inherit webhooks
      // authority through their own system tokens.
      const { mw } = makeMiddleware()
      const system = makeSystemAccount()
      const factory = makeFactory(system)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
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
      const tx = factory.createTxCreateDoc(cls as any, WEBHOOKS_SPACE, {} as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('update: service-only fields in every form', () => {
    const SERVICE_ONLY_TOP = [
      'space',
      'owner',
      'revision',
      'secretsMeta',
      'lastDeliveryAt',
      'lastDeliveryStatus',
      'lastDeliveryHttpCode',
      'lastDeliveryError',
      'target',
      'triggers',
      'retryPolicy',
      'storeResponseBody'
    ]

    it.each(SERVICE_ONLY_TOP)('refuses an Owner update targeting `%s`', async (field) => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const ops: Record<string, unknown> = {}
      switch (field) {
        case 'secretsMeta':
          ops[field] = []
          break
        case 'owner':
          ops[field] = owner.uuid
          break
        case 'storeResponseBody':
          ops[field] = true
          break
        case 'target':
          ops[field] = { method: 'POST', urlTemplate: 'https://example' }
          break
        case 'triggers':
        case 'retryPolicy':
          ops[field] = []
          break
        default:
          ops[field] = 'spoof'
      }
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), ops as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ "target.urlTemplate": "..." }` (dotted path)', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        'target.urlTemplate': 'https://attacker.example/'
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ "target.configDigest": "..." }` (dotted path to service-only field)', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        'target.configDigest': 'forged'
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ "space": "..." }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        space: 'other-space'
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $unset: { owner: "" } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $unset: { owner: '' }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $rename: { owner: "formerOwner" } }` (source service-only)', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $rename: { owner: 'formerOwner' }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $rename: { enabled: "owner" } }` (destination service-only)', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $rename: { enabled: 'owner' }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $inc: { revision: 1 } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $inc: { revision: 1 }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $push: { secretsMeta: {...} } }`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $push: { secretsMeta: { name: 'x', lastRotatedAt: 0 } }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ $push: { triggers: {...} } }` (destination-level)', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $push: {
          triggers: {
            eventKind: 'webhooks:eventSource:Update',
            scope: { kind: 'allSpaces' }
          }
        }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ target: {} }` empty-replace', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        target: {} as any
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses `{ storeResponseBody: true }` from any Owner (destination-level)', async () => {
      // Rev 6: `storeResponseBody` moved from containment to
      // destination-level; the management RPC owns it.
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        storeResponseBody: true
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('update: containment allowlist', () => {
    it('allows `{ enabled: false }` from an Owner', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw, nextCalled } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        enabled: false
      } as any)
      await mw.tx(makeCtx(owner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('allows `{ name: "renamed" }` from an Owner', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw, nextCalled } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        name: 'renamed'
      } as any)
      await mw.tx(makeCtx(owner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('allows `{ enabled: false, name: "x" }` from an Owner', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw, nextCalled } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        enabled: false,
        name: 'x'
      } as any)
      await mw.tx(makeCtx(owner), [tx])
      expect(nextCalled()).toBe(true)
    })

    it('refuses a dotted key over `enabled`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        'enabled.ignored': false
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses an operator form of `enabled`', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $inc: { enabled: 1 }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses empty operations payload', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {} as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses an unknown top-level field', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        futureFlag: true
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })

    it('refuses an unknown $-operator (e.g. $set)', async () => {
      const owner = makeAccount(AccountRole.Owner)
      const { mw } = makeMiddleware()
      const factory = makeFactory(owner)
      const tx = factory.createTxUpdateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, SUB_ID(), {
        $set: { enabled: false }
      } as any)
      await expect(mw.tx(makeCtx(owner), [tx])).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────
  describe('TxApplyIf walked recursively', () => {
    it('refuses an ApplyIf wrapping a forbidden inner Tx', async () => {
      const { mw } = makeMiddleware()
      const user = makeAccount(AccountRole.User)
      const factory = makeFactory(user)
      const innerCreate = factory.createTxCreateDoc(webhooks.class.WebhookSubscription, WEBHOOKS_SPACE, {
        name: 'smuggled',
        owner: user.uuid,
        enabled: true
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
    ])('refuses an Owner reading service-internal class %s', async (cls) => {
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

    it('refuses an Owner reading core.class.Tx with a webhook objectClass filter', async () => {
      // Rev 6: Tx-history gate. A query on core.class.Tx filtered
      // by a webhook objectClass must not leak URL / header
      // templates via the create/update Tx bodies.
      const owner = makeAccount(AccountRole.Owner)
      let delegated = false
      const findAll: FindAllFn = async () => {
        delegated = true
        return emptyResult()
      }
      const { mw } = makeMiddleware(findAll)
      const result = await mw.findAll(makeCtx(owner), core.class.Tx, {
        objectClass: webhooks.class.WebhookSubscription
      } as any)
      expect(result.length).toBe(0)
      expect(delegated).toBe(false)
    })

    it('refuses an Owner reading core.class.Tx with $in webhook objectClass filter', async () => {
      const owner = makeAccount(AccountRole.Owner)
      let delegated = false
      const findAll: FindAllFn = async () => {
        delegated = true
        return emptyResult()
      }
      const { mw } = makeMiddleware(findAll)
      const result = await mw.findAll(makeCtx(owner), core.class.Tx, {
        objectClass: { $in: [webhooks.class.WebhookSecret] }
      } as any)
      expect(result.length).toBe(0)
      expect(delegated).toBe(false)
    })

    it('delegates core.class.Tx for the service', async () => {
      const system = makeSystemAccount()
      let delegated = false
      const findAll: FindAllFn = async () => {
        delegated = true
        return emptyResult()
      }
      const { mw } = makeMiddleware(findAll)
      await mw.findAll(makeCtx(system, 'webhooks'), core.class.Tx, {
        objectClass: webhooks.class.WebhookSubscription
      } as any)
      expect(delegated).toBe(true)
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
