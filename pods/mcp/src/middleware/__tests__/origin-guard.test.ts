// SPDX-License-Identifier: EPL-2.0

import cors from 'cors'
import express, { type Express } from 'express'
import http from 'node:http'

import { originGuard } from '../index'

const ALLOWED_ORIGIN = 'http://localhost:5173'
const STRANGER_ORIGIN = 'https://evil.example.com'

interface Reply {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

interface CallOptions {
  method?: string
  origin?: string
  /** Sends the browser preflight headers (OPTIONS + Access-Control-*). */
  preflight?: boolean
}

/**
 * Rebuilds the middleware order from server.ts: the guard runs before cors,
 * so the two only ever interact the way production wires them.
 */
function testApp (allowed: string[]): Express {
  const app = express()
  app.use(originGuard(allowed))
  app.use(
    cors({
      origin: allowed,
      maxAge: 86400,
      exposedHeaders: ['X-RateLimit-Remaining'],
      allowedHeaders: ['Content-Type']
    })
  )
  app.post('/mcp', (_req, res) => {
    res.status(200).json({ ok: true })
  })
  return app
}

/**
 * Sends one request against a throwaway listener.
 *
 * node:http rather than fetch so the test controls every header verbatim:
 * fetch implementations may rewrite or refuse headers such as `Origin`, and
 * its keep-alive sockets would keep the listener open past the assertion.
 */
function call (app: Express, options: CallOptions = {}): Promise<Reply> {
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

      const headers: Record<string, string> = {}
      if (options.origin !== undefined) headers.origin = options.origin
      if (options.preflight === true) {
        headers['Access-Control-Request-Method'] = 'POST'
        headers['Access-Control-Request-Headers'] = 'content-type'
      }

      const req = http.request(
        { host: '127.0.0.1', port: address.port, path: '/mcp', method: options.method ?? 'POST', headers, agent: false },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            body += chunk
          })
          res.on('end', () => {
            done(() => {
              resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
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

describe('originGuard', () => {
  it('allows requests with no Origin header, so non-browser MCP clients keep working', async () => {
    const reply = await call(testApp([ALLOWED_ORIGIN]))
    expect(reply.status).toBe(200)
    expect(reply.body).toContain('"ok"')
  })

  it('allows an origin from the allowlist and reflects it in the CORS header', async () => {
    const reply = await call(testApp([ALLOWED_ORIGIN]), { origin: ALLOWED_ORIGIN })
    expect(reply.status).toBe(200)
    expect(reply.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN)
  })

  it('rejects an origin that is not on the allowlist with 403 and no CORS header', async () => {
    const reply = await call(testApp([ALLOWED_ORIGIN]), { origin: STRANGER_ORIGIN })
    expect(reply.status).toBe(403)
    expect(JSON.parse(reply.body)).toEqual({ error: 'Origin not allowed' })
    expect(reply.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('fails closed when the allowlist is empty: any Origin is refused', async () => {
    const reply = await call(testApp([]), { origin: ALLOWED_ORIGIN })
    expect(reply.status).toBe(403)
    expect(JSON.parse(reply.body)).toEqual({ error: 'Origin not allowed' })
  })

  it('still serves non-browser clients when the allowlist is empty', async () => {
    const reply = await call(testApp([]))
    expect(reply.status).toBe(200)
  })

  it('answers preflight with 204 for an allowed origin', async () => {
    const reply = await call(testApp([ALLOWED_ORIGIN]), {
      method: 'OPTIONS',
      origin: ALLOWED_ORIGIN,
      preflight: true
    })
    expect(reply.status).toBe(204)
    expect(reply.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN)
    expect(reply.headers['access-control-max-age']).toBe('86400')
  })

  it('refuses preflight from a disallowed origin before cors can answer it', async () => {
    const reply = await call(testApp([ALLOWED_ORIGIN]), {
      method: 'OPTIONS',
      origin: STRANGER_ORIGIN,
      preflight: true
    })
    expect(reply.status).toBe(403)
    expect(JSON.parse(reply.body)).toEqual({ error: 'Origin not allowed' })
    expect(reply.headers['access-control-allow-origin']).toBeUndefined()
  })
})
