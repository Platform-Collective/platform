// SPDX-License-Identifier: EPL-2.0

import { getAccountDB, type AccountDB } from '@hcengineering/account'
import { type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import { type PipelineFactory, type StorageAdapter } from '@hcengineering/server-core'
import { restore } from '../restore'
import { doRestoreWorkspace } from '../service'

jest.mock('@hcengineering/account', () => ({ getAccountDB: jest.fn() }))
jest.mock('../storage', () => ({ createStorageBackupStorage: jest.fn().mockResolvedValue({}) }))
jest.mock('../restore', () => ({ restore: jest.fn() }))
jest.mock('../backup', () => ({}))

describe('doRestoreWorkspace resource cleanup', () => {
  const error = jest.fn()
  const ctx = {
    warn: jest.fn(),
    error,
    newChild: () => ctx,
    with: async (_name: string, _params: object, fn: (ctx: MeasureContext) => Promise<boolean>) =>
      await fn(ctx as unknown as MeasureContext)
  }
  let close: jest.Mock
  let closeAccountDB: jest.Mock
  let pipelineFactory: PipelineFactory

  beforeEach(() => {
    jest.clearAllMocks()
    close = jest.fn().mockResolvedValue(undefined)
    closeAccountDB = jest.fn()
    pipelineFactory = jest.fn().mockResolvedValue({ close })
    jest.mocked(getAccountDB).mockResolvedValue([{} as unknown as AccountDB, closeAccountDB])
    jest.mocked(restore).mockResolvedValue(true)
  })

  async function run (): Promise<boolean> {
    return await doRestoreWorkspace(
      ctx as unknown as MeasureContext,
      { uuid: 'workspace' as WorkspaceUuid, url: 'workspace' },
      {} as unknown as StorageAdapter,
      'bucket',
      pipelineFactory,
      [],
      true,
      'accounts-db'
    )
  }

  test('successful and false restore results both close resources', async () => {
    expect(await run()).toBe(true)
    jest.mocked(restore).mockResolvedValueOnce(false)
    expect(await run()).toBe(false)
    expect(closeAccountDB).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('missing metadata keeps the original error in server logs', async () => {
    const err = new Error('backup.json.gz should present to restore')
    jest.mocked(restore).mockRejectedValueOnce(err)
    expect(await run()).toBe(false)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FAILED to RESTORE'), expect.objectContaining({ err }))
    expect(closeAccountDB).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('cleanup failure reports false even after restore succeeds', async () => {
    close.mockRejectedValueOnce(new Error('close failed'))
    expect(await run()).toBe(false)
  })

  test('account cleanup failure still closes the pipeline', async () => {
    closeAccountDB.mockImplementationOnce(() => {
      throw new Error('account close failed')
    })
    expect(await run()).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('cleanup failure does not mask the original restore failure', async () => {
    const err = new Error('original restore failure')
    jest.mocked(restore).mockRejectedValueOnce(err)
    close.mockRejectedValueOnce(new Error('pipeline close failed'))
    expect(await run()).toBe(false)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('FAILED to RESTORE'), expect.objectContaining({ err }))
    expect(error).toHaveBeenCalledWith('Failed to close restore resources', expect.any(Object))
  })
})
