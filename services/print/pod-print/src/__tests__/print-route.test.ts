// SPDX-License-Identifier: EPL-2.0

import { type Request, type Response, type RequestHandler } from 'express'

import { ApiError } from '../error'
import { print } from '../print'
import { createServer } from '../server'

const mockStorage = { put: jest.fn(), close: jest.fn() }
const mockContext: { with: jest.Mock, error: jest.Mock } = {
  with: jest.fn(async (_name, _attrs, operation) => await Promise.resolve(operation(mockContext))),
  error: jest.fn()
}
jest.mock('@hcengineering/api-client', () => ({}), { virtual: true })
jest.mock('@hcengineering/core', () => ({ newMetrics: jest.fn(), generateId: () => 'id' }), { virtual: true })
jest.mock('@hcengineering/server-core', () => ({ initStatisticsContext: () => mockContext }), { virtual: true })
jest.mock('@hcengineering/server-storage', () => ({ buildStorageFromConfig: () => mockStorage }), { virtual: true })
jest.mock('@hcengineering/server-guest-resources', () => ({}), { virtual: true })
jest.mock('@hcengineering/analytics-service', () => ({}), { virtual: true })
jest.mock(
  '@hcengineering/account-client',
  () => ({
    getClient: () => ({
      getLoginInfoByToken: async () => ({ workspace: 'workspace-a' })
    }),
    isWorkspaceLoginInfo: () => true
  }),
  { virtual: true }
)
jest.mock('../config', () => ({
  __esModule: true,
  default: { AccountsUrl: 'http://accounts' }
}))
jest.mock('../print', () => ({
  print: jest.fn(async () => Buffer.from('pdf')),
  validKinds: ['pdf', 'jpeg', 'png', 'webp'],
  validPageOrientations: ['portrait', 'landscape']
}))
jest.mock('../browser', () => ({
  PrintBrowserManager: jest.fn(() => ({ close: jest.fn() }))
}))
jest.mock('../convert', () => ({}))
jest.mock('../preview', () => ({ createPreviewQueue: jest.fn() }))

describe('authenticated print route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  async function requestPrint (link: string, allowedHostnames: string[]): Promise<number> {
    const storageConfig: Parameters<typeof createServer>[0] = { default: '', storages: [] }
    const service = createServer(storageConfig, allowedHostnames)
    try {
      const layers = service.app._router.stack as Array<{
        route?: { path: string, stack: Array<{ handle: RequestHandler }> }
      }>
      const handler = layers.find((layer) => layer.route?.path === '/print')?.route?.stack[0].handle
      if (handler === undefined) throw new Error('Missing print route')
      return await new Promise<number>((resolve, reject) => {
        const req = {
          headers: { authorization: 'Bearer workspace-a' },
          query: { link },
          ctx: mockContext
        } as unknown as Request
        const res = {
          contentType: jest.fn(),
          send: () => { resolve(200); }
        } as unknown as Response
        handler(req, res, (error: unknown) => {
          if (error instanceof ApiError) resolve(error.code)
          else reject(error)
        })
      })
    } finally {
      await service.close()
    }
  }

  it.each<[string[], string]>([
    [[], 'http://huly.local:8087/'],
    [[], 'http://169.254.169.254/latest/meta-data/'],
    [['huly.local'], 'http://169.254.169.254/latest/meta-data/'],
    [['huly.local'], 'http://127.0.0.1/'],
    [['huly.local'], 'http://localhost/'],
    [['huly.local'], 'http://huly.local.evil.example/'],
    [['huly.local'], 'file:///etc/passwd']
  ])('denies %s / %s before printing or storing content', async (allowedHostnames, url) => {
    expect(await requestPrint(url, allowedHostnames)).toBe(403)
    expect(print).not.toHaveBeenCalled()
    expect(mockStorage.put).not.toHaveBeenCalled()
  })

  it('prints the front page using the normalized exact hostname policy', async () => {
    const allowedHostnames = [' HULY.LOCAL. ']
    expect(await requestPrint('http://huly.local:8087/', allowedHostnames)).toBe(200)
    expect(print).toHaveBeenCalledWith(
      mockContext,
      'http://huly.local:8087/',
      expect.any(Object),
      expect.any(Object),
      allowedHostnames
    )
    expect(mockStorage.put).toHaveBeenCalledTimes(1)
  })
})
