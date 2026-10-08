// SPDX-License-Identifier: EPL-2.0
import { SyncRunner } from '../sync/runner'

function deferred (): { promise: Promise<void>, resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('SyncRunner', () => {
  it('runs operations on the same key one after another, in order', async () => {
    const runner = new SyncRunner()
    const order: string[] = []
    const gate = deferred()
    const first = runner.exec('k', async () => { order.push('1-start'); await gate.promise; order.push('1-end') })
    const second = runner.exec('k', async () => { order.push('2') })
    const third = runner.exec('k', async () => { order.push('3') })
    await new Promise((r) => setImmediate(r))
    expect(order).toEqual(['1-start'])
    gate.resolve()
    await Promise.all([first, second, third])
    expect(order).toEqual(['1-start', '1-end', '2', '3'])
  })

  it('runs different keys concurrently', async () => {
    const runner = new SyncRunner()
    const gate = deferred()
    const blocked = runner.exec('a', async () => { await gate.promise })
    await expect(runner.exec('b', async () => 'free')).resolves.toBe('free')
    gate.resolve()
    await blocked
  })

  it('does not let a failure block the next operation', async () => {
    const runner = new SyncRunner()
    await expect(runner.exec('k', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(runner.exec('k', async () => 2)).resolves.toBe(2)
  })
})
