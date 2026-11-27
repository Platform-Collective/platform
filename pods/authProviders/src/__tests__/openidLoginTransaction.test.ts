// SPDX-License-Identifier: EPL-2.0

import {
  type Account,
  type AccountDB,
  type AccountEvent,
  type Operations,
  type Person,
  type Query,
  type SocialId,
  type UserProfile
} from '@hcengineering/account'
import {
  type AccountRole,
  type AccountUuid,
  type MeasureContext,
  type PersonId,
  type PersonUuid,
  type WorkspaceUuid
} from '@hcengineering/core'
import { type Context, type Next } from 'koa'
import type Router from 'koa-router'
import { Issuer } from 'openid-client'

import { type Passport } from '..'
import { registerOpenid } from '../openid'

jest.mock('openid-client', () => ({
  Issuer: { discover: jest.fn() },
  Strategy: jest.fn()
}))

jest.mock('@hcengineering/server-token', () => ({
  ...jest.requireActual('@hcengineering/server-token'),
  generateToken: jest.fn(() => 'token-value')
}))

interface StateMember {
  accountUuid: AccountUuid
  workspaceUuid: WorkspaceUuid
  role: AccountRole
}

interface State {
  people: Person[]
  accounts: Account[]
  socialIds: SocialId[]
  members: StateMember[]
  accountEvents: AccountEvent[]
  profiles: UserProfile[]
}

type TestAccountDB = Pick<
  AccountDB,
  | 'transactionActive'
  | 'transaction'
  | 'resetPassword'
  | 'getWorkspaceRole'
  | 'getWorkspaceMembers'
  | 'assignWorkspace'
  | 'updateWorkspaceRole'
  | 'unassignWorkspace'
> & {
  person: Pick<AccountDB['person'], 'findOne' | 'insertOne' | 'update'>
  account: Pick<AccountDB['account'], 'findOne' | 'insertOne'>
  socialId: Pick<AccountDB['socialId'], 'find' | 'findOne' | 'insertOne' | 'update'>
  accountEvent: Pick<AccountDB['accountEvent'], 'insertOne'>
  userProfile: Pick<AccountDB['userProfile'], 'insertOne'>
  workspace: Pick<AccountDB['workspace'], 'findOne'>
}

function emptyState (): State {
  return { people: [], accounts: [], socialIds: [], members: [], accountEvents: [], profiles: [] }
}

function matches<T> (record: T, query: Query<T>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const value = record[key as keyof T]
    if (expected !== null && typeof expected === 'object') {
      if ('$ne' in expected) return value !== expected.$ne
      if ('$gt' in expected) return (value as number) > (expected.$gt as number)
    }
    return value === expected
  })
}

function findOne<T> (records: T[], query: Query<T>): T | null {
  return records.find((record) => matches(record, query)) ?? null
}

function update<T extends object> (records: T[], query: Query<T>, operations: Operations<T>): void {
  for (const record of records.filter((candidate) => matches(candidate, query))) {
    Object.assign(record, operations)
  }
}

function createDb (state: State, transactionActive: boolean): TestAccountDB {
  const workspaceUrls: Record<string, WorkspaceUuid> = {
    'workspace-one': 'workspace-one' as WorkspaceUuid,
    'workspace-two': 'workspace-two' as WorkspaceUuid
  }

  return {
    transactionActive,
    person: {
      findOne: async (query) => findOne(state.people, query),
      insertOne: async (data) => {
        if (data.firstName === undefined || data.lastName === undefined) throw new Error('Person name is required')
        const uuid = data.uuid ?? (`person-${state.people.length + 1}` as PersonUuid)
        const person: Person = { ...data, uuid, firstName: data.firstName, lastName: data.lastName }
        state.people.push(person)
        return uuid
      },
      update: async (query, operations) => {
        update(state.people, query, operations)
      }
    },
    account: {
      findOne: async (query) => findOne(state.accounts, query),
      insertOne: async (data) => {
        if (data.uuid === undefined) throw new Error('Account UUID is required')
        const account: Account = { ...data, uuid: data.uuid }
        state.accounts.push(account)
        return data.uuid
      }
    },
    socialId: {
      find: async (query) => state.socialIds.filter((record) => matches(record, query)),
      findOne: async (query) => findOne(state.socialIds, query),
      insertOne: async (data) => {
        if (data.type === undefined || data.value === undefined || data.personUuid === undefined) {
          throw new Error('Social ID identity is required')
        }
        const _id = `social-${state.socialIds.length + 1}` as PersonId
        const socialId: SocialId = {
          ...data,
          _id,
          type: data.type,
          value: data.value,
          key: `${data.type}:${data.value}`,
          personUuid: data.personUuid
        }
        state.socialIds.push(socialId)
        return _id
      },
      update: async (query, operations) => {
        update(state.socialIds, query, operations)
      }
    },
    accountEvent: {
      insertOne: async (data) => {
        if (data.accountUuid === undefined || data.eventType === undefined || data.time === undefined) {
          throw new Error('Account event is incomplete')
        }
        const accountEvent: AccountEvent = {
          ...data,
          accountUuid: data.accountUuid,
          eventType: data.eventType,
          time: data.time
        }
        state.accountEvents.push(accountEvent)
      }
    },
    userProfile: {
      insertOne: async (data) => {
        if (data.personUuid === undefined || data.isPublic === undefined) throw new Error('User profile is incomplete')
        const userProfile: UserProfile = { ...data, personUuid: data.personUuid, isPublic: data.isPublic }
        state.profiles.push(userProfile)
      }
    },
    workspace: {
      findOne: async (query) => {
        if (typeof query.url !== 'string') return null
        const workspaceUrl = query.url
        const uuid = workspaceUrls[workspaceUrl]
        return uuid === undefined
          ? null
          : { uuid, name: workspaceUrl, url: workspaceUrl, allowReadOnlyGuest: false, allowGuestSignUp: false }
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
  }
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
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  test('rolls back the complete first login when synchronization fails', async () => {
    const committedState = emptyState()
    const db = createDb(committedState, false)
    const transaction = jest.fn(async <T> (operation: (transactionDb: AccountDB) => Promise<T>): Promise<T> => {
      const stagedState = structuredClone(committedState)
      const transactionDb = createDb(stagedState, true)
      const result = await operation(transactionDb as AccountDB)
      Object.assign(committedState, stagedState)
      return result
    })
    db.transaction = transaction as unknown as NonNullable<AccountDB['transaction']>
    const user = {
      sub: 'subject',
      name: 'First Last',
      _idClaims: { sub: 'subject', groups: ['engineering'], email: 'user@example.com', xms_edov: true }
    }
    type RouteHandler = (ctx: Context, next: Next) => Promise<void>
    const routes = new Map<string, RouteHandler[]>()
    const router = {
      get: jest.fn((path: string, ...handlers: RouteHandler[]) => {
        routes.set(path, handlers)
      })
    }
    const passport = {
      use: jest.fn(),
      authenticate: jest.fn(() => async (ctx: Context, next: Next) => {
        ctx.state.user = user
        await next()
      })
    }
    const measureCtx = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext
    registerOpenid(
      measureCtx,
      passport as unknown as Passport,
      router as unknown as Router,
      'https://accounts.example',
      Promise.resolve(db as AccountDB),
      'https://front.example',
      {}
    )
    const handlers = routes.get('/auth/openid/callback')
    if (handlers === undefined) throw new Error('OIDC callback was not registered')
    const redirect = jest.fn()
    const ctx = { query: {}, state: {}, redirect } as unknown as Context

    await handlers[0](ctx, async () => {
      await handlers[1](ctx, async () => {})
    })

    expect(redirect).toHaveBeenCalledWith('https://front.example/login?error=oidc_role_sync_failed')
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(committedState).toEqual(emptyState())
  })
})
