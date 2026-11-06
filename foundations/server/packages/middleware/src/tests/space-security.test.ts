// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  type AccountUuid,
  type Class,
  type Doc,
  type FindResult,
  Hierarchy,
  type MeasureContext,
  MeasureMetricsContext,
  ModelDb,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  systemAccountUuid,
  toFindResult,
  type Tx,
  TxFactory,
  TxProcessor,
  type WorkspaceUuid
} from '@hcengineering/core'
import { BaseMiddleware, type PipelineContext } from '@hcengineering/server-core'
import { BroadcastMiddleware } from '../broadcast'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const MEMBER = 'test:account:Member' as AccountUuid
const UNRELATED = 'test:account:Unrelated' as AccountUuid
const AUTHOR = 'test:person:Author' as PersonId
const SPACE = 'test:space:Private' as Ref<Space>
const TEST_DOC_CLASS = 'test:class:Document' as Ref<Class<TestDoc>>

interface TestDoc extends Doc {
  name: string
}

class SpaceStorage extends BaseMiddleware {
  constructor (
    context: PipelineContext,
    private readonly spaces: Space[]
  ) {
    super(context)
  }

  override async findAll<T extends Doc> (
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>
  ): Promise<FindResult<T>> {
    return toFindResult((_class === core.class.Space ? this.spaces : []) as unknown as T[])
  }
}

async function setup (
  members: AccountUuid[],
  isPrivate = true
): Promise<{
  ctx: MeasureContext<SessionData>
  broadcast: BroadcastMiddleware
  send: jest.Mock
}> {
  const hierarchy = new Hierarchy()
  jest.spyOn(hierarchy, 'getAncestors').mockImplementation((_class) => [_class])
  jest.spyOn(hierarchy, 'getDomain').mockReturnValue('test' as ReturnType<Hierarchy['getDomain']>)
  const modelDb = new ModelDb(hierarchy)
  jest.spyOn(modelDb, 'findAllSync').mockReturnValue(toFindResult([]))
  const context: PipelineContext = {
    hierarchy,
    modelDb,
    workspace: { uuid: 'test-workspace' as WorkspaceUuid, url: 'test-workspace' },
    branding: null,
    contextVars: {}
  }
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    broadcast: { txes: [], targets: {}, queue: [], sessions: {} },
    contextCache: new Map(),
    removedMap: new Map(),
    account: { uuid: MEMBER, role: AccountRole.User, primarySocialId: AUTHOR, socialIds: [AUTHOR], fullSocialIds: [] },
    service: 'test',
    sessionId: 'test-session',
    workspace: context.workspace,
    socialStringsToUsers: new Map()
  }
  const space = TxProcessor.createDoc2Doc(
    new TxFactory(AUTHOR).createTxCreateDoc(
      core.class.Space,
      core.space.Space,
      { name: 'Private', description: '', private: isPrivate, archived: false, members },
      SPACE
    )
  )
  const security = await SpaceSecurityMiddleware.create(false, ctx, context, new SpaceStorage(context, [space]))
  await security.tx(ctx, [])
  const send = jest.fn()
  const broadcast = new BroadcastMiddleware(context, security, { broadcast: send, broadcastSessions: jest.fn() })
  return { ctx, broadcast, send }
}

function createTxes (isDerived: boolean, space = SPACE): Tx[] {
  const factory = new TxFactory(AUTHOR, isDerived)
  const create = factory.createTxCreateDoc(TEST_DOC_CLASS, space, { name: 'Original' })
  const update = factory.createTxUpdateDoc(TEST_DOC_CLASS, space, create.objectId, { name: 'Updated' })
  return [create, update]
}

describe.each([false, true])('space security broadcast (derived: %s)', (isDerived) => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each([{ members: [] }, { members: [MEMBER] }])(
    'restricts private-space creates and updates with members $members',
    async ({ members }) => {
      const { ctx, broadcast, send } = await setup(members)
      const txes = createTxes(isDerived)
      // Queue transactions that have not passed through the space-security tx handler.
      ctx.contextData.broadcast.txes.push(...txes)
      await broadcast.handleBroadcast(ctx)

      const expectedTargets = [...members, systemAccountUuid]
      for (const tx of txes) {
        expect(await ctx.contextData.broadcast.targets.spaceSec(tx)).toEqual({ target: expectedTargets })
      }
      expect(send).toHaveBeenCalledTimes(expectedTargets.length)
      for (const target of expectedTargets) {
        expect(send).toHaveBeenCalledWith(ctx, txes, target, undefined)
      }
      expect(send.mock.calls.some(([, , target]) => target === undefined || target === UNRELATED)).toBe(false)
    }
  )

  it('keeps private-space transactions out of unrestricted sends in a mixed batch', async () => {
    const { ctx, broadcast, send } = await setup([])
    const privateTxes = createTxes(isDerived)
    const publicTxes = createTxes(isDerived, core.space.Workspace)
    ctx.contextData.broadcast.txes.push(...publicTxes, ...privateTxes)
    await broadcast.handleBroadcast(ctx)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(ctx, [...publicTxes, ...privateTxes], systemAccountUuid, undefined)
    expect(send).toHaveBeenCalledWith(ctx, publicTxes, undefined, [systemAccountUuid])
  })

  it('keeps unrestricted delivery for an empty public space', async () => {
    const { ctx, broadcast, send } = await setup([], false)
    const txes = createTxes(isDerived)
    ctx.contextData.broadcast.txes.push(...txes)
    await broadcast.handleBroadcast(ctx)
    expect(await ctx.contextData.broadcast.targets.spaceSec(txes[0])).toBeUndefined()
    expect(send).toHaveBeenCalledWith(ctx, txes, undefined, [])
  })

  it.each([core.space.Workspace, 'test:space:Unknown' as Ref<Space>])(
    'keeps unrestricted delivery for space %s',
    async (space) => {
      const { ctx, broadcast, send } = await setup([])
      const txes = createTxes(isDerived, space)
      ctx.contextData.broadcast.txes.push(...txes)
      await broadcast.handleBroadcast(ctx)
      expect(await ctx.contextData.broadcast.targets.spaceSec(txes[0])).toBeUndefined()
      expect(send).toHaveBeenCalledWith(ctx, txes, undefined, [])
    }
  )
})
