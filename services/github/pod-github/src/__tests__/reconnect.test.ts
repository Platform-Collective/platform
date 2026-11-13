// SPDX-License-Identifier: EPL-2.0

import { getClient as getAccountClient } from '@hcengineering/account-client'
import { ClientConnectEvent, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import { getTransactorEndpoint } from '@hcengineering/server-client'
import { PlatformWorker } from '../platform'
import type { GithubWorker } from '../worker'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/server-client', () => ({ getTransactorEndpoint: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: jest.fn(() => 'workspace-token') }))
jest.mock('@hcengineering/server-storage', () => ({}))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/analytics-service', () => ({}))
jest.mock('octokit', () => ({}))
jest.mock('../client', () => ({}))
jest.mock('../config', () => ({
  __esModule: true,
  default: { AccountsURL: 'accounts', WorkspaceInactivityInterval: 0 }
}))
jest.mock('../loaders', () => ({}))
jest.mock('../notifications', () => ({}))
jest.mock('../sync/utils', () => ({}))
jest.mock('../users', () => ({}))
jest.mock('../worker', () => ({}))

const workspace = '00000000-0000-0000-0000-000000000001' as WorkspaceUuid
const endpoint = 'wss://old-region'

describe('workspace connection revalidation', () => {
  let platform: PlatformWorker
  let worker: GithubWorker
  let clients: Map<WorkspaceUuid, GithubWorker>
  let ctx: MeasureContext
  let getWorkspaceInfo: jest.Mock
  let triggerCheckWorkspaces: jest.Mock
  let close: jest.Mock
  let refreshClient: jest.Mock
  let logError: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    logError = jest.fn()
    ctx = { info: jest.fn(), warn: jest.fn(), error: logError } as unknown as MeasureContext
    close = jest.fn().mockResolvedValue(undefined)
    refreshClient = jest.fn().mockResolvedValue(undefined)
    worker = {
      ctx,
      close,
      refreshClient
    } as unknown as GithubWorker
    clients = new Map([[workspace, worker]])
    triggerCheckWorkspaces = jest.fn()
    platform = Object.assign(Object.create(PlatformWorker.prototype) as PlatformWorker, {
      ctx,
      clients,
      checkedWorkspaces: new Set<string>(),
      triggerCheckWorkspaces
    })
    getWorkspaceInfo = jest.fn().mockResolvedValue({ uuid: workspace, mode: 'active' })
    jest
      .mocked(getAccountClient)
      .mockReturnValue({ getWorkspaceInfo } as unknown as ReturnType<typeof getAccountClient>)
    jest.mocked(getTransactorEndpoint).mockResolvedValue(endpoint)
  })

  async function checkConnection (event: ClientConnectEvent | undefined): Promise<void> {
    await platform.checkReconnect(workspace, event, worker, endpoint)
    await new Promise(setImmediate)
  }

  it.each([ClientConnectEvent.Reconnected, undefined])(
    'recreates the worker on endpoint change for event %s',
    async (event) => {
      jest.mocked(getTransactorEndpoint).mockResolvedValue('wss://new-region')

      await checkConnection(event)

      expect(getTransactorEndpoint).toHaveBeenCalledWith('workspace-token')
      expect(clients.has(workspace)).toBe(false)
      expect(close).toHaveBeenCalledTimes(1)
      expect(triggerCheckWorkspaces).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps the worker when the endpoint is unchanged', async () => {
    await checkConnection(ClientConnectEvent.Reconnected)

    expect(getTransactorEndpoint).toHaveBeenCalledWith('workspace-token')
    expect(clients.get(workspace)).toBe(worker)
    expect(close).not.toHaveBeenCalled()
    expect(triggerCheckWorkspaces).not.toHaveBeenCalled()
  })

  it.each([ClientConnectEvent.Refresh, ClientConnectEvent.Upgraded])(
    'preserves query refresh for event %s',
    async (event) => {
      await checkConnection(event)

      expect(refreshClient).toHaveBeenCalledWith(event === ClientConnectEvent.Upgraded)
      expect(clients.get(workspace)).toBe(worker)
    }
  )

  it('still removes disabled workspaces without recreating them', async () => {
    getWorkspaceInfo.mockResolvedValue({ uuid: workspace, mode: 'active', isDisabled: true })

    await checkConnection(ClientConnectEvent.Reconnected)

    expect(clients.has(workspace)).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
    expect(getTransactorEndpoint).not.toHaveBeenCalled()
    expect(triggerCheckWorkspaces).not.toHaveBeenCalled()
  })

  it('keeps the worker and reports endpoint lookup failures', async () => {
    const error = new Error('Accounts unavailable')
    jest.mocked(getTransactorEndpoint).mockRejectedValue(error)

    await checkConnection(ClientConnectEvent.Reconnected)

    expect(clients.get(workspace)).toBe(worker)
    expect(close).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(expect.any(String), { workspace, error })
    expect(triggerCheckWorkspaces).not.toHaveBeenCalled()
  })

  it('ignores endpoint results for a worker that has already been replaced', async () => {
    let resolveEndpoint!: (value: string) => void
    jest.mocked(getTransactorEndpoint).mockReturnValue(
      new Promise((resolve) => {
        resolveEndpoint = resolve
      })
    )
    const check = checkConnection(ClientConnectEvent.Reconnected)
    await new Promise(setImmediate)
    const replacement = {} as unknown as GithubWorker
    clients.set(workspace, replacement)
    resolveEndpoint('wss://new-region')
    await check

    expect(clients.get(workspace)).toBe(replacement)
    expect(close).not.toHaveBeenCalled()
    expect(triggerCheckWorkspaces).not.toHaveBeenCalled()
  })

  it('closes the stale worker only once for overlapping checks', async () => {
    jest.mocked(getTransactorEndpoint).mockResolvedValue('wss://new-region')

    await Promise.all([checkConnection(ClientConnectEvent.Reconnected), checkConnection(undefined)])

    expect(close).toHaveBeenCalledTimes(1)
    expect(triggerCheckWorkspaces).toHaveBeenCalledTimes(1)
  })

  it('schedules recreation even if the stale worker fails to close', async () => {
    jest.mocked(getTransactorEndpoint).mockResolvedValue('wss://new-region')
    close.mockRejectedValue(new Error('Close failed'))

    await checkConnection(undefined)

    expect(clients.has(workspace)).toBe(false)
    expect(triggerCheckWorkspaces).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalled()
  })
})
