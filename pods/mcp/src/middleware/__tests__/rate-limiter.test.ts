// SPDX-License-Identifier: EPL-2.0

import { fakeMeasureContext } from '../../__tests__/test-doubles'
import { RateLimiter } from '../rate-limiter'

const ctx = fakeMeasureContext()

describe('RateLimiter', () => {
  it('allows requests up to the limit and then refuses', () => {
    const now = 0
    const limiter = new RateLimiter(ctx, 3, 1000, () => now)

    expect(limiter.check('a')).toBe(2)
    expect(limiter.check('a')).toBe(1)
    expect(limiter.check('a')).toBe(0)
    expect(limiter.check('a')).toBe(-1)
  })

  it('keeps separate buckets per key', () => {
    const limiter = new RateLimiter(ctx, 1, 1000, () => 0)
    expect(limiter.check('a')).toBe(0)
    expect(limiter.check('b')).toBe(0)
    expect(limiter.check('a')).toBe(-1)
  })

  it('lets the window slide', () => {
    let now = 0
    const limiter = new RateLimiter(ctx, 2, 1000, () => now)

    limiter.check('a')
    limiter.check('a')
    expect(limiter.check('a')).toBe(-1)

    now = 1001
    expect(limiter.check('a')).toBe(1)
  })

  it('reports how long to wait before retrying', () => {
    let now = 0
    const limiter = new RateLimiter(ctx, 1, 1000, () => now)
    limiter.check('a')
    expect(limiter.retryAfterMs('a')).toBe(1000)

    now = 400
    expect(limiter.retryAfterMs('a')).toBe(600)
  })

  it('reclaims buckets on sweep', () => {
    let now = 0
    const limiter = new RateLimiter(ctx, 5, 100, () => now)
    limiter.check('a')
    limiter.check('b')
    expect(limiter.size).toBe(2)

    now = 200
    limiter.sweep()
    expect(limiter.size).toBe(0)
  })
})
