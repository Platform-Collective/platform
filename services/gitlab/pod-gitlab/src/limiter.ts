// SPDX-License-Identifier: EPL-2.0

/** The limiter's queue is full; the caller decides what to do instead. */
export class LimiterFullError extends Error {
  constructor () {
    super('Too many operations waiting')
    this.name = 'LimiterFullError'
  }
}

/** Runs at most `concurrency` operations at once, queues up to `maxQueued` more in order, and refuses the rest. */
export class Limiter {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor (
    private readonly concurrency: number,
    private readonly maxQueued: number
  ) {}

  async run<T> (op: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) {
      this.active++
    } else {
      if (this.queue.length >= this.maxQueued) throw new LimiterFullError()
      // The finishing operation hands its slot over: `active` stays the same
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    try {
      return await op()
    } finally {
      const next = this.queue.shift()
      if (next !== undefined) next()
      else this.active--
    }
  }
}
