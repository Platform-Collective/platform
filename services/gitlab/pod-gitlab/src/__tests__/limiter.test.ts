// SPDX-License-Identifier: EPL-2.0
import { Limiter, LimiterFullError } from '../limiter'
import { flushPending } from './helpers/sync'

function deferred (): { promise: Promise<void>, resolve: () => void } {
  let release: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
}

describe('Limiter', () => {
  it('runs at most `concurrency` operations at once and queues the rest in order', async () => {
    const limiter = new Limiter(2, 10)
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []
    const runs = gates.map(
      async (gate, index) =>
        await limiter.run(async () => {
          started.push(index)
          await gate.promise
          return index
        })
    )
    await flushPending()
    expect(started).toEqual([0, 1])
    gates[0].resolve()
    await runs[0]
    await flushPending()
    expect(started).toEqual([0, 1, 2])
    gates[1].resolve()
    gates[2].resolve()
    expect(await Promise.all(runs)).toEqual([0, 1, 2])
  })

  it('refuses work when the queue is full', async () => {
    const limiter = new Limiter(1, 1)
    const gate = deferred()
    const first = limiter.run(async () => {
      await gate.promise
    })
    const second = limiter.run(async () => {})
    await expect(limiter.run(async () => {})).rejects.toBeInstanceOf(LimiterFullError)
    gate.resolve()
    await Promise.all([first, second])
  })

  it('frees the slot when an operation fails', async () => {
    const limiter = new Limiter(1, 0)
    await expect(
      limiter.run(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(await limiter.run(async () => 'ok')).toBe('ok')
  })
})
