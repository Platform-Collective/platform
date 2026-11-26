// SPDX-License-Identifier: EPL-2.0

import type { AccountClient } from '@hcengineering/account-client'
import type { Client, MeasureContext, PersonId, WorkspaceUuid } from '@hcengineering/core'
import type { GithubWorker } from '../worker'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: jest.fn(() => 'test-token') }))
jest.mock('@hcengineering/server-storage', () => ({}))
jest.mock('@hcengineering/analytics-service', () => ({}))
jest.mock('octokit', () => ({}))
jest.mock('../client', () => ({ createPlatformClient: jest.fn() }))
jest.mock('../config', () => ({ __esModule: true, default: { AccountsURL: 'http://accounts' } }))
jest.mock('../loaders', () => ({ registerLoaders: jest.fn() }))
jest.mock('../notifications', () => ({}))
jest.mock('../sync/utils', () => ({}))
jest.mock('../users', () => ({ UserManager: jest.fn() }))
jest.mock('../worker', () => ({}))

import { getClient as getAccountClient } from '@hcengineering/account-client'
import github, { githubIntegrationKind } from '@hcengineering/github'
import { createPlatformClient } from '../client'
import { PlatformWorker } from '../platform'

const WORKSPACE_A = 'workspace-a' as WorkspaceUuid
const WORKSPACE_B = 'workspace-b' as WorkspaceUuid
const WORKSPACE_C = 'workspace-c' as WorkspaceUuid
const ACCOUNT = 'github:account' as PersonId
const OTHER_ACCOUNT = 'github:other-account' as PersonId
const INSTALLATION_ID = 123

interface MockClient {
  findAll: jest.Mock<Promise<never[]>, []>
  close: jest.Mock<Promise<void>, []>
}

interface MockWorker {
  client: MockClient
  reloadRepositories: jest.Mock<Promise<void>, [MeasureContext, number]>
  triggerUpdate: jest.Mock<void, []>
}

interface TestPlatformWorker extends Pick<PlatformWorker, keyof PlatformWorker> {
  clients: Map<WorkspaceUuid, GithubWorker>
  updateInstallation: (installationId: number) => Promise<void>
}

function createClient (): MockClient {
  return { findAll: jest.fn().mockResolvedValue([]), close: jest.fn().mockResolvedValue(undefined) }
}

function createWorker (): MockWorker {
  return {
    client: createClient(),
    reloadRepositories: jest.fn().mockResolvedValue(undefined),
    triggerUpdate: jest.fn()
  }
}

describe('PlatformWorker.mapInstallation', () => {
  const accounts = {
    createIntegration: jest.fn().mockResolvedValue(undefined),
    updateIntegration: jest.fn().mockResolvedValue(undefined),
    deleteIntegration: jest.fn().mockResolvedValue(undefined)
  }
  let platform: TestPlatformWorker
  let ctx: MeasureContext

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAccountClient).mockReturnValue(accounts as unknown as AccountClient)
    ctx = { info: jest.fn(), error: jest.fn() } as unknown as MeasureContext
    platform = Reflect.construct(PlatformWorker, [ctx, {}, {}]) as TestPlatformWorker
    jest.spyOn(platform, 'updateInstallation').mockResolvedValue(undefined)
    platform.triggerCheckWorkspaces = jest.fn()
    platform.integrations = [{ workspace: WORKSPACE_A, accountId: ACCOUNT, installationId: [INSTALLATION_ID] }]
  })

  function connectWorker (workspace: WorkspaceUuid): MockWorker {
    const worker = createWorker()
    platform.clients.set(workspace, worker as unknown as GithubWorker)
    return worker
  }

  it('moves A → B → C without retaining stale mappings or cleaning the wrong workspace', async () => {
    const workerA = connectWorker(WORKSPACE_A)
    const workerB = connectWorker(WORKSPACE_B)
    const workerC = connectWorker(WORKSPACE_C)

    await platform.mapInstallation(ctx, WORKSPACE_B, INSTALLATION_ID, ACCOUNT)
    await platform.mapInstallation(ctx, WORKSPACE_C, INSTALLATION_ID, ACCOUNT)

    expect(platform.integrations).toEqual([
      { workspace: WORKSPACE_C, accountId: ACCOUNT, installationId: [INSTALLATION_ID] }
    ])
    expect(accounts.deleteIntegration.mock.calls).toEqual([
      [{ kind: githubIntegrationKind, workspaceUuid: WORKSPACE_A, socialId: ACCOUNT }],
      [{ kind: githubIntegrationKind, workspaceUuid: WORKSPACE_B, socialId: ACCOUNT }]
    ])
    expect(workerA.client.findAll).toHaveBeenCalledTimes(1)
    expect(workerB.client.findAll).toHaveBeenCalledWith(github.class.GithubIntegration, {
      installationId: INSTALLATION_ID
    })
    expect(workerB.reloadRepositories).toHaveBeenCalledTimes(2)
    expect(workerC.reloadRepositories).toHaveBeenCalledWith(ctx, INSTALLATION_ID)
    expect(workerC.triggerUpdate).toHaveBeenCalledTimes(1)
    expect(platform.triggerCheckWorkspaces).toHaveBeenCalledTimes(2)
  })

  it('persists remaining installations and cleans every old workspace once', async () => {
    const workerA = connectWorker(WORKSPACE_A)
    const workerB = connectWorker(WORKSPACE_B)
    platform.integrations[0].installationId.push(456)
    platform.integrations.push(
      { workspace: WORKSPACE_A, accountId: OTHER_ACCOUNT, installationId: [INSTALLATION_ID] },
      { workspace: WORKSPACE_B, accountId: ACCOUNT, installationId: [INSTALLATION_ID] },
      { workspace: WORKSPACE_C, accountId: ACCOUNT, installationId: [789] }
    )

    await platform.mapInstallation(ctx, WORKSPACE_C, INSTALLATION_ID, ACCOUNT)

    expect(platform.integrations).toEqual([
      { workspace: WORKSPACE_A, accountId: ACCOUNT, installationId: [456] },
      { workspace: WORKSPACE_C, accountId: ACCOUNT, installationId: [789, INSTALLATION_ID] }
    ])
    expect(accounts.updateIntegration).toHaveBeenCalledWith({
      kind: githubIntegrationKind,
      workspaceUuid: WORKSPACE_A,
      socialId: ACCOUNT,
      data: { installationId: [456] }
    })
    expect(accounts.updateIntegration).toHaveBeenCalledWith({
      kind: githubIntegrationKind,
      workspaceUuid: WORKSPACE_C,
      socialId: ACCOUNT,
      data: { installationId: [789, INSTALLATION_ID] }
    })
    expect(accounts.deleteIntegration.mock.calls).toEqual([
      [{ kind: githubIntegrationKind, workspaceUuid: WORKSPACE_A, socialId: OTHER_ACCOUNT }],
      [{ kind: githubIntegrationKind, workspaceUuid: WORKSPACE_B, socialId: ACCOUNT }]
    ])
    for (const worker of [workerA, workerB]) {
      expect(worker.client.findAll).toHaveBeenCalledTimes(1)
      expect(worker.reloadRepositories).toHaveBeenCalledWith(ctx, INSTALLATION_ID)
    }
    expect(accounts.createIntegration).not.toHaveBeenCalled()
  })

  it('cleans a disconnected workspace using the newly connected client and closes it', async () => {
    const client = createClient()
    jest.mocked(createPlatformClient).mockResolvedValue({ client: client as unknown as Client, endpoint: 'test' })

    await platform.mapInstallation(ctx, WORKSPACE_B, INSTALLATION_ID, ACCOUNT)

    expect(createPlatformClient).toHaveBeenCalledWith(ctx, WORKSPACE_A, 30000)
    expect(client.findAll).toHaveBeenCalledWith(github.class.GithubIntegration, { installationId: INSTALLATION_ID })
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(ctx.error).not.toHaveBeenCalled()
  })

  it('closes the temporary client and reports cleanup failures', async () => {
    const client = createClient()
    client.findAll.mockRejectedValue(new Error('workspace unavailable'))
    jest.mocked(createPlatformClient).mockResolvedValue({ client: client as unknown as Client, endpoint: 'test' })

    await platform.mapInstallation(ctx, WORKSPACE_B, INSTALLATION_ID, ACCOUNT)

    expect(client.findAll).toHaveBeenCalledTimes(1)
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(ctx.error).toHaveBeenCalledWith('failed to remove old installation from workspace', {
      workspace: WORKSPACE_A,
      installationId: INSTALLATION_ID
    })
  })

  it('refreshes a mapping in the same workspace without duplicating or removing it', async () => {
    const worker = connectWorker(WORKSPACE_A)

    await platform.mapInstallation(ctx, WORKSPACE_A, INSTALLATION_ID, ACCOUNT)

    expect(platform.integrations).toEqual([
      { workspace: WORKSPACE_A, accountId: ACCOUNT, installationId: [INSTALLATION_ID] }
    ])
    expect(accounts.createIntegration).not.toHaveBeenCalled()
    expect(accounts.updateIntegration).not.toHaveBeenCalled()
    expect(accounts.deleteIntegration).not.toHaveBeenCalled()
    expect(worker.client.findAll).not.toHaveBeenCalled()
    expect(worker.reloadRepositories).toHaveBeenCalledWith(ctx, INSTALLATION_ID)
    expect(worker.triggerUpdate).toHaveBeenCalledTimes(1)
  })
})
