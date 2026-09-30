/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

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

  app.use(
    cors({
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
  const rateKey = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown'
  app.use(MCP_ENDPOINT, rateLimit(limiter, rateKey))

  app.post(MCP_ENDPOINT, asyncHandler(transport.handlePost))
  app.get(MCP_ENDPOINT, asyncHandler(transport.handleGet))
  app.delete(MCP_ENDPOINT, asyncHandler(transport.handleDelete))

  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      version: VERSION,
      authMode: config.AuthMode,
      readOnly: config.ReadOnly,
      tools: registry.size,
      sessions: sessions.size
    })
  })

  app.get('/api/v1/statistics', statistics(ctx, config))

  app.get('/', (_req: Request, res: Response) => {
    res.type('text/plain').send(
      [
        'Huly MCP Server',
        '',
        `MCP endpoint:   POST ${MCP_ENDPOINT}`,
        'Health:         GET /api/v1/health',
        `Auth mode:      ${config.AuthMode}${config.ReadOnly ? ' (read-only)' : ''}`,
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
