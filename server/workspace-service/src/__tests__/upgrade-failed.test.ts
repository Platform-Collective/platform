// SPDX-License-Identifier: EPL-2.0

import { getClient } from '@hcengineering/account-client'
import {
  type Client,
  type MeasureContext,
  type WorkspaceInfoWithStatus,
  type WorkspaceMode,
  type WorkspaceUuid
} from '@hcengineering/core'
import {
  type Pipeline,
  type PlatformQueueProducer,
  type QueueWorkspaceMessage,
  type StorageAdapter
} from '@hcengineering/server-core'
import { getServerPipeline, getTxAdapterFactory } from '@hcengineering/server-pipeline'
import { buildStorageFromConfig } from '@hcengineering/server-storage'
import { upgradeModel } from '@hcengineering/server-tool'
import { WorkspaceWorker, type WorkspaceOptions } from '../service'
import { createWorkspace, upgradeWorkspace, upgradeWorkspaceWith } from '../ws-operations'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/mongo', () => ({ shutdownMongo: async () => {} }))
jest.mock('@hcengineering/postgres', () => ({ shutdownPostgres: async () => {} }))
jest.mock('@hcengineering/server-backup', () => ({ doRestoreWorkspace: jest.fn() }))
jest.mock('@hcengineering/server-client', () => ({
  getTransactorEndpoint: jest.fn(async () => 'ws://transactor'),
  withRetryConnUntilSuccess: (fn: () => Promise<void>) => fn,
  withRetryConnUntilTimeout: (fn: () => Promise<void>) => fn
}))
jest.mock('@hcengineering/server-pipeline', () => ({
  createBackupPipeline: jest.fn(),
  getServerPipeline: jest.fn(),
  getTxAdapterFactory: jest.fn()
}))
jest.mock('@hcengineering/server-storage', () => ({
  storageConfigFromEnv: jest.fn(),
  buildStorageFromConfig: jest.fn()
}))
jest.mock('@hcengineering/server-token', () => ({ generateToken: () => 'token' }))
jest.mock('@hcengineering/server-tool', () => ({
  initializeWorkspace: jest.fn(),
  initModel: jest.fn(),
  prepareTools: () => ({ dbUrl: 'db' }),
  updateModel: jest.fn(),
  upgradeModel: jest.fn()
}))

const version = { major: 1, minor: 2, patch: 3 }

describe('upgradeWorkspaceWith failure report', () => {
  const ctx = { error: jest.fn(), info: jest.fn() } as unknown as MeasureContext
  const workspace = {
    uuid: 'workspace' as WorkspaceUuid,
    url: 'workspace',
    versionMajor: 1,
    versionMinor: 2,
    versionPatch: 2
  } as unknown as WorkspaceInfoWithStatus
  let handleWsEvent: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    handleWsEvent = jest.fn().mockResolvedValue(undefined)
    jest.mocked(upgradeModel).mockRejectedValue(new Error('2 migrations failed and remain pending: a/b, c/d'))
  })

  function upgrade (mode: 'upgrade' | 'create'): Promise<void> {
    return upgradeWorkspaceWith(
      ctx,
      version,
      [],
      [],
      workspace,
      { context: { modelDb: {} } } as unknown as Pipeline,
      {} as unknown as Client,
      {} as unknown as StorageAdapter,
      {} as unknown as Parameters<typeof upgradeWorkspaceWith>[8],
      {} as unknown as PlatformQueueProducer<QueueWorkspaceMessage>,
      undefined,
      handleWsEvent,
      true,
      'skip',
      false,
      mode
    )
  }

  test('reports a failed upgrade to the account service and rethrows', async () => {
    await expect(upgrade('upgrade')).rejects.toThrow('2 migrations failed and remain pending: a/b, c/d')
    expect(handleWsEvent.mock.calls.map((call) => call[0])).toEqual(['upgrade-started', 'upgrade-failed'])
    expect(handleWsEvent).toHaveBeenLastCalledWith(
      'upgrade-failed',
      version,
      0,
      'Upgrade failed: 2 migrations failed and remain pending: a/b, c/d'
    )
  })

  test('keeps the original error when the failure report fails', async () => {
    handleWsEvent.mockImplementation(async (event: string) => {
      if (event === 'upgrade-failed') throw new Error('account service unavailable')
    })
    await expect(upgrade('upgrade')).rejects.toThrow('2 migrations failed and remain pending')
  })

  test('keeps internal details of other errors out of the failure report', async () => {
    jest.mocked(upgradeModel).mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:26257'))
    await expect(upgrade('upgrade')).rejects.toThrow('connect ECONNREFUSED 10.1.2.3:26257')
    expect(handleWsEvent).toHaveBeenLastCalledWith('upgrade-failed', version, 0, 'Upgrade failed')
    expect(ctx.error).toHaveBeenCalledWith('upgrade-failed', { message: 'connect ECONNREFUSED 10.1.2.3:26257' })
  })

  test('only pings with the reason while a workspace is created', async () => {
    await expect(upgrade('create')).rejects.toThrow()
    expect(handleWsEvent).toHaveBeenLastCalledWith(
      'ping',
      version,
      0,
      'Upgrade failed: 2 migrations failed and remain pending: a/b, c/d'
    )
    expect(handleWsEvent.mock.calls.map((call) => call[0])).not.toContain('upgrade-failed')
  })
})

describe('upgradeWorkspace failure before the upgrade starts', () => {
  const ctx = { error: jest.fn(), info: jest.fn() } as unknown as MeasureContext
  let handleWsEvent: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    handleWsEvent = jest.fn().mockResolvedValue(undefined)
    jest.mocked(getServerPipeline).mockRejectedValue(new Error('database unavailable'))
  })

  function upgrade (versionPatch: number, forceUpdate: boolean): Promise<void> {
    const workspace = {
      uuid: 'workspace' as WorkspaceUuid,
      url: 'workspace',
      versionMajor: 1,
      versionMinor: 2,
      versionPatch
    } as unknown as WorkspaceInfoWithStatus
    return upgradeWorkspace(
      ctx,
      version,
      [],
      [],
      {} as unknown as Parameters<typeof upgradeWorkspace>[4],
      workspace,
      undefined,
      { getQueue: jest.fn() } as unknown as PlatformQueueProducer<QueueWorkspaceMessage>,
      handleWsEvent,
      forceUpdate
    )
  }

  test('reports a failed pipeline setup as a started and failed upgrade', async () => {
    await expect(upgrade(2, false)).rejects.toThrow('database unavailable')
    expect(handleWsEvent.mock.calls).toEqual([
      ['upgrade-started', version, 0],
      ['upgrade-failed', version, 0, 'Upgrade failed']
    ])
  })

  test('keeps the original error when the failure report fails', async () => {
    handleWsEvent.mockRejectedValue(new Error('account service unavailable'))
    await expect(upgrade(2, false)).rejects.toThrow('database unavailable')
  })

  test('does not report a workspace that needs no upgrade', async () => {
    await expect(upgrade(3, false)).rejects.toThrow('database unavailable')
    expect(handleWsEvent).not.toHaveBeenCalled()
  })
})

describe('createWorkspace failure report', () => {
  test('pings without internal error details when the creation fails', async () => {
    jest.clearAllMocks()
    const child = { info: jest.fn(), error: jest.fn(), end: jest.fn() }
    const ctx = {
      error: jest.fn(),
      info: jest.fn(),
      getParams: () => ({}),
      newChild: () => child
    } as unknown as MeasureContext
    const handleWsEvent = jest.fn().mockResolvedValue(undefined)
    jest
      .mocked(buildStorageFromConfig)
      .mockReturnValueOnce({ close: jest.fn() } as unknown as ReturnType<typeof buildStorageFromConfig>)
    jest.mocked(getServerPipeline).mockResolvedValueOnce({ close: jest.fn() } as unknown as Pipeline)
    jest.mocked(getTxAdapterFactory).mockReturnValueOnce(async () => {
      throw new Error('connect ECONNREFUSED 10.1.2.3:26257')
    })
    const workspace = { uuid: 'workspace', url: 'workspace' } as unknown as WorkspaceInfoWithStatus

    await expect(
      createWorkspace(
        ctx,
        version,
        null,
        workspace,
        [],
        [],
        {} as unknown as Parameters<typeof createWorkspace>[6],
        { getQueue: jest.fn() } as unknown as PlatformQueueProducer<QueueWorkspaceMessage>,
        handleWsEvent
      )
    ).rejects.toThrow('connect ECONNREFUSED 10.1.2.3:26257')
    expect(handleWsEvent).toHaveBeenLastCalledWith('ping', version, 0, 'Create failed')
  })
})

describe('worker with a failed upgrade', () => {
  test.each(['upgrade-failed', 'upgrading'] as WorkspaceMode[])(
    'upgrades a workspace claimed in %s mode again',
    async (mode) => {
      const ctx = { error: jest.fn(), info: jest.fn() } as unknown as MeasureContext
      jest
        .mocked(getClient)
        .mockReturnValue({ updateWorkspaceInfo: jest.fn() } as unknown as ReturnType<typeof getClient>)
      const worker = new WorkspaceWorker(
        { send: jest.fn() } as unknown as PlatformQueueProducer<QueueWorkspaceMessage>,
        version,
        [],
        [],
        '',
        1,
        'upgrade',
        {},
        undefined,
        'accounts',
        'accounts-db'
      ) as unknown as {
        doWorkspaceOperation: (
          ctx: MeasureContext,
          workspace: WorkspaceInfoWithStatus,
          opt: WorkspaceOptions
        ) => Promise<void>
        _upgradeWorkspace: jest.Mock
      }
      worker._upgradeWorkspace = jest.fn().mockResolvedValue(undefined)
      const workspace = { uuid: 'workspace', url: 'workspace', mode } as unknown as WorkspaceInfoWithStatus
      await worker.doWorkspaceOperation(ctx, workspace, {} as unknown as WorkspaceOptions)
      expect(worker._upgradeWorkspace).toHaveBeenCalledWith(ctx, workspace, {})
      expect(ctx.error).not.toHaveBeenCalledWith('Unknown workspace mode', expect.anything())
    }
  )
})
