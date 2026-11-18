// SPDX-License-Identifier: EPL-2.0
import type { MeasureContext } from '@hcengineering/core'
import { buildStorageFromConfig } from '@hcengineering/server-storage'
import { startFront } from '../starter'
import { start } from '..'
jest.mock('..', () => ({ start: jest.fn(() => jest.fn()) }))
jest.mock('@hcengineering/server-storage', () => ({
  storageConfigFromEnv: jest.fn(),
  buildStorageFromConfig: jest.fn()
}))
it('does not serialize URLs or storage options, even with a deep custom inspector', () => {
  const canary = 'synthetic-storage-credential'
  const env = { ...process.env }
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  const on = jest.spyOn(process, 'on').mockReturnValue(process)
  const inspector = jest.fn(() => canary)
  jest.mocked(buildStorageFromConfig).mockReturnValue({
    adapters: [{ options: { secretKey: canary } }],
    [Symbol.for('nodejs.util.inspect.custom')]: inspector
  } as any)
  for (const key of [
    'ACCOUNTS_URL',
    'UPLOAD_URL',
    'GMAIL_URL',
    'CALENDAR_URL',
    'TELEGRAM_URL',
    'REKONI_URL',
    'COLLABORATOR_URL'
  ]) {
    process.env[key] = 'https://example.invalid/?token=' + canary
  }
  Object.assign(process.env, { MODEL_VERSION: 'test', VERSION: 'test', SERVER_SECRET: canary })
  try {
    startFront({} as unknown as MeasureContext)
    expect(start).toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls).includes(canary)).toBe(false)
    expect(
      log.mock.calls.some((call) => call.some((arg) => typeof arg === 'object' && arg?.storageAdapter !== undefined))
    ).toBe(false)
    expect(inspector).not.toHaveBeenCalled()
  } finally {
    process.env = env
    log.mockRestore()
    on.mockRestore()
  }
})
