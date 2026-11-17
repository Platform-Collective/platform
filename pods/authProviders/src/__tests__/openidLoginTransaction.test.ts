// SPDX-License-Identifier: EPL-2.0

import { type AccountDB } from '@hcengineering/account'
import { type MeasureContext } from '@hcengineering/core'
import { Issuer } from 'openid-client'

import { registerOpenid } from '../openid'

jest.mock('openid-client', () => ({
  Issuer: { discover: jest.fn() },
  Strategy: jest.fn()
}))

jest.mock('@hcengineering/server-token', () => ({
  ...jest.requireActual('@hcengineering/server-token'),
  generateToken: jest.fn(() => 'token-value')
}))

interface State {
  people: any[]
  accounts: any[]
  socialIds: any[]
  members: any[]
  accountEvents: any[]
  profiles: any[]
}

function emptyState (): State {
  return { people: [], accounts: [], socialIds: [], members: [], accountEvents: [], profiles: [] }
}

function matches (record: any, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const value = record[key]
    if (expected !== null && typeof expected === 'object') {
      if ('$ne' in expected) return value !== expected.$ne
      if ('$gt' in expected) return value > expected.$gt
    }
    return value === expected
  })
}

function findOne (records: any[], query: Record<string, any>): any {
  return records.find((record) => matches(record, query)) ?? null
}

function update (records: any[], query: Record<string, any>, operations: Record<string, any>): void {
  for (const record of records.filter((candidate) => matches(candidate, query))) {
    Object.assign(record, operations)
  }
}

function createDb (state: State, transactionActive: boolean): AccountDB {
  const workspaceUrls: Record<string, string> = {
    'workspace-one': 'workspace-one',
    'workspace-two': 'workspace-two'
  }

  return {
    transactionActive,
    person: {
      findOne: async (query) => findOne(state.people, query),
      insertOne: async (data) => {
        const uuid = data.uuid ?? `person-${state.people.length + 1}`
        state.people.push({ ...data, uuid })
        return uuid
      },
      update: async (query, operations) => update(state.people, query, operations)
    },
    account: {
      findOne: async (query) => findOne(state.accounts, query),
      insertOne: async (data) => {
        state.accounts.push(data)
        return data.uuid
      }
    },
    socialId: {
      find: async (query) => state.socialIds.filter((record) => matches(record, query)),
      findOne: async (query) => findOne(state.socialIds, query),
      insertOne: async (data) => {
        const _id = `social-${state.socialIds.length + 1}`
        state.socialIds.push({ ...data, _id, key: `${data.type}:${data.value}` })
        return _id
      },
      update: async (query, operations) => update(state.socialIds, query, operations)
    },
    accountEvent: {
      insertOne: async (data) => {
        state.accountEvents.push(data)
      }
    },
    userProfile: {
      insertOne: async (data) => {
        state.profiles.push(data)
      }
    },
    workspace: {
      findOne: async (query) => {
        const workspaceUrl = query.url as string
        const uuid = workspaceUrls[workspaceUrl]
        return uuid === undefined ? null : { uuid, url: workspaceUrl }
      }
    },
    resetPassword: jest.fn(async () => {}),
    getWorkspaceRole: async (account, workspace) =>
      findOne(state.members, { accountUuid: account, workspaceUuid: workspace })?.role ?? null,
    getWorkspaceMembers: async (workspace) =>
      state.members
        .filter((member) => member.workspaceUuid === workspace)
        .map((member) => ({ person: member.accountUuid, role: member.role })),
    assignWorkspace: async (account, workspace, role) => {
      if (workspace === 'workspace-two') throw new Error('workspace synchronization failed')
      state.members.push({ accountUuid: account, workspaceUuid: workspace, role })
    },
    updateWorkspaceRole: async (account, workspace, role) => {
      update(state.members, { accountUuid: account, workspaceUuid: workspace }, { role })
    },
    unassignWorkspace: async (account, workspace) => {
      state.members = state.members.filter(
        (member) => member.accountUuid !== account || member.workspaceUuid !== workspace
      )
    }
  } as any
}

describe('OIDC login transaction', () => {
  const environment = [
    'OPENID_CLIENT_ID',
    'OPENID_CLIENT_SECRET',
    'OPENID_ISSUER',
    'OPENID_ALLOWED_GROUPS',
    'OPENID_ROLE_GROUPS'
  ]
  const previousEnvironment = Object.fromEntries(environment.map((key) => [key, process.env[key]]))

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPENID_CLIENT_ID = 'client-id'
    process.env.OPENID_CLIENT_SECRET = 'client-secret'
    process.env.OPENID_ISSUER = 'https://issuer.example'
    process.env.OPENID_ALLOWED_GROUPS = 'engineering'
    process.env.OPENID_ROLE_GROUPS = 'workspace-one:engineering=user;workspace-two:engineering=maintainer'
    ;(Issuer.discover as jest.Mock).mockResolvedValue({ Client: jest.fn() })
  })

  afterAll(() => {
    for (const key of environment) {
      const value = previousEnvironment[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test('rolls back the complete first login when synchronization fails', async () => {
    const committedState = emptyState()
    const db = createDb(committedState, false)
    db.transaction = jest.fn(async (operation) => {
      const stagedState = structuredClone(committedState)
      const transactionDb = createDb(stagedState, true)
      const result = await operation(transactionDb)
      Object.assign(committedState, stagedState)
      return result
    })
    const user = {
      sub: 'subject',
      name: 'First Last',
      _idClaims: { sub: 'subject', groups: ['engineering'], email: 'user@example.com', xms_edov: true }
    }
    const routes = new Map<string, Array<(ctx: any, next: () => Promise<void>) => Promise<void>>>()
    const router = {
      get: jest.fn((path: string, ...handlers: Array<(ctx: any, next: () => Promise<void>) => Promise<void>>) => {
        routes.set(path, handlers)
      })
    }
    const passport = {
      use: jest.fn(),
      authenticate: jest.fn(() => async (ctx: any, next: () => Promise<void>) => {
        ctx.state.user = user
        await next()
      })
    }
    const measureCtx = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext
    registerOpenid(
      measureCtx,
      passport as any,
      router as any,
      'https://accounts.example',
      Promise.resolve(db),
      'https://front.example',
      {}
    )
    const handlers = routes.get('/auth/openid/callback')
    if (handlers === undefined) throw new Error('OIDC callback was not registered')
    const redirect = jest.fn()
    const ctx = { query: {}, state: {}, redirect }

    await handlers[0](ctx, async () => {
      await handlers[1](ctx, async () => {})
    })

    expect(redirect).toHaveBeenCalledWith('https://front.example/login?error=oidc_role_sync_failed')
    expect(db.transaction).toHaveBeenCalledTimes(1)
    expect(committedState).toEqual(emptyState())
  })
})
