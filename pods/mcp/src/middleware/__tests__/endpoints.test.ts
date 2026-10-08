// SPDX-License-Identifier: EPL-2.0

import { type MeasureContext } from '@hcengineering/core'
import { type Express } from 'express'
import http from 'node:http'

import { fakeEnv } from '../../__tests__/test-doubles'
import { type Authenticator } from '../../auth/authenticator'
import { loadConfig } from '../../config'
import { ToolRegistry } from '../../mcp/tool'
import { type WorkspaceClientProvider } from '../../platform/workspace-client-provider'
import { createServer } from '../../server'
import { RateLimiter } from '../rate-limiter'

interface Reply {
  status: number
  body: string
}

/**
 * A MeasureContext stub for the HTTP layer.
 *
 * `newChild` backs the request logger, and `metrics` backs the statistics
 * handler — both are read while the server is assembled, so a stub without
 * them would crash before the first request rather than fail an assertion.
 */
function fakeCtx (): MeasureContext {
  const ctx: Record<string, unknown> = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    newChild: () => ctx,
    metrics: { measurements: {}, value: 0 }
  }
  return ctx as unknown as MeasureContext
}

/**
 * Builds the real app from `createServer`, the same wiring production uses.
 *
 * Only the pieces the tested routes touch are real; the client provider and
 * authenticator are empty stubs because no request here reaches the MCP
 * transport where they would be called.
 */
function testApp (env: Record<string, string> = {}): Express {
  const config = loadConfig(fakeEnv({ SECRET: 'a-real-one', ...env }))
  const ctx = fakeCtx()
  const { app } = createServer({
    ctx,
    config,
    registry: new ToolRegistry(),
    clients: Object.create(null) as WorkspaceClientProvider,
    authenticator: Object.create(null) as Authenticator,
    limiter: new RateLimiter(ctx, config.RequestRateLimit, config.RequestRateWindowMs)
  })
  return app
}

/**
 * Sends one GET against a throwaway listener, with no credentials of any kind.
 *
 * node:http rather than fetch, matching origin-guard.test.ts: the test controls
 * every header verbatim, and closing the listener in the callback keeps jest
 * from hanging on a kept-alive socket.
 */
function call (app: Express, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const done = (fn: () => void): void => {
        server.closeAllConnections()
        server.close()
        fn()
      }
      const address = server.address()
      if (address === null || typeof address === 'string') {
        done(() => {
          reject(new Error('test server did not bind a TCP port'))
        })
        return
      }

      const req = http.request(
        { host: '127.0.0.1', port: address.port, path, method: 'GET', agent: false },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            done(() => {
              resolve({ status: res.statusCode ?? 0, body })
            })
          })
        }
      )
      req.on('error', (err) => {
        done(() => {
          reject(err)
        })
      })
      req.end()
    })
    server.on('error', reject)
  })
}

describe('unauthenticated endpoints', () => {
  it('answers /api/v1/health with 200 and no credential, so container probes keep working', async () => {
    const reply = await call(testApp(), '/api/v1/health')
    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body).status).toBe('ok')
  })

  it('exposes only probe-safe fields on /api/v1/health — no authMode, readOnly or sessions', async () => {
    const reply = await call(testApp(), '/api/v1/health')
    const body: unknown = JSON.parse(reply.body)
    // The exact key set matters more than individual omissions: any future
    // field added here has to be a conscious decision, not an oversight.
    expect(Object.keys(body as Record<string, unknown>).sort()).toEqual(['status', 'tools', 'version'])
    expect(body).not.toHaveProperty('authMode')
  })

  it('answers 404 identical to an unknown path while MCP_STATS is unset (the default)', async () => {
    const reply = await call(testApp(), '/api/v1/statistics')
    expect(reply.status).toBe(404)
    // Same body the catch-all produces, so probing reveals nothing about
    // whether the route exists.
    expect(JSON.parse(reply.body)).toEqual({ error: 'Not Found' })
  })

  it('serves statistics once MCP_STATS=true opts in', async () => {
    const reply = await call(testApp({ MCP_STATS: 'true' }), '/api/v1/statistics')
    expect(reply.status).toBe(200)
    const body = JSON.parse(reply.body)
    expect(body.statistics).toHaveProperty('cpu')
    expect(body.statistics).toHaveProperty('memory')
    expect(body).toHaveProperty('metrics')
  })

  it('keeps the auth mode off the / landing page while it still points at the MCP endpoint', async () => {
    // fakeEnv carries no HULY_TOKEN, so the mode in play is `perRequest`; the
    // page must not name it (nor the `Auth mode:` line at all).
    const reply = await call(testApp(), '/')
    expect(reply.status).toBe(200)
    expect(reply.body).not.toMatch(/auth mode/i)
    expect(reply.body).not.toContain('perRequest')
    expect(reply.body).toContain('POST /mcp')
  })
})
