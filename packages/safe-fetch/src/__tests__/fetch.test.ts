// SPDX-License-Identifier: EPL-2.0

import http from 'http'
import { type AddressInfo } from 'net'
import { createSafeFetch } from '../fetch'
import { type Lookup, SafeFetchError } from '../safe-fetch-types'

interface Seen {
  method: string
  path: string
  authorization?: string
  body: string
}

interface TestServer {
  server: http.Server
  port: number
  seen: Seen[]
}

async function startServer (
  handle: (req: http.IncomingMessage, res: http.ServerResponse, seen: Seen) => void
): Promise<TestServer> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      const entry: Seen = {
        method: req.method ?? '',
        path: req.url ?? '',
        authorization: req.headers.authorization,
        body
      }
      seen.push(entry)
      handle(req, res, entry)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: (server.address() as AddressInfo).port, seen }
}

async function codeOf (promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (err) {
    if (err instanceof SafeFetchError) return err.code
    throw err
  }
  return undefined
}

describe('createSafeFetch', () => {
  let primary: TestServer
  let secondary: TestServer
  // Names resolve only through the injected lookup, never through system DNS.
  const lookup: Lookup = async (hostname) => {
    if (hostname === 'app.test' || hostname === 'other.test') return [{ address: '127.0.0.1', family: 4 }]
    if (hostname === 'evil.test') return [{ address: '169.254.169.254', family: 4 }]
    throw new Error('ENOTFOUND')
  }
  const base = { allowHttp: true, allowlist: ['127.0.0.1/32'], lookup, timeoutMs: 2000 }

  beforeAll(async () => {
    primary = await startServer((req, res, seen) => {
      const url = new URL(seen.path, 'http://app.test')
      switch (url.pathname) {
        case '/ok':
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: true, auth: seen.authorization ?? null }))
          return
        case '/redirect-same':
          res.writeHead(302, { location: '/ok' })
          res.end()
          return
        case '/redirect-other':
          res.writeHead(302, { location: `http://other.test:${secondary.port}/ok` })
          res.end()
          return
        case '/redirect-private':
          res.writeHead(302, { location: 'http://10.0.0.1/' })
          res.end()
          return
        case '/redirect-evil':
          res.writeHead(302, { location: 'http://evil.test/latest/meta-data/' })
          res.end()
          return
        case '/see-other':
          res.writeHead(303, { location: '/ok' })
          res.end()
          return
        case '/loop':
          res.writeHead(302, { location: '/loop' })
          res.end()
          return
        case '/slow':
          setTimeout(() => res.end('late'), 500)
          return
        case '/big-declared':
          res.setHeader('content-length', '1500')
          res.end(Buffer.alloc(1500, 'a'))
          return
        case '/big-chunked':
          res.write(Buffer.alloc(600, 'a'))
          res.write(Buffer.alloc(600, 'b'))
          res.end()
          return
        default:
          res.writeHead(404)
          res.end()
      }
    })
    secondary = await startServer((_req, res, seen) => {
      res.end(JSON.stringify({ host: 'other', auth: seen.authorization ?? null }))
    })
  })

  afterAll(async () => {
    await new Promise((resolve) => primary.server.close(resolve))
    await new Promise((resolve) => secondary.server.close(resolve))
  })

  const url = (path: string, port?: number): string => `http://app.test:${port ?? primary.port}${path}`

  it('fetches through the pinned address for a name only the injected lookup knows', async () => {
    const fetch = createSafeFetch(base)
    const res = await fetch(url('/ok'), { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
    expect(res.url).toBe(url('/ok'))
    expect(await res.json()).toEqual({ ok: true, auth: 'Bearer t' })
  })

  it('refuses hosts and protocols before any request is made', async () => {
    const fetch = createSafeFetch(base)
    expect(await codeOf(fetch(`https://localhost:${primary.port}/ok`))).toBe('BLOCKED_HOST')
    expect(await codeOf(fetch(`ftp://app.test:${primary.port}/ok`))).toBe('INVALID_PROTOCOL')
    expect(await codeOf(fetch(url('/ok', 1)))).toBe('FETCH_FAILED')
    expect(await codeOf(createSafeFetch({ ...base, allowlist: [] })(url('/ok')))).toBe('BLOCKED_ADDRESS')
    expect(primary.seen.filter((s) => s.path === '/ok').length).toBe(1)
  })

  it('follows a same-origin redirect and keeps the authorization header', async () => {
    const fetch = createSafeFetch(base)
    const res = await fetch(url('/redirect-same'), { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
    expect(res.url).toBe(url('/ok'))
    expect(await res.json()).toEqual({ ok: true, auth: 'Bearer t' })
  })

  it('drops the authorization header on a cross-origin redirect', async () => {
    const fetch = createSafeFetch(base)
    const res = await fetch(url('/redirect-other'), { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ host: 'other', auth: null })
  })

  it('validates every redirect hop against the blocked ranges and DNS', async () => {
    const fetch = createSafeFetch(base)
    expect(await codeOf(fetch(url('/redirect-private')))).toBe('BLOCKED_ADDRESS')
    expect(await codeOf(fetch(url('/redirect-evil')))).toBe('BLOCKED_ADDRESS')
  })

  it('switches to GET on 303 and drops the body', async () => {
    const fetch = createSafeFetch(base)
    const res = await fetch(url('/see-other'), { method: 'POST', body: 'payload' })
    expect(res.status).toBe(200)
    const last = primary.seen[primary.seen.length - 1]
    expect(last.method).toBe('GET')
    expect(last.path).toBe('/ok')
    expect(last.body).toBe('')
  })

  it('returns the 3xx untouched in manual mode and throws in error mode', async () => {
    const fetch = createSafeFetch(base)
    const manual = await fetch(url('/redirect-same'), { redirect: 'manual' })
    expect(manual.status).toBe(302)
    expect(manual.headers.get('location')).toBe('/ok')
    expect(await codeOf(fetch(url('/redirect-same'), { redirect: 'error' }))).toBe('REDIRECT_NOT_ALLOWED')
  })

  it('stops after too many redirects', async () => {
    const fetch = createSafeFetch({ ...base, maxRedirects: 3 })
    expect(await codeOf(fetch(url('/loop')))).toBe('TOO_MANY_REDIRECTS')
  })

  it('times out across the whole request', async () => {
    const fetch = createSafeFetch({ ...base, timeoutMs: 100 })
    expect(await codeOf(fetch(url('/slow')))).toBe('TIMEOUT')
  })

  it('caps the response body by declared length and while streaming', async () => {
    const fetch = createSafeFetch({ ...base, maxBodyBytes: 1000 })
    expect(await codeOf(fetch(url('/big-declared')))).toBe('BODY_TOO_LARGE')
    const streamed = await fetch(url('/big-chunked'))
    expect(streamed.status).toBe(200)
    expect(await codeOf(streamed.text())).toBe('BODY_TOO_LARGE')
    const fine = await createSafeFetch({ ...base, maxBodyBytes: 2000 })(url('/big-chunked'))
    expect((await fine.text()).length).toBe(1200)
  })
})
