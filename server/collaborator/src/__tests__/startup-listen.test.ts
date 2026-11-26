// SPDX-License-Identifier: EPL-2.0
import type { MeasureContext } from '@hcengineering/core'
import type { StorageAdapter } from '@hcengineering/server-core'
import type { Config } from '../config'
import { EventEmitter } from 'events'
import { createServer } from 'http'
import express from 'express'
import { start } from '../server'

jest.mock('../config', () => ({ __esModule: true, default: {} }))
jest.mock('http', () => ({ createServer: jest.fn() }))
jest.mock('express', () => ({ __esModule: true, default: Object.assign(jest.fn(), { json: jest.fn() }) }))
jest.mock('@hocuspocus/server', () => ({ Hocuspocus: jest.fn() }))
jest.mock('../storage/platform', () => ({ PlatformStorageAdapter: jest.fn() }))
jest.mock('../extensions/storage', () => ({ StorageExtension: jest.fn() }))
jest.mock('../extensions/authentication', () => ({ AuthenticationExtension: jest.fn() }))
jest.mock('../transformers/markup', () => ({ MarkupTransformer: jest.fn() }))
jest.mock('ws', () => ({ WebSocketServer: jest.fn(() => ({ on: jest.fn() })) }))

const config: Config = {
  Port: 3078,
  Secret: 'synthetic-listen-credential',
  ServiceID: 'test',
  Interval: 30000,
  StorageRetryCount: 5,
  StorageRetryInterval: 50,
  AccountsUrl: 'http://example.invalid'
}
let server: EventEmitter & { listen: jest.Mock, close: jest.Mock }
let ctx: MeasureContext
let info: jest.Mock
beforeEach(() => {
  server = Object.assign(new EventEmitter(), { listen: jest.fn(), close: jest.fn() })
  jest.mocked(createServer).mockReturnValue(server as any)
  jest.mocked(express).mockReturnValue({ use: jest.fn(), get: jest.fn(), post: jest.fn() } as any)
  info = jest.fn()
  ctx = { info, newChild: () => ctx } as unknown as MeasureContext
})
it('runs express and reports listening only after the successful listen callback', async () => {
  let listening: (() => void) | undefined
  server.listen.mockImplementation((_port, callback) => {
    listening = callback
    return server
  })
  const pending = start(ctx, config, {} as unknown as StorageAdapter)
  expect(express).toHaveBeenCalled()
  expect(info.mock.calls.some(([message]) => message === 'Running collaborator server')).toBe(false)
  expect(typeof listening).toBe('function')
  listening?.()
  const shutdown = await pending
  expect(info.mock.calls.some(([message]) => message === 'Running collaborator server')).toBe(true)
  expect(JSON.stringify(info.mock.calls).includes(config.Secret)).toBe(false)
  await shutdown()
  expect(server.close).toHaveBeenCalled()
})
it('rejects bind failures without a false listening message or raw error payload', async () => {
  server.listen.mockImplementation(() => {
    queueMicrotask(() =>
      server.emit('error', Object.assign(new Error('synthetic bind failure'), { code: 'EADDRINUSE' }))
    )
    return server
  })
  let error: unknown
  try {
    await start(ctx, config, {} as unknown as StorageAdapter)
  } catch (e) {
    error = e
  }
  expect(error instanceof Error).toBe(true)
  expect(JSON.stringify(info.mock.calls).includes(config.Secret)).toBe(false)
  expect(info.mock.calls.some(([message]) => message === 'Running collaborator server')).toBe(false)
})
