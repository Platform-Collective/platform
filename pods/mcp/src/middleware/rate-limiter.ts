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

/**
 * Sliding-window rate limiter.
 *
 * Standalone pods get no rate limiting from the platform — the transactor's
 * limiter is coupled to having a live Session — so an MCP endpoint that accepts
 * internet traffic needs its own. Buckets are keyed by the authenticated account
 * where known and by client address otherwise, so one noisy agent cannot starve
 * the rest.
 */
export class RateLimiter {
  private readonly ctx: MeasureContext
  private readonly max: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly buckets = new Map<string, number[]>()

  constructor (ctx: MeasureContext, max: number, windowMs: number, now: () => number = Date.now) {
    this.ctx = ctx
    this.max = max
    this.windowMs = windowMs
    this.now = now
  }

  /** @returns the number of requests left in the window, or -1 when limited. */
  check (key: string): number {
    const now = this.now()
    const cutoff = now - this.windowMs
    const hits = (this.buckets.get(key) ?? []).filter((at) => at > cutoff)

    if (hits.length >= this.max) {
      this.buckets.set(key, hits)
      this.ctx.warn('mcp rate limit exceeded', { key, limit: this.max, windowMs: this.windowMs })
      return -1
    }

    hits.push(now)
    this.buckets.set(key, hits)
    return this.max - hits.length
  }

  /** Milliseconds until the oldest hit leaves the window. */
  retryAfterMs (key: string): number {
    const hits = this.buckets.get(key) ?? []
    const oldest = hits[0]
    if (oldest === undefined) return 0
    return Math.max(0, this.windowMs - (this.now() - oldest))
  }

  sweep (): void {
    const cutoff = this.now() - this.windowMs
    for (const [key, hits] of [...this.buckets]) {
      const live = hits.filter((at) => at > cutoff)
      if (live.length === 0) this.buckets.delete(key)
      else this.buckets.set(key, live)
    }
  }

  get size (): number {
    return this.buckets.size
  }
}
