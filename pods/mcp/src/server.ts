// SPDX-License-Identifier: EPL-2.0

import { type MeasureContext } from '@hcengineering/core'
import cors from 'cors'
import express, { type Express, type Request, type RequestHandler, type Response } from 'express'
import { type Server } from 'node:http'

import { type Authenticator } from './auth/authenticator'
import { type Config } from './config'
import { McpDispatcher } from './mcp/dispatcher'
import { SessionStore } from './mcp/session'
import { SESSION_HEADER, StreamableHttpTransport } from './mcp/streamable-http'
import { type ToolRegistry } from './mcp/tool'
import {
  errorHandler,
  keepAlive,
  KEEP_ALIVE_MAX,
  KEEP_ALIVE_TIMEOUT,
  originGuard,
  rateLimit,
  requestLogger,
  statistics
} from './middleware'
import { type RateLimiter } from './middleware/rate-limiter'
import { type WorkspaceClientProvider } from './platform/workspace-client-provider'
import { MCP_INSTRUCTIONS } from './tools/register'

export const MCP_ENDPOINT = '/mcp'

/** Replaced at bundle time by esbuild. */
const VERSION = process.env.VERSION ?? '0.7.0'

export interface ServerDependencies {
  ctx: MeasureContext
  config: Config
  registry: ToolRegistry
  clients: WorkspaceClientProvider
  authenticator: Authenticator
  limiter: RateLimiter
  sessions?: SessionStore
}

export interface McpServer {
  app: Express
  sessions: SessionStore
  transport: StreamableHttpTransport
}

/**
 * Adapts an async handler to Express.
 *
 * Express 4 ignores the returned promise, so an unhandled rejection inside a
 * handler would otherwise be invisible. This routes it to `next`, which is what
 * the error handler middleware is watching for.
 */
const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req, res, next) => {
      fn(req, res).catch(next)
    }

/**
 * Assembles the HTTP layer.
 *
 * The dispatcher and transport are constructed here, from injected
 * collaborators, rather than passed in pre-built. That keeps the wiring visible
 * in one place and lets tests swap the authenticator or the client provider
 * without having to construct a transport by hand.
 */
export function createServer (deps: ServerDependencies): McpServer {
  const { ctx, config, registry, clients, authenticator, limiter } = deps

  const sessions = deps.sessions ?? new SessionStore({ ctx, idleTtlMs: config.SessionIdleTtlMs })

  const dispatcher = new McpDispatcher({
    ctx,
    registry,
    serverName: 'huly-mcp',
    serverVersion: VERSION,
    instructions: MCP_INSTRUCTIONS,
    resolveSession: async (session) => await clients.get(session.identity)
  })

  const transport = new StreamableHttpTransport({ ctx, store: sessions, dispatcher, authenticator })

  const app = express()
  app.disable('x-powered-by')

  // Behind nginx/ingress every connection physically arrives from the proxy's
  // address, so req.ip would report the proxy for all callers and the rate
  // limiter (which keys on req.ip) would collapse every client into one
  // bucket. TRUST_PROXY=0 — the default — trusts no X-Forwarded-For, so a
  // direct connection behaves exactly as it did before this line.
  app.set('trust proxy', config.TrustProxy)

  // Must sit before cors(): a disallowed origin has to be refused outright,
  // not answered with a failing CORS response, so the browser never even sees
  // a preflight result for a site we do not trust.
  app.use(originGuard(config.AllowedOrigins))

  app.use(
    cors({
      // Reflect only the configured origins instead of the wildcard `*`. An
      // empty list leaves every browser request without an
      // Access-Control-Allow-Origin header (cors skips false values), while
      // non-browser clients, which send no Origin, are unaffected.
      origin: config.AllowedOrigins,
      maxAge: 86400,
      // A browser-based MCP client must be able to read the session id, or
      // every request after initialize would be rejected as session-less.
      exposedHeaders: [SESSION_HEADER, 'WWW-Authenticate', 'Retry-After', 'X-RateLimit-Remaining'],
      allowedHeaders: ['Content-Type', 'Authorization', SESSION_HEADER, 'Mcp-Protocol-Version', 'Last-Event-ID']
    })
  )

  // Bodies are JSON-RPC envelopes; a megabyte is generous and still bounded.
  app.use(express.json({ limit: config.MaxBodyBytes }))
  app.use(keepAlive({ timeout: KEEP_ALIVE_TIMEOUT, max: KEEP_ALIVE_MAX }))
  app.use(requestLogger(ctx))

  // Limiting sits in front of the MCP routes only, so /health keeps working
  // when a client manages to exhaust the window.
  //
  // The key is the client address, not the account: authentication has not run
  // yet at this point, and resolving an account first would cost a login attempt
  // per request before any flood was rejected. That makes the limit per address,
  // so callers behind one NAT share a bucket — and, without `trust proxy` set
  // above, so would every client behind one reverse proxy.
  const rateKey = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown'
  app.use(MCP_ENDPOINT, rateLimit(limiter, rateKey))

  app.post(MCP_ENDPOINT, asyncHandler(transport.handlePost))
  app.get(MCP_ENDPOINT, asyncHandler(transport.handleGet))
  app.delete(MCP_ENDPOINT, asyncHandler(transport.handleDelete))

  // Liveness probe: must answer 200 with no credential, because that is all a
  // Docker/k8s healthcheck can present. What it reports is deliberately narrow:
  // `authMode` and `readOnly` described how the server authenticates and
  // authorizes — a roadmap for an unauthenticated caller — and `sessions` was a
  // live activity counter. `version` and `tools` are fixed at boot and only
  // tell an operator that the new image and the tool registry are the ones
  // actually serving.
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      version: VERSION,
      tools: registry.size
    })
  })

  // Mounted unconditionally: while MCP_STATS is unset the handler defers to the
  // catch-all below, which answers exactly like any unknown path (see
  // `statistics` in middleware/index.ts).
  app.get('/api/v1/statistics', statistics(ctx, config))

  // A friendly landing page for a human who opens the pod in a browser. Same
  // disclosure rule as /api/v1/health: it lists where the MCP endpoint and the
  // health probe are, but not the auth mode or the read-only flag — those
  // describe the server's security posture and are nobody's business but the
  // operator's (who reads them from the environment that set them).
  app.get('/', (_req: Request, res: Response) => {
    res
      .type('text/plain')
      .send(
        [
          'Huly MCP Server',
          '',
          `MCP endpoint:   POST ${MCP_ENDPOINT}`,
          'Health:         GET /api/v1/health',
          `Tools:          ${registry.size}`,
          ''
        ].join('\n')
      )
  })

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' })
  })

  app.use(errorHandler(ctx))

  return { app, sessions, transport }
}

export function listen (app: Express, port: number, host: string): Server {
  const server = app.listen(port, host, () => {
    console.log(`Huly MCP server listening on ${host}:${port}`)
  })
  // SSE responses are long-lived by design, so the socket timeouts have to sit
  // above the keepalive interval or an idle stream gets reaped mid-conversation.
  server.keepAliveTimeout = (KEEP_ALIVE_TIMEOUT + 30) * 1000
  server.headersTimeout = (KEEP_ALIVE_TIMEOUT + 35) * 1000
  // SSE streams are long-lived; capping requests per socket would throttle them.
  server.maxRequestsPerSocket = 0
  return server
}
