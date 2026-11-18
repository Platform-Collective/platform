// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  MeasureMetricsContext,
  TxFactory,
  type AccountUuid,
  type Class,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxAccessLevel
} from '@hcengineering/core'
import { PlatformError } from '@hcengineering/platform'
import { type Middleware, type PipelineContext } from '@hcengineering/server-core'
import { SpacePermissionsMiddleware } from '../spacePermissions'
import { TriggersMiddleware } from '../triggers'

const ALIAS = 'tracker:class:IssueIdentifierAlias' as Ref<Class<Doc>>
const ISSUE = 'tracker:class:Issue' as Ref<Class<Doc>>
const PROJECT = 'project' as Ref<Space>
const author = 'author' as PersonId
const factory = new TxFactory(author)

async function setup (
  role: AccountRole,
  restricted: boolean,
  system = false,
  configure?: (context: PipelineContext, next: Middleware) => Middleware
): Promise<{
  middleware: SpacePermissionsMiddleware
  ctx: MeasureContext<SessionData>
  next: {
    findAll: jest.Mock
    tx: jest.Mock
  }
}> {
  const permission = { _id: 'update-issues', objectClass: ISSUE, txClass: core.class.TxUpdateDoc }
  const context = {
    hierarchy: {
      isDerived: (a: string, b: string) => a === b || (a === 'project-class' && b === core.class.TypedSpace),
      getAncestors: (cls: string) => [cls],
      classHierarchyMixin: (cls: string) =>
        cls === ALIAS ? ({ serverOnly: true } as unknown as TxAccessLevel) : undefined,
      getClassifierProp: () => undefined,
      getClass: () => ({}),
      hasMixin: () => false,
      as: () => ({ role: ['account'] })
    },
    modelDb: {
      findAllSync: (cls: string) => {
        if (cls === core.class.SpaceType) return [{ _id: 'type', targetClass: 'project-mixin' }]
        if (cls === core.class.Role) return [{ _id: 'role', permissions: ['update-issues'] }]
        if (cls === core.class.Permission) return [permission]
        return []
      }
    }
  } as unknown as PipelineContext
  const ctx = new MeasureMetricsContext('server-only-test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account: { uuid: 'account' as AccountUuid, role, primarySocialId: system ? core.account.System : author },
    broadcast: { txes: [] }
  } as unknown as SessionData
  const next = {
    findAll: jest.fn(async () => [{ _id: PROJECT, _class: 'project-class', type: 'type', restricted }]),
    tx: jest.fn(async () => ({}))
  }
  const downstream = configure?.(context, next as unknown as Middleware) ?? (next as unknown as Middleware)
  const middleware = await SpacePermissionsMiddleware.create(ctx, context, downstream)
  return { middleware, ctx, next }
}

it.each([AccountRole.User, AccountRole.Guest, AccountRole.Owner])(
  'rejects forged alias creates, updates and removes from %s, including a forged derived transaction space',
  async (role) => {
    const { middleware, ctx, next } = await setup(role, false)
    const transactions = [
      factory.createTxCreateDoc(ALIAS, PROJECT, {}),
      factory.createTxUpdateDoc(ALIAS, PROJECT, 'alias' as Ref<Doc>, {}),
      factory.createTxRemoveDoc(ALIAS, PROJECT, 'alias' as Ref<Doc>)
    ]
    for (const tx of transactions) {
      tx.space = core.space.DerivedTx
      await expect(middleware.tx(ctx, [tx])).rejects.toThrow(PlatformError)
    }
    expect(next.tx).not.toHaveBeenCalled()
  }
)

it('allows a restricted project role to update issues without granting alias writes', async () => {
  const { middleware, ctx, next } = await setup(AccountRole.User, true)
  const update = factory.createTxUpdateDoc(ISSUE, PROJECT, 'issue' as Ref<Doc>, {})
  await expect(middleware.tx(ctx, [update])).resolves.toEqual({})
  await expect(middleware.tx(ctx, [factory.createTxCreateDoc(ALIAS, PROJECT, {})])).rejects.toThrow(PlatformError)
  expect(next.tx).toHaveBeenCalledTimes(1)
})

it('rejects alias writes nested in a client apply batch', async () => {
  const { middleware, ctx } = await setup(AccountRole.User, true)
  const tx = factory.createTxApplyIf(PROJECT, '', [], [], [factory.createTxCreateDoc(ALIAS, PROJECT, {})], undefined)
  await expect(middleware.tx(ctx, [tx])).rejects.toThrow(PlatformError)
})

it('allows trusted system maintenance', async () => {
  const { middleware, ctx } = await setup(AccountRole.User, false, true)
  await expect(middleware.tx(ctx, [factory.createTxCreateDoc(ALIAS, PROJECT, {})])).resolves.toEqual({})
})

it('persists a trigger-produced alias through the derived entry during a user request', async () => {
  const derived = { tx: jest.fn(async (_ctx: MeasureContext<SessionData>, _txes: Tx[]) => ({})) }
  const triggerMiddleware: TriggersMiddleware[] = []
  const { middleware, ctx, next } = await setup(AccountRole.User, true, false, (context, next) => {
    const triggers = new TriggersMiddleware(context, next)
    context.derived = derived as unknown as Middleware
    triggerMiddleware.push(triggers)
    return triggers
  })
  const triggers = triggerMiddleware[0]
  triggers.triggers.apply = jest.fn(async (_ctx: MeasureContext, txes: Tx[]) => {
    const txFactory = new TxFactory(txes[0].modifiedBy, true)
    return [txFactory.createTxCreateDoc(ALIAS, PROJECT, {})]
  })

  try {
    const update = factory.createTxUpdateDoc(ISSUE, PROJECT, 'issue' as Ref<Doc>, {})
    await expect(middleware.tx(ctx, [update])).resolves.toEqual({})

    expect(next.tx).toHaveBeenCalledTimes(1)
    expect(derived.tx).toHaveBeenCalledTimes(1)
    const [derivedCtx, derivedTxes] = derived.tx.mock.calls[0]
    expect(derivedCtx.contextData.account.primarySocialId).toBe(author)
    expect(derivedTxes).toHaveLength(1)
    expect(derivedTxes[0]).toMatchObject({
      _class: core.class.TxCreateDoc,
      objectClass: ALIAS,
      space: core.space.DerivedTx,
      modifiedBy: author
    })
  } finally {
    await triggers.close()
  }
})
