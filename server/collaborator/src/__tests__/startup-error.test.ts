// SPDX-License-Identifier: EPL-2.0
import type { MeasureContext } from '@hcengineering/core'
import { startCollaborator } from '../starter'
import { start } from '../server'
import { buildStorageFromConfig } from '@hcengineering/server-storage'
jest.mock('../config', () => ({ __esModule: true, default: {} }))
jest.mock('../server', () => ({ start: jest.fn() }))
jest.mock('@hcengineering/server-storage', () => ({
  storageConfigFromEnv: jest.fn(),
  buildStorageFromConfig: jest.fn()
}))
it('catches startup errors, closes storage and marks startup failed without logging credentials', async () => {
  const canary = 'synthetic-startup-credential'
  const close = jest.fn(async () => {})
  jest.mocked(buildStorageFromConfig).mockReturnValue({ close } as any)
  jest
    .mocked(start)
    .mockRejectedValue(Object.assign(new Error('synthetic startup failure'), { config: { Secret: canary } }))
  const error = jest.fn()
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  const previous = process.exitCode
  try {
    let rejected = false
    try {
      await startCollaborator({ error } as unknown as MeasureContext)
    } catch {
      rejected = true
    }
    expect(rejected).toBe(false)
    expect(close).toHaveBeenCalled()
    expect(error.mock.calls.length).toBe(1)
    expect(JSON.stringify(error.mock.calls).includes(canary)).toBe(false)
    expect(process.exitCode).toBe(1)
    expect(exit).toHaveBeenCalledWith(1)
  } finally {
    process.exitCode = previous
    exit.mockRestore()
  }
})
