// SPDX-License-Identifier: EPL-2.0
import type { LoginInfoByToken } from '@hcengineering/account-client'
import { AccountRole, MeasureMetricsContext, type PersonId, type PersonUuid, type WorkspaceUuid } from '@hcengineering/core'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import { appConfigRoute, appRemoveRoute, disconnectAllRoute, repositoryDisableRoute, repositoryEnableRoute, verifyCallerToken, type OwnerRouteDeps, type RepositoryRouteDeps } from '../routes'

const ctx = new MeasureMetricsContext('test', {})
const ws = '11111111-1111-4111-8111-111111111111' as WorkspaceUuid
const account = '22222222-2222-4222-8222-222222222222' as PersonUuid
const person = 'p1' as PersonId

function deps (role: AccountRole | undefined, roleWorkspace: string = ws): OwnerRouteDeps & {
  service: { saveApp: jest.Mock, removeApp: jest.Mock, disconnectAll: jest.Mock }
  listSocialIds: jest.Mock
  loginInfo: jest.Mock
} {
  const listSocialIds = jest.fn(async () => [{ _id: person }])
  return {
    listSocialIds,
    // The production composition: real token verification, then the social id check.
    verify: async (body) => await verifyCallerToken(body, { decode: decodeToken, listSocialIds }),
    loginInfo: jest.fn(async () => ({ account, workspace: roleWorkspace, workspaceUrl: 'w', endpoint: 'e', token: 't', role }) as unknown as LoginInfoByToken),
    service: { saveApp: jest.fn(async () => {}), removeApp: jest.fn(async () => {}), disconnectAll: jest.fn(async () => {}) }
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
    await expect(route(ctx, { token: accountToken, accountId: person, ...extra }, d)).rejects.toThrow('A workspace token is required')
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
    await appConfigRoute(ctx, { token: workspaceToken, accountId: person, host: 'https://gitlab.com', clientId: 'cid', clientSecret: 's' }, d)
    expect(d.service.saveApp).toHaveBeenCalledWith(ctx, ws, person, { host: 'https://gitlab.com', clientId: 'cid', clientSecret: 's' })
  })

  it('rejects malformed input before verifying the caller', async () => {
    const d = deps(AccountRole.Owner)
    await expect(appConfigRoute(ctx, { token: workspaceToken, accountId: person, clientId: 1 }, d)).rejects.toThrow('clientId must be a string')
    expect(d.service.saveApp).not.toHaveBeenCalled()
  })
})

function repositoryDeps (): RepositoryRouteDeps & {
  service: { enableRepository: jest.Mock, disableRepository: jest.Mock }
  listSocialIds: jest.Mock
} {
  const listSocialIds = jest.fn(async () => [{ _id: person }])
  return {
    listSocialIds,
    verify: async (body) => await verifyCallerToken(body, { decode: decodeToken, listSocialIds }),
    service: { enableRepository: jest.fn(async () => {}), disableRepository: jest.fn(async () => {}) }
  }
}

describe.each([
  ['repository-enable', repositoryEnableRoute, 'enableRepository'],
  ['repository-disable', repositoryDisableRoute, 'disableRepository']
] as const)('%s gating', (_name, route, method) => {
  it('acts in the token\'s workspace for the verified caller', async () => {
    const d = repositoryDeps()
    await route(ctx, { token: workspaceToken, accountId: person, repositoryId: 'repo-1' }, d)
    expect(d.service[method]).toHaveBeenCalledWith(ctx, ws, 'repo-1')
  })

  it('rejects a social id that is not the caller\'s', async () => {
    const d = repositoryDeps()
    await expect(route(ctx, { token: workspaceToken, accountId: 'someone-else', repositoryId: 'repo-1' }, d)).rejects.toThrow(
      'accountId does not belong to the caller'
    )
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('rejects a workspace-less token', async () => {
    const d = repositoryDeps()
    await expect(route(ctx, { token: accountToken, accountId: person, repositoryId: 'repo-1' }, d)).rejects.toThrow('A workspace token is required')
    expect(d.service[method]).not.toHaveBeenCalled()
  })

  it('rejects a missing repository id before any account-service call', async () => {
    const d = repositoryDeps()
    await expect(route(ctx, { token: workspaceToken, accountId: person }, d)).rejects.toThrow('repositoryId is required')
    expect(d.listSocialIds).not.toHaveBeenCalled()
  })
})
