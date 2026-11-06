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

function makeAccount (): Account {
  return {
    uuid: SEARCHING_ACCOUNT_ID,
    role: AccountRole.User,
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

describe('SpaceSecurityMiddleware searchFulltext', () => {
  it('does not return private channel names to non-members', async () => {
    const hierarchy = new Hierarchy()
    jest.spyOn(hierarchy, 'getDomain').mockReturnValue('chunter' as Domain)
    jest
      .spyOn(hierarchy, 'isDerived')
      .mockImplementation(
        (child: Ref<Class<Doc>>, parent: Ref<Class<Doc>>) =>
          child === parent || (child === CHANNEL_CLASS && parent === core.class.Space)
      )

    const privateChannel = makeChannel(PRIVATE_CHANNEL_ID, true, [MEMBER_ACCOUNT_ID])
    const publicChannel = makeChannel(PUBLIC_CHANNEL_ID, false, [])
    const systemSpace: Space = {
      ...makeChannel(core.space.Space, false, []),
      _class: core.class.SystemSpace
    }
    let searchQuery: SearchQuery | undefined
    const next = {
      findAll: async () => [privateChannel, publicChannel, systemSpace],
      groupBy: async () => new Map([[core.space.Space, 1]]),
      searchFulltext: async (_ctx: MeasureContext<SessionData>, query: SearchQuery) => {
        searchQuery = query
        return {
          total: 2,
          docs: [
            { id: PRIVATE_CHANNEL_ID, title: 'Secret plans', doc: privateChannel },
            { id: PUBLIC_CHANNEL_ID, title: 'Announcements', doc: publicChannel }
          ]
        }
      }
    } as unknown as Middleware
    const context = makeContext(makeAccount())
    const middleware = await SpaceSecurityMiddleware.create(false, context, makePipelineContext(hierarchy), next)

    const result = await middleware.searchFulltext(context, { query: 'Secret', classes: [CHANNEL_CLASS] }, {})

    expect(searchQuery?.spaces).toEqual([core.space.Space])
    expect(result.docs.map(({ id }) => id)).toEqual([PUBLIC_CHANNEL_ID])
    expect(result.total).toBe(1)
  })
})
