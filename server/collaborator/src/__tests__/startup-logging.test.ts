// SPDX-License-Identifier: EPL-2.0

import type { MeasureContext } from '@hcengineering/core'
import type { StorageAdapter } from '@hcengineering/server-core'
import type { Config } from '../config'

jest.mock('../config', () => ({ __esModule: true, default: {} }))
jest.mock('express', () => ({
  __esModule: true,
  default: jest.fn(() => {
    throw new Error('startup-test-boundary')
  })
}))

import { start } from '../server'

it('logs startup without serializing configuration or credentials', async () => {
  const configuration: Config = {
    ServiceID: 'startup-test',
    Secret: 'synthetic-canary-do-not-log',
    Interval: 30000,
    StorageRetryCount: 5,
    StorageRetryInterval: 50,
    Port: 3078,
    AccountsUrl: 'http://startup.invalid'
  }
  const info = jest.fn()
  const context = { info } as unknown as MeasureContext
  await expect(start(context, configuration, {} as StorageAdapter)).rejects.toThrow('startup-test-boundary')
  // Assert scalars so a failing regression never dumps the captured configuration.
  expect(info.mock.calls.length).toBe(1)
  expect(info.mock.calls[0]?.[0] === 'Starting collaborator server').toBe(true)
  expect(info.mock.calls[0]?.length).toBe(1)
})
