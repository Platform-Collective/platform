// SPDX-License-Identifier: EPL-2.0

import {
  AccountRole,
  generateId,
  Hierarchy,
  MeasureMetricsContext,
  TxFactory,
  type Account,
  type Class,
  type Doc,
  type Domain,
  type MeasureContext,
  type Mixin,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx
} from '@hcengineering/core'
import type { PipelineContext } from '@hcengineering/server-core'
import { PluginConfigurationMiddleware } from '../pluginConfig'

const OWNER_ONLY_CLASS = 'test:class:OwnerOnly' as Ref<Class<Doc>>
const GUEST_CLASS = 'test:class:GuestLevel' as Ref<Class<Doc>>
const PLAIN_CLASS = 'test:class:Plain' as Ref<Class<Doc>>
const OTHER_DOMAIN_CLASS = 'test:class:OtherDomain' as Ref<Class<Doc>>

function makeAccount (role: AccountRole): Account {
  return {
    uuid: generateId() as any,
    role,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function makeCtx (account: Account): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = { account, broadcast: { txes: [], queue: [], sessions: {} } } as any
  return ctx
}

const SETTING_DOMAIN = 'test-setting' as Domain
const OTHER_DOMAIN = 'test-other' as Domain

const FIXED_CLASS = 'notification:class:WorkspaceNotificationTypeSetting' as Ref<Class<Doc>>
const FIXED_DERIVED_CLASS = 'test:class:DerivedWorkspaceNotificationTypeSetting' as Ref<Class<Doc>>

// Mutable model access levels, used to simulate changed model metadata
const modelAccessLevels = new Map<Ref<Class<Doc>>, any>()

function makeMiddleware (onNext: () => void, storedDocs: Doc[] = []): PluginConfigurationMiddleware {
  const hierarchy = new Hierarchy()
  ;(hierarchy as any).classHierarchyMixin = (_class: Ref<Class<Doc>>) => {
    if (modelAccessLevels.has(_class)) return modelAccessLevels.get(_class)
    if (_class === OWNER_ONLY_CLASS) {
      return {
        createAccessLevel: AccountRole.Owner,
        updateAccessLevel: AccountRole.Owner,
        removeAccessLevel: AccountRole.Owner
      }
    }
    if (_class === GUEST_CLASS) {
      return { createAccessLevel: AccountRole.Guest }
    }
    return undefined
  }
  ;(hierarchy as any).getDescendants = () => [
    OWNER_ONLY_CLASS,
    GUEST_CLASS,
    PLAIN_CLASS,
    OTHER_DOMAIN_CLASS,
    FIXED_CLASS,
    FIXED_DERIVED_CLASS
  ]
  ;(hierarchy as any).hasClass = () => true
  ;(hierarchy as any).findDomain = (_class: Ref<Class<Doc>>) =>
    _class === OTHER_DOMAIN_CLASS ? OTHER_DOMAIN : SETTING_DOMAIN
  ;(hierarchy as any).isDerived = (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) =>
    a === b || (a === FIXED_DERIVED_CLASS && b === FIXED_CLASS)
  const lowLevelStorage = {
    rawFindAll: async (domain: Domain, query: any) =>
      domain === SETTING_DOMAIN ? storedDocs.filter((it) => it._id === query._id) : []
  }
  const context = { hierarchy, lowLevelStorage } as unknown as PipelineContext
  const next = {
    tx: async () => {
      onNext()
      return {}
    }
  }
  return new (PluginConfigurationMiddleware as any)(context, next)
}

const factory = new TxFactory('test' as PersonId)
const space = 'core:space:Workspace' as Ref<Space>

function txes (_class: Ref<Class<Doc>>, id: Ref<Doc> = generateId<Doc>()): Tx[] {
  return [
    factory.createTxCreateDoc(_class, space, {}),
    factory.createTxUpdateDoc(_class, space, id, { enabled: true } as any),
    factory.createTxRemoveDoc(_class, space, id)
  ]
}

describe('PluginConfigurationMiddleware TxAccessLevel enforcement', () => {
  for (const role of [AccountRole.User, AccountRole.Maintainer]) {
    it(`forbids ${role} to create, update or remove owner-only documents`, async () => {
      let called = false
      const mw = makeMiddleware(() => {
        called = true
      })
      for (const tx of txes(OWNER_ONLY_CLASS)) {
        await expect(async () => await mw.tx(makeCtx(makeAccount(role)), [tx])).rejects.toThrow()
      }
      expect(called).toBe(false)
    })
  }

  it('allows owners to modify owner-only documents', async () => {
    let calls = 0
    const mw = makeMiddleware(() => {
      calls++
    })
    for (const tx of txes(OWNER_ONLY_CLASS)) {
      await mw.tx(makeCtx(makeAccount(AccountRole.Owner)), [tx])
    }
    expect(calls).toBe(3)
  })

  it('does not change behaviour for guest-level or unrestricted classes', async () => {
    let calls = 0
    const mw = makeMiddleware(() => {
      calls++
    })
    for (const tx of [...txes(GUEST_CLASS), ...txes(PLAIN_CLASS)]) {
      await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])
    }
    expect(calls).toBe(6)
  })

  it('checks transactions nested in apply', async () => {
    const mw = makeMiddleware(() => {})
    const apply = factory.createTxApplyIf(space, generateId(), [], [], [txes(OWNER_ONLY_CLASS)[0] as any], 'test')
    await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.User)), [apply])).rejects.toThrow()
  })

  describe('the role check uses the stored class of the document', () => {
    const storedId = generateId<Doc>()
    const stored: Doc = {
      _id: storedId,
      _class: OWNER_ONLY_CLASS,
      space,
      modifiedOn: 0,
      modifiedBy: 'owner' as PersonId
    }

    function forgedTxes (): Tx[] {
      return [
        factory.createTxUpdateDoc(PLAIN_CLASS, space, storedId, { enabled: false } as any),
        factory.createTxMixin(storedId, PLAIN_CLASS, space, 'test:mixin:Any' as Ref<Mixin<Doc>>, {}),
        factory.createTxRemoveDoc(PLAIN_CLASS, space, storedId)
      ]
    }

    it('rejects update, mixin and remove sent with a different class', async () => {
      let called = false
      const mw = makeMiddleware(() => {
        called = true
      }, [stored])
      for (const tx of forgedTxes()) {
        await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])).rejects.toThrow()
      }
      expect(called).toBe(false)
    })

    it('rejects such transactions nested in apply', async () => {
      const mw = makeMiddleware(() => {}, [stored])
      for (const tx of forgedTxes()) {
        const apply = factory.createTxApplyIf(space, generateId(), [], [], [tx as any], 'test')
        await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.Maintainer)), [apply])).rejects.toThrow()
      }
    })

    it('rejects changing the class of a document in a restricted domain', async () => {
      const plainId = generateId<Doc>()
      const plain: Doc = { ...stored, _id: plainId, _class: PLAIN_CLASS }
      const mw = makeMiddleware(() => {}, [plain])
      const ops: any[] = [
        { _class: OWNER_ONLY_CLASS },
        { $rename: { targetClass: '_class' } },
        { $set: { _class: OWNER_ONLY_CLASS } },
        { $unset: { _class: true } },
        { $push: { _class: OWNER_ONLY_CLASS } },
        { $inc: { _class: 1 } }
      ]
      const forged: Tx[] = [
        ...ops.map((op) => factory.createTxUpdateDoc(PLAIN_CLASS, space, plainId, op)),
        factory.createTxMixin(
          plainId,
          PLAIN_CLASS,
          space,
          'test:mixin:Any' as Ref<Mixin<Doc>>,
          {
            $rename: { targetClass: '_class' }
          } as any
        )
      ]
      for (const tx of forged) {
        await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])).rejects.toThrow()
        const apply = factory.createTxApplyIf(space, generateId(), [], [], [tx as any], 'test')
        await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.User)), [apply])).rejects.toThrow()
      }
    })

    it('allows regular operators that do not touch the class', async () => {
      let calls = 0
      const plainId = generateId<Doc>()
      const plain: Doc = { ...stored, _id: plainId, _class: PLAIN_CLASS }
      const mw = makeMiddleware(() => {
        calls++
      }, [plain])
      const tx = factory.createTxUpdateDoc(PLAIN_CLASS, space, plainId, {
        $rename: { a: 'b' },
        $push: { items: 'x' }
      } as any)
      await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])
      expect(calls).toBe(1)
    })

    it('allows regular users to modify stored documents of unrestricted classes', async () => {
      let calls = 0
      const plainId = generateId<Doc>()
      const plain: Doc = { ...stored, _id: plainId, _class: PLAIN_CLASS }
      const mw = makeMiddleware(() => {
        calls++
      }, [plain])
      for (const tx of [...txes(PLAIN_CLASS, plainId), ...txes(OTHER_DOMAIN_CLASS, storedId)]) {
        await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])
      }
      expect(calls).toBe(6)
    })

    it('allows owners to modify the stored document', async () => {
      let calls = 0
      const mw = makeMiddleware(() => {
        calls++
      }, [stored])
      for (const tx of txes(OWNER_ONLY_CLASS, storedId)) {
        await mw.tx(makeCtx(makeAccount(AccountRole.Owner)), [tx])
      }
      expect(calls).toBe(3)
    })
  })

  describe('code-defined owner-only classes', () => {
    afterEach(() => {
      modelAccessLevels.clear()
    })

    const variants: Array<[string, any]> = [
      ['User', AccountRole.User],
      ['Guest', AccountRole.Guest],
      ['null', null],
      ['an unknown role', 'SUPERUSER']
    ]
    for (const [_class, [name, value]] of [FIXED_CLASS, FIXED_DERIVED_CLASS].flatMap((c) =>
      variants.map((v) => [c, v] as const)
    )) {
      it(`keeps ${_class} owner-only when the model access level is set to ${name}`, async () => {
        const id = generateId<Doc>()
        const stored: Doc = { _id: id, _class, space, modifiedOn: 0, modifiedBy: 'owner' as PersonId }
        let called = false
        const mw = makeMiddleware(() => {
          called = true
        }, [stored])
        const lowered = {
          createAccessLevel: value,
          updateAccessLevel: value,
          removeAccessLevel: value
        }
        modelAccessLevels.set(FIXED_CLASS, lowered)
        modelAccessLevels.set(FIXED_DERIVED_CLASS, lowered)
        const forged = [
          ...txes(_class, id),
          factory.createTxMixin(id, _class, space, 'test:mixin:Any' as Ref<Mixin<Doc>>, {}),
          factory.createTxUpdateDoc(PLAIN_CLASS, space, id, { enabled: false } as any),
          factory.createTxRemoveDoc(PLAIN_CLASS, space, id)
        ]
        for (const role of [AccountRole.User, AccountRole.Maintainer]) {
          for (const tx of forged) {
            await expect(async () => await mw.tx(makeCtx(makeAccount(role)), [tx])).rejects.toThrow()
            const apply = factory.createTxApplyIf(space, generateId(), [], [], [tx as any], 'test')
            await expect(async () => await mw.tx(makeCtx(makeAccount(role)), [apply])).rejects.toThrow()
          }
        }
        expect(called).toBe(false)
      })
    }

    for (const [name, value] of [
      ['null', null],
      ['an unknown role', 'SUPERUSER']
    ] as Array<[string, any]>) {
      it(`does not grant access when a model access level is ${name}`, async () => {
        const id = generateId<Doc>()
        const stored: Doc = { _id: id, _class: PLAIN_CLASS, space, modifiedOn: 0, modifiedBy: 'u' as PersonId }
        modelAccessLevels.set(PLAIN_CLASS, {
          createAccessLevel: value,
          updateAccessLevel: value,
          removeAccessLevel: value
        })
        let called = false
        const mw = makeMiddleware(() => {
          called = true
        }, [stored])
        const all = [
          ...txes(PLAIN_CLASS, id),
          factory.createTxMixin(id, PLAIN_CLASS, space, 'test:mixin:Any' as Ref<Mixin<Doc>>, {})
        ]
        for (const tx of all) {
          await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])).rejects.toThrow()
          const apply = factory.createTxApplyIf(space, generateId(), [], [], [tx as any], 'test')
          await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.User)), [apply])).rejects.toThrow()
        }
        expect(called).toBe(false)
      })
    }

    it('keeps the fixed requirement when the model access level is removed', async () => {
      modelAccessLevels.set(FIXED_CLASS, undefined)
      const mw = makeMiddleware(() => {})
      const tx = factory.createTxCreateDoc(FIXED_CLASS, space, {})
      await expect(async () => await mw.tx(makeCtx(makeAccount(AccountRole.User)), [tx])).rejects.toThrow()
    })

    it('allows owners to modify fixed owner-only classes', async () => {
      const id = generateId<Doc>()
      const stored: Doc = { _id: id, _class: FIXED_CLASS, space, modifiedOn: 0, modifiedBy: 'owner' as PersonId }
      let calls = 0
      const mw = makeMiddleware(() => {
        calls++
      }, [stored])
      for (const tx of txes(FIXED_CLASS, id)) {
        await mw.tx(makeCtx(makeAccount(AccountRole.Owner)), [tx])
      }
      expect(calls).toBe(3)
    })
  })
})
