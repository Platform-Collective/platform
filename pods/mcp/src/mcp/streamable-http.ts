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
import { type Request, type Response } from 'express'

import { AuthenticationError, type Authenticator, type SessionIdentity } from '../auth/authenticator'
import { extractBearerToken } from '../auth/token-extractor'
import { type McpDispatcher } from './dispatcher'
import { ErrorCode, isJsonRpcRequest } from './protocol'
import { type McpSession, type SessionStore } from './session'

export const SESSION_HEADER = 'mcp-session-id'
export const PROTOCOL_VERSION_HEADER = 'mcp-protocol-version'

/** Content types a client must be willing to accept on a POST. */
const ACCEPTABLE = ['application/json', 'text/event-stream'] as const

export interface StreamableHttpOptions {
  ctx: MeasureContext
  store: SessionStore
  dispatcher: McpDispatcher
  authenticator: Authenticator
  /** Interval between SSE keepalive comments, in milliseconds. */
  keepAliveIntervalMs?: number
}

const DEFAULT_KEEPALIVE_MS = 25_000

/**
 * The MCP "Streamable HTTP" transport.
 *
 * One endpoint, three verbs:
 *   POST   — client to server JSON-RPC (initialize, tools/call, ...)
 *   GET    — server to client SSE stream (keepalive today, notifications later)
 *   DELETE — terminate the session
 *
 * The transport owns authentication, session binding and the HTTP status codes;
 * all MCP semantics live in the dispatcher.
 */
export class StreamableHttpTransport {
  private readonly ctx: MeasureContext
  private readonly store: SessionStore
  private readonly dispatcher: McpDispatcher
  private readonly authenticator: Authenticator
  private readonly keepAliveIntervalMs: number
  private readonly streams = new Set<Response>()

  constructor (options: StreamableHttpOptions) {
    this.ctx = options.ctx
    this.store = options.store
    this.dispatcher = options.dispatcher
    this.authenticator = options.authenticator
    this.keepAliveIntervalMs = options.keepAliveIntervalMs ?? DEFAULT_KEEPALIVE_MS
  }

  handlePost = async (req: Request, res: Response): Promise<void> => {
    if (!this.acceptsSupportedContent(req)) {
      res.status(406).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCode.InvalidRequest,
          message: `Not Acceptable: clients must accept ${ACCEPTABLE.join(' or ')}`
        }
      })
      return
    }

    let identity: SessionIdentity
    try {
      identity = await this.authenticate(req)
    } catch (err) {
      this.sendAuthError(res, err)
      return
    }

    const body: unknown = req.body
    const isInitialize = isJsonRpcRequest(body) && body.method === 'initialize'

    let session: McpSession | undefined
    const sessionId = headerValue(req, SESSION_HEADER)

    if (sessionId !== undefined) {
      session = this.store.get(sessionId)
      if (session === undefined) {
        // A stale id after a server restart is normal. Reporting 404 (rather
        // than silently creating a new session) makes the client re-initialize
        // instead of continuing against a session it believes is authenticated.
        res.status(404).json({ error: 'Session not found or expired, re-initialize' })
        return
      }
      if (!session.belongsTo(identity)) {
        this.ctx.warn('mcp session identity mismatch', { session: session.id })
        res.status(403).json({ error: 'Session belongs to a different account or workspace' })
        return
      }
    } else if (!isInitialize) {
      res.status(400).json({ error: `Missing ${SESSION_HEADER} header` })
      return
    }

    if (isInitialize && session === undefined) {
      session = this.store.create(identity)
      res.setHeader(SESSION_HEADER, session.id)
    }

    const active = session as McpSession
    const response = await this.dispatcher.dispatch(active, body)

    if (response === null) {
      // Notification acknowledged, no body — JSON-RPC forbids responding.
      res.status(202).end()
      return
    }

    res.status(200).json(response)
  }

  handleGet = async (req: Request, res: Response): Promise<void> => {
    const sessionId = headerValue(req, SESSION_HEADER)
    if (sessionId === undefined) {
      res.status(400).json({ error: `Missing ${SESSION_HEADER} header` })
      return
    }

    if (!(await this.authorizeSession(req, res, sessionId))) return

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx buffers SSE by default, which stalls server-initiated messages.
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders?.()

    this.streams.add(res)
    const keepAlive = setInterval(() => {
      // An SSE comment keeps proxies and clients from reaping an idle stream.
      res.write(': keepalive\n\n')
    }, this.keepAliveIntervalMs)
    keepAlive.unref?.()

    const cleanup = (): void => {
      clearInterval(keepAlive)
      this.streams.delete(res)
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  }

  handleDelete = async (req: Request, res: Response): Promise<void> => {
    const sessionId = headerValue(req, SESSION_HEADER)
    if (sessionId === undefined) {
      res.status(400).json({ error: `Missing ${SESSION_HEADER} header` })
      return
    }

    if (!(await this.authorizeSession(req, res, sessionId))) return

    this.store.delete(sessionId)
    res.status(204).end()
  }

  /**
   * Authenticates and confirms the session belongs to the caller.
   *
   * Shared by GET and DELETE so a session id can never be used by, or ended by,
   * a different account.
   *
   * @returns true when the request may proceed; otherwise the response has
   * already been written.
   */
  private async authorizeSession (req: Request, res: Response, sessionId: string): Promise<boolean> {
    let identity: SessionIdentity
    try {
      identity = await this.authenticate(req)
    } catch (err) {
      this.sendAuthError(res, err)
      return false
    }

    const session = this.store.get(sessionId)
    if (session === undefined) {
      res.status(404).json({ error: 'Session not found or expired' })
      return false
    }
    if (!session.belongsTo(identity)) {
      this.ctx.warn('mcp session identity mismatch', { session: session.id })
      res.status(403).json({ error: 'Session belongs to a different account or workspace' })
      return false
    }

    return true
  }

  private async authenticate (req: Request): Promise<SessionIdentity> {
    const rawToken = extractBearerToken(req.headers)
    if (rawToken === undefined) {
      // In `configured` mode the authenticator ignores the token entirely, so a
      // missing header is only fatal for per-request auth. The concrete
      // authenticators decide; this only guarantees a string to hand them.
      return await this.authenticator.authenticate('')
    }
    return await this.authenticator.authenticate(rawToken)
  }

  private sendAuthError (res: Response, err: unknown): void {
    const reason = err instanceof AuthenticationError ? err.reason : 'invalid'
    const message = err instanceof Error ? err.message : 'Unauthorized'

    if (reason === 'missing') {
      res.setHeader('WWW-Authenticate', 'Bearer realm="huly-mcp"')
    }

    this.ctx.warn('mcp request unauthorized', { reason, message })
    res.status(401).json({ error: message })
  }

  private acceptsSupportedContent (req: Request): boolean {
    const accept = req.headers.accept
    // An absent Accept header means "anything", which is legal HTTP.
    if (accept === undefined) return true
    return ACCEPTABLE.some((type) => accept.includes(type))
  }

  /** Closes every open SSE stream; used on shutdown. */
  closeAll (): void {
    for (const res of this.streams) {
      try {
        res.end()
      } catch {
        // Already gone.
      }
    }
    this.streams.clear()
  }
}

function headerValue (req: Request, name: string): string | undefined {
  const value = req.headers[name]
  if (Array.isArray(value)) return value[0]
  if (typeof value === 'string' && value.length > 0) return value
  return undefined
}
