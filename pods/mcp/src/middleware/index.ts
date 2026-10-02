// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { type MeasureContext, metricsAggregate } from '@hcengineering/core'
import { getCPUInfo, getMemoryInfo } from '@hcengineering/server-core'
import { type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from 'express'

import { type Config } from '../config'
import { HttpError } from '../error'
import { type RateLimiter } from './rate-limiter'

export const KEEP_ALIVE_TIMEOUT = 5
export const KEEP_ALIVE_MAX = 1000

export const keepAlive = (options: { timeout: number, max: number }): RequestHandler => {
  const { timeout, max } = options
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Keep-Alive', `timeout=${timeout}, max=${max}`)
    next()
  }
}

/**
 * Logs one line per completed request.
 *
 * Built on `res.on('finish')` rather than copying the morgan + LogStream
 * idiom the other pods use: that pattern needs a writable stream shim, and
 * nothing here streams. The output format is the same.
 */
export const requestLogger = (ctx: MeasureContext): RequestHandler => {
  const requests = ctx.newChild('requests', {}, { span: false })
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now()
    res.on('finish', () => {
      requests.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`)
    })
    next()
  }
}

/**
 * Rejects browser requests whose `Origin` is not on the allowlist.
 *
 * Why this exists: the MCP spec requires servers to validate `Origin` as a
 * defence against DNS rebinding. Without the check, any web page the user
 * happens to visit can resolve `http://localhost:4090`, send a request that
 * carries the browser's implicit trust of localhost, and drive this server as
 * if it were a same-origin local service. The preflight would even pass,
 * because a permissive CORS setup answers "yes" to everyone.
 *
 * Requests without an `Origin` header are allowed through on purpose:
 * non-browser clients (Claude Desktop, curl, MCP CLIs) never send it, and the
 * header is the only signal a browser-originated call carries. An empty
 * allowlist therefore means "no browser origin is accepted" (fail closed)
 * rather than "accept everything" — desktop clients keep working either way.
 */
export const originGuard = (allowed: string[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin
    if (origin === undefined || origin === '') {
      next()
      return
    }
    // Exact string match only: a browser origin has no trailing slash and no
    // wildcard meaning, so anything not explicitly listed is a stranger.
    if (typeof origin !== 'string' || !allowed.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' })
      return
    }
    next()
  }
}

/**
 * Per-caller rate limiting.
 *
 * The key comes from `resolveKey`, which reads the client address — the only
 * thing available before authentication runs. The transactor's own limiter is
 * coupled to a live Session, which a stateless MCP endpoint never has, so this
 * is the only limit in front of the tools.
 */
export const rateLimit = (limiter: RateLimiter, resolveKey: (req: Request) => string): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = resolveKey(req)
    const remaining = limiter.check(key)
    if (remaining < 0) {
      const retryAfter = Math.ceil(limiter.retryAfterMs(key) / 1000)
      res.setHeader('Retry-After', `${retryAfter}`)
      res.status(429).json({ error: 'Rate limit exceeded', retryAfterSeconds: retryAfter })
      return
    }
    res.setHeader('X-RateLimit-Remaining', `${remaining}`)
    next()
  }
}

export const statistics = (ctx: MeasureContext, config: Config): RequestHandler => {
  return (req: Request, res: Response) => {
    if (!config.EnableStats) {
      res.status(404).json({ message: 'Not Found' })
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, no-store, no-cache, must-revalidate, max-age=0')
    res.status(200).json({
      metrics: metricsAggregate((ctx as unknown as { metrics: never }).metrics),
      statistics: { cpu: getCPUInfo(), memory: getMemoryInfo() }
    })
  }
}

export const errorHandler = (ctx: MeasureContext): ErrorRequestHandler => {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return

    if (err instanceof HttpError) {
      ctx.warn('mcp http error', { status: err.status, message: err.message, path: req.path })
      res.status(err.status).json({ error: err.message })
      return
    }

    // Express' JSON body parser raises this for malformed payloads. It is the
    // client's mistake, not ours, and the raw body is not useful to echo back.
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      res.status(400).json({ error: 'Request body is not valid JSON' })
      return
    }

    // Body parser rejections (payload too large, unsupported charset, aborted
    // request) carry a 4xx status and are safe to report as-is.
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large' })
      return
    }
    const status = typeof err?.status === 'number' ? err.status : 0
    if (err?.expose === true && status >= 400 && status < 500) {
      res.status(status).json({ error: 'Bad request' })
      return
    }

    ctx.error('mcp unhandled error', { error: err?.message, path: req.path })
    Analytics.handleError(err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
