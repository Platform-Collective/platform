// SPDX-License-Identifier: EPL-2.0

/**
 * Serialises asynchronous operations per key. Operations on different keys run concurrently.
 */
export class SyncRunner {
  private readonly tails = new Map<string, Promise<void>>()

  async exec<T> (key: string, op: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const run = previous.then(op)
    const tail = run.then(
      () => {},
      () => {}
    )
    this.tails.set(key, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}
