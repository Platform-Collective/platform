// SPDX-License-Identifier: EPL-2.0

import { getClient } from '@hcengineering/account-client'
import { type MeasureContext, type WorkspaceInfoWithStatus, type WorkspaceUuid } from '@hcengineering/core'
import { doRestoreWorkspace } from '@hcengineering/server-backup'
import { type PlatformQueueProducer, type QueueWorkspaceMessage, type StorageAdapter } from '@hcengineering/server-core'
import { createBackupPipeline } from '@hcengineering/server-pipeline'
import { buildStorageFromConfig } from '@hcengineering/server-storage'
import { WorkspaceWorker, type WorkspaceOptions } from '../service'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/mongo', () => ({ shutdownMongo: async () => {} }))
jest.mock('@hcengineering/postgres', () => ({ shutdownPostgres: async () => {} }))
jest.mock('@hcengineering/server-backup', () => ({ doRestoreWorkspace: jest.fn() }))
jest.mock('@hcengineering/server-client', () => ({
  withRetryConnUntilSuccess: (fn: () => Promise<void>) => fn,
  withRetryConnUntilTimeout: (fn: () => Promise<void>) => fn
}))
jest.mock('@hcengineering/server-pipeline', () => ({ createBackupPipeline: jest.fn() }))
jest.mock('@hcengineering/server-storage', () => ({
  storageConfigFromEnv: jest.fn(),
  buildStorageFromConfig: jest.fn()
}))
jest.mock('@hcengineering/server-token', () => ({ generateToken: () => 'token' }))
jest.mock('@hcengineering/server-tool', () => ({ prepareTools: () => ({ dbUrl: 'db' }) }))
jest.mock('../ws-operations', () => ({}))

// Exercise the orchestration and resource boundary without starting the worker loop.
interface RestoreWorker {
  doWorkspaceOperation: (
    ctx: MeasureContext,
    workspace: WorkspaceInfoWithStatus,
    opt: WorkspaceOptions
  ) => Promise<void>
  doRestore: (ctx: MeasureContext, workspace: WorkspaceInfoWithStatus, opt: WorkspaceOptions) => Promise<boolean>
  _upgradeWorkspace: jest.Mock
}

describe('workspace restore', () => {
  const ctx = { error: jest.fn(), info: jest.fn() } as unknown as MeasureContext
  let worker: RestoreWorker
  let workspace: WorkspaceInfoWithStatus
  let opt: WorkspaceOptions
  let send: jest.Mock
  let updateWorkspaceInfo: jest.Mock
  let close: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    send = jest.fn().mockResolvedValue(undefined)
    updateWorkspaceInfo = jest.fn().mockResolvedValue(undefined)
    close = jest.fn().mockResolvedValue(undefined)
    jest.mocked(getClient).mockReturnValue({ updateWorkspaceInfo } as unknown as ReturnType<typeof getClient>)
    jest
      .mocked(buildStorageFromConfig)
      .mockReturnValue({ close } as unknown as ReturnType<typeof buildStorageFromConfig>)
    jest.mocked(doRestoreWorkspace).mockResolvedValue(true)
    worker = new WorkspaceWorker(
      { send } as unknown as PlatformQueueProducer<QueueWorkspaceMessage>,
      { major: 1, minor: 0, patch: 0 },
      [],
      [],
      '',
      1,
      'all+backup',
      {},
      undefined,
      'accounts',
      'accounts-db'
    ) as unknown as RestoreWorker
    worker._upgradeWorkspace = jest.fn().mockResolvedValue(undefined)
    workspace = {
      uuid: 'workspace' as WorkspaceUuid,
      url: 'workspace',
      mode: 'pending-restore'
    } as unknown as WorkspaceInfoWithStatus
    opt = {
      errorHandler: jest.fn().mockResolvedValue(undefined),
      force: false,
      console: false,
      logs: '',
      waitTimeout: 1000,
      backup: { backupStorage: {} as unknown as StorageAdapter, bucketName: 'backup' }
    }
  })

  function events (): string[] {
    return updateWorkspaceInfo.mock.calls.map((call) => call[1])
  }

  test('false without an error callback sends failure and preserves analytics', async () => {
    jest.mocked(doRestoreWorkspace).mockResolvedValue(false)
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['restore-started', 'restore-failed'])
    expect(opt.errorHandler).toHaveBeenCalledWith(workspace, expect.any(Error))
    expect(close).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(worker._upgradeWorkspace).not.toHaveBeenCalled()
  })

  test('missing backup configuration sends failure', async () => {
    opt.backup = undefined
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['restore-started', 'restore-failed'])
    expect(doRestoreWorkspace).not.toHaveBeenCalled()
  })

  test('missing metadata or another restore exception sends a public-safe failure', async () => {
    const err = new Error('backup.json.gz should present to restore: private bucket')
    jest.mocked(doRestoreWorkspace).mockRejectedValue(err)
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['restore-started', 'restore-failed'])
    expect(updateWorkspaceInfo.mock.calls[1][4]).toBe('Restore failed. Retry or contact support.')
    expect(opt.errorHandler).toHaveBeenCalledWith(workspace, err)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test.each(['storage', 'pipeline'])('%s setup exceptions send failure', async (setup) => {
    const err = new Error('setup failed')
    if (setup === 'storage') {
      jest.mocked(buildStorageFromConfig).mockImplementationOnce(() => {
        throw err
      })
    } else {
      jest.mocked(createBackupPipeline).mockImplementationOnce(() => {
        throw err
      })
    }
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['restore-started', 'restore-failed'])
    expect(opt.errorHandler).toHaveBeenCalledWith(workspace, err)
    expect(close).toHaveBeenCalledTimes(setup === 'pipeline' ? 1 : 0)
  })

  test('cleanup rejection sends failure', async () => {
    close.mockRejectedValueOnce(new Error('close failed'))
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['restore-started', 'restore-failed'])
    expect(send).not.toHaveBeenCalled()
  })

  test('cleanup does not mask the original restore exception', async () => {
    const err = new Error('original restore failure')
    jest.mocked(doRestoreWorkspace).mockRejectedValueOnce(err)
    close.mockRejectedValueOnce(new Error('close failed'))
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['restore-started', 'restore-failed'])
    expect(opt.errorHandler).toHaveBeenCalledWith(workspace, err)
  })

  test('a transient failure followed by success keeps upgrade and restored notification', async () => {
    jest.mocked(doRestoreWorkspace).mockResolvedValueOnce(false)
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    workspace.mode = 'restoring'
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['restore-started', 'restore-failed', 'restore-started', 'restore-done'])
    expect(workspace.mode).toBe('active')
    expect(worker._upgradeWorkspace).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(opt.errorHandler).toHaveBeenCalledTimes(1)
  })

  test('an upgrade failure after restore success is not reported as restore-failed', async () => {
    worker._upgradeWorkspace.mockRejectedValueOnce(new Error('upgrade failed'))
    await expect(worker.doWorkspaceOperation(ctx, workspace, opt)).rejects.toThrow('upgrade failed')
    expect(events()).toEqual(['restore-started', 'restore-done'])
  })
})
