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
 * Per-caller rate limiting.
 *
 * The key prefers the client address, which is the only thing available before
 * authentication runs. The transactor's own limiter is coupled to a live
 * Session, which a stateless MCP endpoint never has, so this is the only limit
 * in front of the tools.
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

    ctx.error('mcp unhandled error', { error: err?.message, path: req.path })
    Analytics.handleError(err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
}
