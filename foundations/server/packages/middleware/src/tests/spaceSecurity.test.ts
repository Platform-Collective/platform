// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type Domain,
  Hierarchy,
  type MeasureContext,
  MeasureMetricsContext,
  type PersonId,
  type Ref,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  type Space,
  type WorkspaceDataId,
  type WorkspaceUuid
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'

import { SpaceSecurityMiddleware } from '../spaceSecurity'

const CHANNEL_CLASS = 'chunter:class:Channel' as Ref<Class<Space>>
const PRIVATE_CHANNEL_ID = 'chunter:space:Private' as Ref<Space>
const PUBLIC_CHANNEL_ID = 'chunter:space:Public' as Ref<Space>
const MEMBER_ACCOUNT_ID = 'test:account:Member' as AccountUuid
const SEARCHING_ACCOUNT_ID = 'test:account:Searching' as AccountUuid

function makeAccount (role: AccountRole = AccountRole.User): Account {
  return {
    uuid: SEARCHING_ACCOUNT_ID,
    role,
    primarySocialId: 'test:searching' as PersonId,
    socialIds: ['test:searching' as PersonId],
    fullSocialIds: []
  }
}

function makeContext (account: Account): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account,
    broadcast: { txes: [], queue: [], sessions: {} }
  } as unknown as SessionData
  return ctx
}

function makeChannel (id: Ref<Space>, isPrivate: boolean, members: AccountUuid[]): Space {
  return {
    _id: id,
    _class: CHANNEL_CLASS,
    space: core.space.Space,
    modifiedOn: 0,
    modifiedBy: 'test:account:System' as PersonId,
    createdOn: 0,
    createdBy: 'test:account:System' as PersonId,
    name: id,
    description: '',
    private: isPrivate,
    archived: false,
    members
  }
}

function makePipelineContext (hierarchy: Hierarchy): PipelineContext {
  return {
    workspace: { uuid: 'test-workspace' as WorkspaceUuid, url: 'test', dataId: 'test' as WorkspaceDataId },
    hierarchy,
    modelDb: {} as unknown as PipelineContext['modelDb'],
    branding: null,
    adapterManager: {} as unknown as PipelineContext['adapterManager'],
    storageAdapter: {} as unknown as PipelineContext['storageAdapter'],
    contextVars: {},
    lastTx: '',
    lastHash: '',
    broadcastEvent: async () => {}
  }
}

interface SearchSetup {
  role?: AccountRole
  total?: number
  classes?: Array<Ref<Class<Doc>>> | 'all'
  results: Doc[]
}

const ISSUE_CLASS = 'tracker:class:Issue' as Ref<Class<Doc>>

async function search ({ role, total, classes = [CHANNEL_CLASS], results }: SearchSetup): Promise<{
  query: SearchQuery | undefined
  result: SearchResult
}> {
  const hierarchy = new Hierarchy()
  jest.spyOn(hierarchy, 'getDomain').mockReturnValue('chunter' as Domain)
  jest
    .spyOn(hierarchy, 'isDerived')
    .mockImplementation(
      (child: Ref<Class<Doc>>, parent: Ref<Class<Doc>>) =>
        child === parent ||
        ((child === CHANNEL_CLASS || child === core.class.SystemSpace) && parent === core.class.Space)
    )

  let searchQuery: SearchQuery | undefined
  const next = {
    findAll: async () => [privateChannel, publicChannel, systemSpace],
    groupBy: async () => new Map([[core.space.Space, 1]]),
    searchFulltext: async (_ctx: MeasureContext<SessionData>, query: SearchQuery) => {
      searchQuery = query
      return {
        total,
        docs: results.map((doc) => ({ id: doc._id, title: doc._id, doc }))
      }
    }
  } as unknown as Middleware
  const context = makeContext(makeAccount(role))
  const middleware = await SpaceSecurityMiddleware.create(false, context, makePipelineContext(hierarchy), next)

  const result = await middleware.searchFulltext(
    context,
    { query: 'Secret', classes: classes === 'all' ? undefined : classes },
    {}
  )
  return { query: searchQuery, result }
}

const privateChannel = makeChannel(PRIVATE_CHANNEL_ID, true, [MEMBER_ACCOUNT_ID])
const publicChannel = makeChannel(PUBLIC_CHANNEL_ID, false, [])
const SYSTEM_SPACE_ID = 'test:space:System' as Ref<Space>
const systemSpace: Space = {
  ...makeChannel(SYSTEM_SPACE_ID, false, []),
  _class: core.class.SystemSpace
}

describe('SpaceSecurityMiddleware searchFulltext', () => {
  it('does not return private channel names to non-members', async () => {
    const { query, result } = await search({ total: 2, results: [privateChannel, publicChannel] })

    expect(query?.spaces).toEqual([core.space.Space])
    expect(result.docs.map(({ id }) => id)).toEqual([PUBLIC_CHANNEL_ID])
    expect(result.total).toBeUndefined()
  })

  it('omits the total for space searches, since it may count spaces on other pages the caller cannot see', async () => {
    const { result } = await search({ total: 25, results: [publicChannel] })

    expect(result.docs.map(({ id }) => id)).toEqual([PUBLIC_CHANNEL_ID])
    expect(result.total).toBeUndefined()
  })

  it('omits the total for searches across all classes', async () => {
    const { result } = await search({ total: 25, classes: 'all', results: [publicChannel] })

    expect(result.total).toBeUndefined()
  })

  it('keeps the total for searches that cannot return spaces', async () => {
    const issue = { ...publicChannel, _id: 'tracker:issue:One', _class: ISSUE_CLASS } as unknown as Doc
    const { result } = await search({ total: 25, classes: [ISSUE_CLASS], results: [issue] })

    expect(result.docs.map(({ id }) => id)).toEqual(['tracker:issue:One'])
    expect(result.total).toBe(25)
  })

  it('does not return system spaces to guests, like the query side', async () => {
    const { result } = await search({ role: AccountRole.Guest, total: 2, results: [systemSpace, publicChannel] })

    expect(result.docs.map(({ id }) => id)).toEqual([PUBLIC_CHANNEL_ID])
    expect(result.total).toBeUndefined()
  })

  it('keeps system spaces for regular users', async () => {
    const { result } = await search({ total: 2, results: [systemSpace, publicChannel] })

    expect(result.docs.map(({ id }) => id)).toEqual([SYSTEM_SPACE_ID, PUBLIC_CHANNEL_ID])
  })
})
