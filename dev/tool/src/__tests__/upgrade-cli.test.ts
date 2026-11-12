// SPDX-License-Identifier: EPL-2.0

import { program } from 'commander'
import { getAccountDB, updateWorkspaceInfo } from '@hcengineering/account'
import { upgradeWorkspace } from '@hcengineering/workspace-service'
import { getPlatformQueue } from '@hcengineering/kafka'
import { restore } from '@hcengineering/server-backup'
import { workspaceEvents } from '@hcengineering/server-core'
import { devTool } from '../index'

jest.mock('../__start', () => ({ getAccountDBUrl: () => 'test-db' }))
jest.mock('../utils', () => ({
  getToolToken: () => 'test-tool-token',
  getWorkspace: async () => ({ uuid: 'workspace', url: 'workspace' })
}))
jest.mock('../workspace', () => ({}))
jest.mock('../calendar', () => ({}))
jest.mock('../db', () => ({}))
jest.mock('../contact', () => ({}))
jest.mock('../github', () => ({}))
jest.mock('../gmail', () => ({}))
jest.mock('../configuration', () => ({}))
jest.mock('../markup', () => ({}))
jest.mock('../restoreGithub', () => ({}))
jest.mock('../communication', () => ({}))
jest.mock('@hcengineering/model-all', () => ({ getModelVersion: () => ({}) }))
jest.mock('@hcengineering/account', () => ({
  __esModule: true,
  default: { metadata: { Transactors: 'test:transactors' } },
  getAccountDB: jest.fn(),
  getWorkspaceInfoWithStatusById: async () => ({ uuid: 'workspace', url: 'workspace' }),
  flattenStatus: (value: unknown) => value,
  updateWorkspaceInfo: jest.fn(async () => {})
}))
jest.mock('@hcengineering/account-service', () => ({}))
jest.mock('@hcengineering/hulylake-client', () => ({}))
jest.mock('@hcengineering/postgres', () => ({ shutdownPostgres: async () => {} }))
jest.mock('@hcengineering/mongo', () => ({ shutdownMongo: async () => {} }))
jest.mock('@hcengineering/workspace-service', () => ({ upgradeWorkspace: jest.fn() }))
jest.mock('@hcengineering/kafka', () => ({ getPlatformQueue: jest.fn() }))
jest.mock('@hcengineering/server-storage', () => ({
  storageConfigFromEnv: () => ({}),
  buildStorageFromConfig: () => ({ close: mockCloseStorage })
}))
jest.mock('@hcengineering/server-client', () => ({
  __esModule: true,
  default: { metadata: { Endpoint: 'test:endpoint' } },
  getAccountClient: () => ({})
}))
jest.mock('@hcengineering/server-token', () => ({
  __esModule: true,
  default: { metadata: { Secret: 'test:secret', Service: 'test:service' } }
}))
jest.mock('@hcengineering/pod-rating', () => ({}))
jest.mock('@faker-js/faker', () => ({}))
jest.mock('@hcengineering/api-client', () => ({}))
jest.mock('@hcengineering/server-tool', () => ({ sendTransactorEvent: async () => {} }))
jest.mock('@hcengineering/server-backup', () => ({
  createFileBackupStorage: async () => ({}),
  restore: jest.fn(async () => {})
}))
jest.mock('@hcengineering/server-pipeline', () => ({
  registerTxAdapterFactory: () => {},
  registerAdapterFactory: () => {},
  registerDestroyFactory: () => {},
  setAdapterSecurity: () => {},
  registerServerPlugins: () => {},
  registerStringLoaders: () => {},
  createEmptyBroadcastOps: () => ({}),
  createBackupPipeline: () => async () => ({ close: mockClosePipeline })
}))

const mockCloseStorage = jest.fn(async () => {})
const mockClosePipeline = jest.fn(async () => {})

describe('upgrade CLI error handling', () => {
  const originalExitCode = process.exitCode
  const originalListeners = new Map(
    ['exit', 'unhandledRejection', 'uncaughtException'].map((event) => [event, new Set(process.listeners(event))])
  )
  const originalEnv = { SERVER_SECRET: process.env.SERVER_SECRET, ACCOUNTS_URL: process.env.ACCOUNTS_URL }
  const closeDb = jest.fn(async () => {})
  const shutdown = jest.fn(async () => {})
  const send = jest.fn(async () => {})
  let log: jest.SpyInstance

  beforeAll(() => {
    process.env.SERVER_SECRET = 'test-only'
    process.env.ACCOUNTS_URL = 'http://test.invalid'
    const parse = jest.spyOn(program, 'parse').mockReturnValue(program)
    devTool(() => ({ dbUrl: 'test-db', txes: [], version: {} as any, migrateOperations: [] }))
    parse.mockRestore()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    process.exitCode = 0
    log = jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.mocked(getAccountDB).mockResolvedValue([{} as any, closeDb])
    jest.mocked(getPlatformQueue).mockReturnValue({ getProducer: () => ({ send }), shutdown } as any)
    jest.mocked(upgradeWorkspace).mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.exitCode = originalExitCode
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const [event, previous] of originalListeners) {
      for (const listener of process.listeners(event)) {
        if (!previous.has(listener)) process.removeListener(event, listener)
      }
    }
  })

  it.each(['upgrade-workspace', 'backup-restore'])('%s reports a failed migration with a nonzero exit and closes resources', async (command) => {
    jest.mocked(upgradeWorkspace).mockRejectedValue(new Error('tracker/add-search-view-options failed'))
    const args = command === 'backup-restore' ? [command, 'backup-dir', 'workspace', '--upgrade'] : [command, 'workspace']
    await program.parseAsync(['node', 'tool', ...args])
    expect(upgradeWorkspace).toHaveBeenCalledTimes(1)
    expect(restore).toHaveBeenCalledTimes(command === 'backup-restore' ? 1 : 0)
    expect(process.exitCode).toBe(1)
    expect(updateWorkspaceInfo).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalledWith('workspace restored')
    expect(log).not.toHaveBeenCalledWith('upgrade-workspace done')
    expect(send).not.toHaveBeenCalledWith(expect.anything(), 'workspace', [workspaceEvents.restored()])
    expect(send).not.toHaveBeenCalledWith(expect.anything(), 'workspace', [workspaceEvents.upgraded()])
    expect(shutdown).toHaveBeenCalledTimes(command === 'backup-restore' ? 2 : 1)
    expect(closeDb).toHaveBeenCalledTimes(command === 'backup-restore' ? 2 : 1)
    expect(mockClosePipeline).toHaveBeenCalledTimes(command === 'backup-restore' ? 1 : 0)
    expect(mockCloseStorage).toHaveBeenCalledTimes(command === 'backup-restore' ? 1 : 0)
  })

  it('preserves a successful restore and upgrade', async () => {
    await program.parseAsync(['node', 'tool', 'backup-restore', 'backup-dir', 'workspace', '--upgrade'])
    expect(process.exitCode).toBe(0)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(updateWorkspaceInfo).toHaveBeenCalledWith(expect.anything(), expect.anything(), null, expect.anything(), expect.objectContaining({ event: 'upgrade-done' }))
    expect(log).toHaveBeenCalledWith('workspace restored')
    expect(shutdown).toHaveBeenCalledTimes(2)
    expect(closeDb).toHaveBeenCalledTimes(2)
  })
})
