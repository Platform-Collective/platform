// SPDX-License-Identifier: EPL-2.0

import { getAccountDB, type AccountDB } from '@hcengineering/account'
import { type MeasureContext, type WorkspaceInfoWithStatus, type WorkspaceUuid } from '@hcengineering/core'
import { getAccountClient } from '@hcengineering/server-client'
import { type DbConfiguration, type PipelineFactory, type StorageAdapter } from '@hcengineering/server-core'
import { backup } from '../backup'
import { BackupWorker, type BackupConfig } from '../service'

jest.mock('@hcengineering/account', () => ({ getAccountDB: jest.fn() }))
jest.mock('@hcengineering/server-client', () => ({ getAccountClient: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: () => 'test-token' }))
jest.mock('../storage', () => ({ createStorageBackupStorage: jest.fn().mockResolvedValue({}) }))
jest.mock('../restore', () => ({}))
jest.mock('../backup', () => ({ backup: jest.fn() }))

describe('backup attempt scheduling', () => {
  const now = 10000000
  const ctx = {
    warn: jest.fn(), error: jest.fn(), info: jest.fn(),
    newChild: () => ctx,
    with: async (_name: string, _params: object, fn: (ctx: MeasureContext) => Promise<unknown>) =>
      await fn(ctx as unknown as MeasureContext)
  }
  let workspaces: WorkspaceInfoWithStatus[]
  let updateBackupInfo: jest.Mock

  function workspace (id: string, lastBackup: number, lastAttempt?: number): WorkspaceInfoWithStatus {
    const backupInfo = { lastBackup, lastAttempt, backups: 2, backupSize: 1, dataSize: 2, blobsSize: 3 }
    return {
      uuid: id as WorkspaceUuid, url: id, name: id, mode: 'active', createdOn: 0,
      lastVisit: now, versionMajor: 0, versionMinor: 0, versionPatch: 0,
      processingAttemps: 0, backupInfo
    }
  }

  function worker (interval = 100): BackupWorker {
    return new BackupWorker(
      {} as StorageAdapter,
      { Parallel: 1, Interval: interval, SkipWorkspaces: '', Token: 'test-token', Timeout: 1 } as BackupConfig,
      jest.fn().mockResolvedValue({ close: jest.fn() }) as PipelineFactory,
      () => ({} as DbConfiguration),
      ''
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Date, 'now').mockReturnValue(now)
    workspaces = []
    updateBackupInfo = jest.fn().mockResolvedValue(undefined)
    jest.mocked(getAccountClient).mockReturnValue({
      listWorkspaces: async () => workspaces, updateBackupInfo
    } as unknown as ReturnType<typeof getAccountClient>)
    jest.mocked(getAccountDB).mockResolvedValue([{} as AccountDB, jest.fn()])
    jest.mocked(backup).mockResolvedValue({ result: false, backupSize: 10, dataSize: 20, blobsSize: 30 })
  })

  afterEach(() => { jest.restoreAllMocks() })

  it('defers a recently attempted failed workspace even when its last successful backup is old', async () => {
    workspaces = [workspace('failed', 1, now - 1000), workspace('due', 2)]
    const runner = worker()
    await runner.recheckWorkspaces(ctx as unknown as MeasureContext)
    expect([...runner.workspacesToBackup.keys()]).toEqual(['due'])
  })

  it('orders eligible workspaces by last attempt, with last success as the fallback', async () => {
    workspaces = [workspace('failed', 1, now - 200000), workspace('due', 2)]
    const runner = worker(0)
    await runner.recheckWorkspaces(ctx as unknown as MeasureContext)
    expect([...runner.workspacesToBackup.keys()]).toEqual(['due', 'failed'])
  })

  it.each([now - 300000, undefined])(
    'retries an elapsed unsuccessful attempt without another visit (lastVisit %s)',
    async (lastVisit) => {
      const failed = { ...workspace('failed', 1, now - 200000), lastVisit }
      const successful = { ...workspace('successful', now - 200000, now - 200000), lastVisit }
      const recent = { ...workspace('recent', 1, now - 1000), lastVisit }
      const inactive = { ...workspace('inactive', 1, now - 200000), lastVisit, mode: 'archived' as const }
      workspaces = [successful, recent, inactive, failed]
      const runner = worker()
      await runner.recheckWorkspaces(ctx as unknown as MeasureContext)
      expect([...runner.workspacesToBackup.keys()]).toEqual(['failed'])
    }
  )

  it('records an unsuccessful attempt without changing the successful backup time or count', async () => {
    const ws = workspace('failed', 1)
    expect(await worker().doBackup(ctx as unknown as MeasureContext, ws)).toBe(false)
    expect(updateBackupInfo).toHaveBeenCalledWith(expect.objectContaining({ lastAttempt: now, lastBackup: 1, backups: 2 }))
  })
})
