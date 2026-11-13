// SPDX-License-Identifier: EPL-2.0

import { type AccountClient } from '@hcengineering/account-client'
import core, {
  DOMAIN_MIGRATION,
  MeasureMetricsContext,
  type Client,
  type Doc,
  type Domain,
  type MigrationState,
  type WorkspaceIds
} from '@hcengineering/core'
import { tryMigrate, tryUpgrade, type MigrateMode, type MigrateOperation, type ModelLogger } from '@hcengineering/model'
import {
  type Pipeline,
  type PlatformQueueProducer,
  type QueueWorkspaceMessage,
  type StorageAdapter
} from '@hcengineering/server-core'
import { upgradeModel } from '../index'
import { sendTransactorEvent } from '../utils'

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  sendTransactorEvent: jest.fn(async () => {})
}))

const workspace = { uuid: 'workspace', url: 'workspace' } as unknown as WorkspaceIds

/** Workspace storage that keeps migration states in memory, like the migration domain of a workspace. */
function createWorkspace (): { pipeline: Pipeline, states: () => string[] } {
  const docs = new Map<Domain, Doc[]>()
  const lowLevelStorage = {
    rawFindAll: async (domain: Domain) => docs.get(domain) ?? [],
    upload: async (_ctx: unknown, domain: Domain, items: Doc[]) => {
      docs.set(domain, [...(docs.get(domain) ?? []), ...items])
    }
  }
  const pipeline = {
    loadModel: async () => [],
    context: { lowLevelStorage }
  } as unknown as Pipeline
  const states = (): string[] =>
    (docs.get(DOMAIN_MIGRATION) ?? [])
      .filter((it) => it._class === core.class.MigrationState)
      .map((it) => `${(it as MigrationState).plugin}/${(it as MigrationState).state}`)
      .sort()
  return { pipeline, states }
}

describe('upgradeModel with failing migrations', () => {
  const ctx = new MeasureMetricsContext('upgrade', {})
  let logger: ModelLogger

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(ctx, 'error').mockImplementation(() => {})
    jest.spyOn(ctx, 'info').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'info').mockImplementation(() => {})
    logger = { log: jest.fn(), error: jest.fn() }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env.UPGRADE_TOLERATED_MIGRATION_FAILURES
  })

  function run (pipeline: Pipeline, operation: MigrateOperation, mode: MigrateMode): Promise<unknown> {
    return upgradeModel(
      ctx,
      '',
      workspace,
      [],
      pipeline,
      {} as unknown as Client,
      {} as unknown as StorageAdapter,
      {} as unknown as AccountClient,
      {} as unknown as PlatformQueueProducer<QueueWorkspaceMessage>,
      [['test', operation]],
      logger,
      async () => {},
      'disable',
      mode
    )
  }

  function migrations (broken: { fail: boolean }): {
    operation: MigrateOperation
    calls: Record<string, number>
  } {
    const calls: Record<string, number> = {}
    const step = (state: string, fail = false): { state: string, func: () => Promise<void> } => ({
      state,
      func: async () => {
        calls[state] = (calls[state] ?? 0) + 1
        if (fail && broken.fail) throw new Error('database timeout')
      }
    })
    const operation: MigrateOperation = {
      migrate: async (client, mode) => {
        await tryMigrate(mode, client, 'test', [step('first'), step('broken', true), step('last')])
      },
      upgrade: async () => {}
    }
    return { operation, calls }
  }

  it('fails the upgrade and keeps the failed migration pending for the retry', async () => {
    const { pipeline, states } = createWorkspace()
    const broken = { fail: true }
    const { operation, calls } = migrations(broken)

    await expect(run(pipeline, operation, 'upgrade')).rejects.toThrow(
      '1 migrations failed and remain pending: test/broken'
    )
    expect(states()).toEqual(['test/first', 'test/last'])
    expect(logger.error).toHaveBeenCalledWith(
      'Upgrade completed with 1 failed migrations: test/broken',
      expect.objectContaining({ failures: ['test/broken'] })
    )
    // The workspace is not reopened with the new model.
    expect(sendTransactorEvent).not.toHaveBeenCalled()

    // The retry runs only the pending migration and completes the upgrade.
    broken.fail = false
    await run(pipeline, operation, 'upgrade')
    expect(states()).toEqual(['test/broken', 'test/first', 'test/last'])
    expect(calls).toEqual({ first: 1, broken: 2, last: 1 })
    expect(sendTransactorEvent).toHaveBeenCalledWith('workspace', 'force-close')
  })

  it('fails the upgrade when a high-level upgrade operation fails', async () => {
    const { pipeline } = createWorkspace()
    const operation: MigrateOperation = {
      migrate: async () => {},
      upgrade: async (state, client, mode) => {
        await tryUpgrade(mode, state, client, 'test', [
          {
            state: 'create-defaults',
            func: async () => {
              throw new Error('transactor is not available')
            }
          }
        ])
      }
    }

    await expect(run(pipeline, operation, 'upgrade')).rejects.toThrow(
      '1 migrations failed and remain pending: test/create-defaults'
    )
    expect(sendTransactorEvent).not.toHaveBeenCalled()
  })

  it('completes the upgrade when an operator tolerates every failed migration', async () => {
    const { pipeline, states } = createWorkspace()
    const { operation } = migrations({ fail: true })
    const warn = jest.spyOn(ctx, 'warn').mockImplementation(() => {})
    process.env.UPGRADE_TOLERATED_MIGRATION_FAILURES = ' other/step , test/broken'

    await run(pipeline, operation, 'upgrade')
    // The tolerated migration still has no state, so it runs again with the next upgrade.
    expect(states()).toEqual(['test/first', 'test/last'])
    expect(logger.error).toHaveBeenCalledWith(
      'Upgrade completed with 1 failed migrations: test/broken',
      expect.objectContaining({ failures: ['test/broken'] })
    )
    expect(warn).toHaveBeenCalledWith(
      'Upgrade continues despite 1 failed migrations tolerated by UPGRADE_TOLERATED_MIGRATION_FAILURES: test/broken',
      expect.objectContaining({ failures: ['test/broken'] })
    )
    expect(sendTransactorEvent).toHaveBeenCalledWith('workspace', 'force-close')
  })

  it('fails the upgrade when only some failed migrations are tolerated', async () => {
    const { pipeline } = createWorkspace()
    const operation: MigrateOperation = {
      migrate: async (client, mode) => {
        await tryMigrate(mode, client, 'test', [
          {
            state: 'tolerated',
            func: async () => {
              throw new Error('known legacy data')
            }
          },
          {
            state: 'broken',
            func: async () => {
              throw new Error('database timeout')
            }
          }
        ])
      },
      upgrade: async () => {}
    }
    process.env.UPGRADE_TOLERATED_MIGRATION_FAILURES = 'test/tolerated'

    await expect(run(pipeline, operation, 'upgrade')).rejects.toThrow(
      '2 migrations failed and remain pending: test/tolerated, test/broken'
    )
    expect(sendTransactorEvent).not.toHaveBeenCalled()
  })

  it('only reports failed migrations while a workspace is created', async () => {
    const { pipeline, states } = createWorkspace()
    const { operation } = migrations({ fail: true })

    await run(pipeline, operation, 'create')
    expect(states()).toEqual(['test/first', 'test/last'])
    expect(logger.error).toHaveBeenCalledWith(
      'Upgrade completed with 1 failed migrations: test/broken',
      expect.objectContaining({ failures: ['test/broken'] })
    )
    expect(sendTransactorEvent).toHaveBeenCalledWith('workspace', 'force-close')
  })
})
