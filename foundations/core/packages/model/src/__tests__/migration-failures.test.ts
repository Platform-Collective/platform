// SPDX-License-Identifier: EPL-2.0

import { type Client, type Doc, type Domain } from '@hcengineering/core'
import { getUpgradeFailures, type MigrationClient, tryMigrate, tryUpgrade } from '../migration'

it('reports a failed migration and leaves it pending for a successful rerun', async () => {
  const create = jest.fn(async (_domain: Domain, _doc: Doc | Doc[]) => {})
  const logger = { log: jest.fn(), error: jest.fn() }
  const migrationFailures: Array<{ plugin: string, state: string }> = []
  const client = {
    migrateState: new Map<string, Set<string>>(),
    migrationFailures,
    create,
    logger
  } as unknown as MigrationClient & { migrationFailures: typeof migrationFailures }
  const migrate = jest.fn().mockRejectedValueOnce(new Error('first attempt failed')).mockResolvedValueOnce(undefined)

  await tryMigrate('upgrade', client, 'core', [{ state: 'account-ids', func: migrate }])
  expect(migrationFailures).toEqual([{ plugin: 'core', state: 'account-ids' }])
  expect(create).not.toHaveBeenCalled()
  expect(client.migrateState.get('core')?.has('account-ids')).not.toBe(true)

  await tryMigrate('upgrade', client, 'core', [{ state: 'account-ids', func: migrate }])
  expect(migrate).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0][1]).toMatchObject({ plugin: 'core', state: 'account-ids' })
})

it('includes failed high-level upgrades in the end-of-upgrade report without marking them done', async () => {
  const state = new Map<string, Set<string>>()
  const error = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await tryUpgrade('upgrade', state, async () => ({}) as unknown as Client, 'notification', [
      {
        state: 'collaborators-v2',
        func: async () => {
          throw new Error('migration failed')
        }
      }
    ])
  } finally {
    error.mockRestore()
  }
  expect(getUpgradeFailures(state)).toEqual([{ plugin: 'notification', state: 'collaborators-v2' }])
  expect(state.get('notification')?.has('collaborators-v2')).not.toBe(true)
})
