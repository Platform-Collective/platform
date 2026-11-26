// SPDX-License-Identifier: EPL-2.0

import type { AccountClient, IntegrationSecret } from '@hcengineering/account-client'
import type { MeasureContext, PersonId, WorkspaceUuid } from '@hcengineering/core'
import { githubUserIntegrationKind } from '@hcengineering/github'
import type { GithubUserRecord } from '../types'

jest.mock('@hcengineering/server-client', () => ({ getAccountClient: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: jest.fn(() => 'test-token') }))

import { getAccountClient } from '@hcengineering/server-client'
import { UserManager } from '../users'

const ACCOUNT = 'github-account' as PersonId
const WORKSPACE = 'github-workspace' as WorkspaceUuid
const LOGIN = 'example-user'

function createRecord (): GithubUserRecord {
  return {
    account: ACCOUNT,
    _id: LOGIN,
    token: 'test-user-token',
    refreshToken: 'test-refresh-token',
    authorized: true,
    accounts: { [WORKSPACE]: ACCOUNT }
  }
}

function createSecret (record: object): IntegrationSecret {
  return {
    key: LOGIN,
    kind: githubUserIntegrationKind,
    socialId: ACCOUNT,
    workspaceUuid: null,
    secret: JSON.stringify(record)
  }
}

describe('UserManager stored user records', () => {
  const accounts = {
    getIntegration: jest.fn(),
    createIntegration: jest.fn(),
    getIntegrationSecret: jest.fn(),
    addIntegrationSecret: jest.fn(),
    updateIntegrationSecret: jest.fn(),
    listIntegrationsSecrets: jest.fn()
  }
  let manager: UserManager

  beforeEach(() => {
    jest.resetAllMocks()
    accounts.getIntegration.mockResolvedValue({})
    accounts.getIntegrationSecret.mockResolvedValue(null)
    accounts.addIntegrationSecret.mockResolvedValue(undefined)
    accounts.updateIntegrationSecret.mockResolvedValue(undefined)
    jest.mocked(getAccountClient).mockReturnValue(accounts as unknown as AccountClient)
    manager = new UserManager()
  })

  test.each([false, true])('stores user data without the live client, existing secret=%p', async (existing) => {
    accounts.getIntegrationSecret.mockResolvedValue(existing ? {} : null)
    const record = createRecord()
    const client = { graphql: jest.fn(), runtimeState: {} }
    client.runtimeState = client
    record.octokit = client as unknown as GithubUserRecord['octokit']

    await expect(manager.updateUser(record)).resolves.toBeUndefined()

    const writer = existing ? accounts.updateIntegrationSecret : accounts.addIntegrationSecret
    const unusedWriter = existing ? accounts.addIntegrationSecret : accounts.updateIntegrationSecret
    expect(writer).toHaveBeenCalledTimes(1)
    expect(unusedWriter).not.toHaveBeenCalled()
    const stored = JSON.parse(writer.mock.calls[0][0].secret)
    expect(stored).toEqual(createRecord())
    expect(stored).not.toHaveProperty('octokit')
    expect(record.octokit).toBe(client)
    expect(record.octokit?.graphql).toBe(client.graphql)
  })

  test.each(['login', 'reference'])('drops a legacy client husk when loading by %s', async (lookup) => {
    const record = createRecord()
    accounts.listIntegrationsSecrets.mockResolvedValue([
      createSecret({ ...record, octokit: { log: {}, rest: {}, retry: {} } })
    ])
    const loaded =
      lookup === 'login'
        ? await manager.getAccount(LOGIN)
        : await manager.getAccountByRef({ warn: jest.fn() } as unknown as MeasureContext, WORKSPACE, ACCOUNT)

    expect(loaded).toEqual(record)
    expect(loaded).not.toHaveProperty('octokit')
    expect(loaded?.octokit ?? 'construct-client').toBe('construct-client')
  })

  test.each(['login', 'reference'])('preserves a normal stored record when loading by %s', async (lookup) => {
    const record = createRecord()
    accounts.listIntegrationsSecrets.mockResolvedValue([createSecret(record)])
    const loaded =
      lookup === 'login'
        ? await manager.getAccount(LOGIN)
        : await manager.getAccountByRef({ warn: jest.fn() } as unknown as MeasureContext, WORKSPACE, ACCOUNT)

    expect(loaded).toEqual(record)
  })

  test('round trips an inserted user without reviving a client husk', async () => {
    const record = createRecord()
    record.octokit = { graphql: jest.fn(), log: {}, rest: {}, retry: {} } as unknown as GithubUserRecord['octokit']
    await manager.insertUser(record)
    accounts.listIntegrationsSecrets.mockResolvedValue([accounts.addIntegrationSecret.mock.calls[0][0]])

    const reloaded = await manager.getAccount(LOGIN)

    expect(reloaded).toEqual(createRecord())
    expect(reloaded).not.toHaveProperty('octokit')
    expect(record.octokit?.graphql).toEqual(expect.any(Function))
  })
})
