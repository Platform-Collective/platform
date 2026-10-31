// SPDX-License-Identifier: EPL-2.0
import type { LoginInfoByToken } from '@hcengineering/account-client'
import { AccountRole, type PersonId, type PersonUuid, type WorkspaceUuid } from '@hcengineering/core'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import { HttpError } from '../http-error'
import { ctx } from './helpers/provider'
import {
  appConfigRoute,
  appInput,
  appRemoveRoute,
  disconnectAllRoute,
  repositoryDisableRoute,
  repositoryEnableRoute,
  requiredString,
  verifyCallerToken,
  type OwnerRouteDeps,
  type RepositoryRouteDeps
} from '../routes'

const ws = '11111111-1111-4111-8111-111111111111' as WorkspaceUuid
const account = '22222222-2222-4222-8222-222222222222' as PersonUuid
const person = 'p1' as PersonId

function deps (
  role: AccountRole | undefined,
  roleWorkspace: string = ws
): OwnerRouteDeps & {
  service: { saveApp: jest.Mock, removeApp: jest.Mock, disconnectAll: jest.Mock }
  listSocialIds: jest.Mock
  loginInfo: jest.Mock
} {
  const listSocialIds = jest.fn(async () => [{ _id: person }])
  return {
    listSocialIds,
    // The production composition: real token verification, then the social id check.
    verify: async (body) => await verifyCallerToken(body, { decode: decodeToken, listSocialIds }),
    loginInfo: jest.fn(
      async () =>
        ({
          account,
          workspace: roleWorkspace,
          workspaceUrl: 'w',
          endpoint: 'e',
          token: 't',
          role
        }) as unknown as LoginInfoByToken
    ),
    service: {
      saveApp: jest.fn(async () => {}),
      removeApp: jest.fn(async () => {}),
      disconnectAll: jest.fn(async () => {})
    }
  }
}

const workspaceToken = generateToken(account, ws)
const accountToken = generateToken(account, undefined)

describe.each([
  ['app-config', appConfigRoute, { clientId: 'cid', clientSecret: 's' }, 'saveApp'],
  ['app-remove', appRemoveRoute, {}, 'removeApp'],
  ['disconnect-all', disconnectAllRoute, {}, 'disconnectAll']
] as const)('%s gating', (_name, route, extra, method) => {
  it('rejects a workspace-less token without touching the service', async () => {
    const d = deps(AccountRole.Owner)
    await expect(route(ctx, { token: accountToken, accountId: person, ...extra }, d)).rejects.toThrow(
      'A workspace token is required'
    )
    expect(d.listSocialIds).not.toHaveBeenCalled()
    expect(d.loginInfo).not.toHaveBeenCalled()
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('rejects a non-owner without touching the service', async () => {
    const d = deps(AccountRole.User)
    await expect(route(ctx, { token: workspaceToken, accountId: person, ...extra }, d)).rejects.toThrow(
      'Only workspace owners can change the GitLab application'
    )
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('rejects an owner role reported for another workspace', async () => {
    const d = deps(AccountRole.Owner, '33333333-3333-4333-8333-333333333333')
    await expect(route(ctx, { token: workspaceToken, accountId: person, ...extra }, d)).rejects.toThrow(
      'Only workspace owners can change the GitLab application'
    )
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('rejects an invalid token without touching the service', async () => {
    const d = deps(AccountRole.Owner)
    await expect(route(ctx, { token: `${workspaceToken}x`, accountId: person, ...extra }, d)).rejects.toThrow()
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('lets an owner through to the service', async () => {
    const d = deps(AccountRole.Owner)
    await route(ctx, { token: workspaceToken, accountId: person, ...extra }, d)
    expect(d.service[method]).toHaveBeenCalledTimes(1)
    expect(d.service[method].mock.calls[0][1]).toBe(ws)
  })
})

describe('app-config route', () => {
  it('an owner reaches saveApp with the verified workspace, social id and input', async () => {
    const d = deps(AccountRole.Owner)
    await appConfigRoute(
      ctx,
      { token: workspaceToken, accountId: person, host: 'https://gitlab.com', clientId: 'cid', clientSecret: 's' },
      d
    )
    expect(d.service.saveApp).toHaveBeenCalledWith(ctx, ws, person, {
      host: 'https://gitlab.com',
      clientId: 'cid',
      clientSecret: 's'
    })
  })

  it('rejects malformed input before verifying the caller', async () => {
    const d = deps(AccountRole.Owner)
    await expect(appConfigRoute(ctx, { token: workspaceToken, accountId: person, clientId: 1 }, d)).rejects.toThrow(
      'clientId must be a string'
    )
    expect(d.service.saveApp).not.toHaveBeenCalled()
  })
})

function repositoryDeps (role: AccountRole | undefined = AccountRole.User): RepositoryRouteDeps & {
  service: { enableRepository: jest.Mock, disableRepository: jest.Mock }
  listSocialIds: jest.Mock
  loginInfo: jest.Mock
} {
  const listSocialIds = jest.fn(async () => [{ _id: person }])
  return {
    listSocialIds,
    verify: async (body) => await verifyCallerToken(body, { decode: decodeToken, listSocialIds }),
    loginInfo: jest.fn(
      async () =>
        ({ account, workspace: ws, workspaceUrl: 'w', endpoint: 'e', token: 't', role }) as unknown as LoginInfoByToken
    ),
    service: { enableRepository: jest.fn(async () => {}), disableRepository: jest.fn(async () => {}) }
  }
}

describe.each([
  ['repository-enable', repositoryEnableRoute, 'enableRepository'],
  ['repository-disable', repositoryDisableRoute, 'disableRepository']
] as const)('%s gating', (_name, route, method) => {
  it("acts in the token's workspace for the verified caller", async () => {
    const d = repositoryDeps()
    await route(ctx, { token: workspaceToken, accountId: person, repositoryId: 'repo-1' }, d)
    expect(d.service[method]).toHaveBeenCalledWith(ctx, ws, 'repo-1', expect.objectContaining({ accountId: person }))
  })

  it('tells the service whether the caller is a maintainer, asking the account service only when needed', async () => {
    const d = repositoryDeps(AccountRole.Maintainer)
    await route(ctx, { token: workspaceToken, accountId: person, repositoryId: 'repo-1' }, d)
    expect(d.loginInfo).not.toHaveBeenCalled()
    const caller = d.service[method].mock.calls[0][3]
    expect(await caller.isMaintainer()).toBe(true)
    expect(d.loginInfo).toHaveBeenCalledTimes(1)
  })

  it('answers 401 for an invalid token', async () => {
    const d = repositoryDeps()
    await expect(
      route(ctx, { token: `${workspaceToken}x`, accountId: person, repositoryId: 'repo-1' }, d)
    ).rejects.toMatchObject({ status: 401 })
  })

  it("rejects a social id that is not the caller's", async () => {
    const d = repositoryDeps()
    await expect(
      route(ctx, { token: workspaceToken, accountId: 'someone-else', repositoryId: 'repo-1' }, d)
    ).rejects.toThrow('accountId does not belong to the caller')
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('rejects a workspace-less token', async () => {
    const d = repositoryDeps()
    await expect(route(ctx, { token: accountToken, accountId: person, repositoryId: 'repo-1' }, d)).rejects.toThrow(
      'A workspace token is required'
    )
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('rejects a missing repository id before any account-service call', async () => {
    const d = repositoryDeps()
    await expect(route(ctx, { token: workspaceToken, accountId: person }, d)).rejects.toThrow(
      'repositoryId is required'
    )
    expect(d.listSocialIds).not.toHaveBeenCalled()
  })
})

function thrown (fn: () => unknown): unknown {
  try {
    fn()
  } catch (err: unknown) {
    return err
  }
  return undefined
}

describe('requiredString', () => {
  it('returns a non-empty string and refuses anything else with 400', () => {
    expect(requiredString({ code: 'abc' }, 'code')).toBe('abc')
    for (const body of [{}, { code: '' }, { code: 5 }]) {
      expect(thrown(() => requiredString(body, 'code'))).toMatchObject({ status: 400, message: 'code is required' })
    }
  })
})

describe('appInput', () => {
  it('answers a malformed app body with a 400 HttpError', () => {
    for (const body of [{}, { clientId: 5 }, { clientId: 'id', host: 1 }, { clientId: 'id', clientSecret: 2 }]) {
      expect(() => appInput(body)).toThrow(HttpError)
      try {
        appInput(body)
      } catch (err) {
        expect((err as HttpError).status).toBe(400)
      }
    }
  })
})
