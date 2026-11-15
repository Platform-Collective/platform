// SPDX-License-Identifier: EPL-2.0
import { serveStats } from '../stats'
import type { MeasureContext } from '@hcengineering/core'
import { decodeToken } from '@hcengineering/server-token'
const mockHandlers = new Map<string, (req: any) => void>()
jest.mock('koa', () => ({
  __esModule: true,
  default: jest.fn(() => {
    const app: any = { use: jest.fn(() => app), listen: jest.fn(() => ({ close: jest.fn() })) }
    return app
  })
}))
jest.mock('koa-router', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    get: (route: string, handler: any) => mockHandlers.set('GET ' + route, handler),
    put: (route: string, handler: any) => mockHandlers.set('PUT ' + route, handler),
    routes: jest.fn(),
    allowedMethods: jest.fn()
  }))
}))
jest.mock('@hcengineering/server-token', () => ({
  __esModule: true,
  default: { metadata: {} },
  decodeToken: jest.fn()
}))
it.each(['GET /api/v1/overview', 'PUT /api/v1/statistics'])(
  'keeps authorization and request targets out of failure logs: %s',
  (route) => {
    const canary = 'synthetic-authorization-credential'
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const on = jest.spyOn(process, 'on').mockReturnValue(process)
    const error = jest.fn()
    const previous = process.env.SERVER_SECRET
    process.env.SERVER_SECRET = canary
    jest.mocked(decodeToken).mockImplementation(() => {
      throw Object.assign(new Error('decode failed'), { headers: { authorization: canary } })
    })
    try {
      serveStats({ info: jest.fn(), error } as unknown as MeasureContext)
      const req = {
        method: route.split(' ')[0],
        url: '/api/v1/statistics?token=' + canary,
        query: {},
        headers: { authorization: 'Bearer ' + canary },
        host: 'stats.invalid',
        ip: '127.0.0.1',
        res: { writeHead: jest.fn(), end: jest.fn() }
      }
      mockHandlers.get(route)?.(req)
      expect(req.res.writeHead).toHaveBeenCalledWith(404, {})
      expect(JSON.stringify([consoleError.mock.calls, error.mock.calls]).includes(canary)).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.SERVER_SECRET
      else process.env.SERVER_SECRET = previous
      consoleError.mockRestore()
      on.mockRestore()
    }
  }
)
