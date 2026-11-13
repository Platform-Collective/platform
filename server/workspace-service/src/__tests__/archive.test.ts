// SPDX-License-Identifier: EPL-2.0

import { getClient } from '@hcengineering/account-client'
import { type MeasureContext, type WorkspaceInfoWithStatus, type WorkspaceUuid } from '@hcengineering/core'
import { doBackupWorkspace } from '@hcengineering/server-backup'
import { type PlatformQueueProducer, type QueueWorkspaceMessage, type StorageAdapter } from '@hcengineering/server-core'
import { buildStorageFromConfig } from '@hcengineering/server-storage'
import { WorkspaceWorker, type WorkspaceOptions } from '../service'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('@hcengineering/mongo', () => ({ shutdownMongo: async () => {} }))
jest.mock('@hcengineering/postgres', () => ({ shutdownPostgres: async () => {} }))
jest.mock('@hcengineering/server-backup', () => ({ doBackupWorkspace: jest.fn() }))
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

// Exercise the archiving orchestration without starting the worker loop.
interface ArchiveWorker {
  doWorkspaceOperation: (
    ctx: MeasureContext,
    workspace: WorkspaceInfoWithStatus,
    opt: WorkspaceOptions
  ) => Promise<void>
}

describe('workspace archiving', () => {
  const ctx = { error: jest.fn(), info: jest.fn() } as unknown as MeasureContext
  let worker: ArchiveWorker
  let opt: WorkspaceOptions
  let updateWorkspaceInfo: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    updateWorkspaceInfo = jest.fn().mockResolvedValue(undefined)
    jest.mocked(getClient).mockReturnValue({ updateWorkspaceInfo } as unknown as ReturnType<typeof getClient>)
    jest
      .mocked(buildStorageFromConfig)
      .mockReturnValue({ close: jest.fn().mockResolvedValue(undefined) } as unknown as ReturnType<
        typeof buildStorageFromConfig
      >)
    worker = new WorkspaceWorker(
      { send: jest.fn().mockResolvedValue(undefined) } as unknown as PlatformQueueProducer<QueueWorkspaceMessage>,
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
    ) as unknown as ArchiveWorker
    opt = {
      errorHandler: jest.fn().mockResolvedValue(undefined),
      force: false,
      console: false,
      logs: '',
      waitTimeout: 1000,
      backup: { backupStorage: {} as unknown as StorageAdapter, bucketName: 'backup' }
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function events (): string[] {
    return updateWorkspaceInfo.mock.calls.map((call) => call[1])
  }

  const workspace = {
    uuid: 'workspace' as WorkspaceUuid,
    url: 'workspace',
    mode: 'archiving-pending-backup'
  } as unknown as WorkspaceInfoWithStatus

  test('does not report the archive backup as done when the backup failed or is incomplete', async () => {
    jest.mocked(doBackupWorkspace).mockResolvedValue(false)
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(doBackupWorkspace).toHaveBeenCalledTimes(1)
    // Without "archiving-backup-done" the workspace never reaches the cleanup step that deletes its database.
    expect(events()).toEqual(['archiving-backup-started'])
  })

  test('reports the archive backup as done after a complete backup', async () => {
    jest.mocked(doBackupWorkspace).mockResolvedValue(true)
    await worker.doWorkspaceOperation(ctx, workspace, opt)
    expect(events()).toEqual(['archiving-backup-started', 'archiving-backup-done'])
  })
})
