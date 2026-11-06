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
  type TxAccessLevel
} from '@hcengineering/core'
import { PlatformError } from '@hcengineering/platform'
import { type Middleware, type PipelineContext } from '@hcengineering/server-core'
import { SpacePermissionsMiddleware } from '../spacePermissions'

const ALIAS = 'tracker:class:IssueIdentifierAlias' as Ref<Class<Doc>>
const ISSUE = 'tracker:class:Issue' as Ref<Class<Doc>>
const PROJECT = 'project' as Ref<Space>
const author = 'author' as PersonId
const factory = new TxFactory(author)

async function setup (
  role: AccountRole,
  restricted: boolean,
  system = false
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
  const middleware = await SpacePermissionsMiddleware.create(ctx, context, next as unknown as Middleware)
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
