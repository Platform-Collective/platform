// SPDX-License-Identifier: EPL-2.0

import { HocuspocusCollabProvider } from './hocuspocus'

jest.mock('@hocuspocus/provider', () => {
  const { EventEmitter } = jest.requireActual('node:events')
  return {
    HocuspocusProvider: class extends EventEmitter {
      unsyncedChanges = 0
      configuration = { websocketProvider: { disconnect: jest.fn() } }
      get hasUnsyncedChanges (): boolean { return this.unsyncedChanges > 0 }
      destroy (): void { this.emit('destroy') }
    }
  }
})

describe('collaboration flush before navigation', () => {
  afterEach(() => jest.useRealTimers())

  it('waits for a pending update acknowledgement after initial sync', async () => {
    const provider = new HocuspocusCollabProvider({ parameters: { content: null } } as any)
    provider.emit('synced', { state: true })
    provider.unsyncedChanges = 1
    let complete = false
    const flushed = provider.flush().then(() => { complete = true })
    await Promise.resolve()
    expect(complete).toBe(false)
    provider.unsyncedChanges = 0
    provider.emit('unsyncedChanges', 0)
    await flushed
    expect(complete).toBe(true)
    expect((provider as any).listenerCount('unsyncedChanges')).toBe(0)
  })

  it('bounds a disconnected flush and removes its event handlers', async () => {
    jest.useFakeTimers()
    const provider = new HocuspocusCollabProvider({ parameters: { content: null } } as any)
    const rejected = expect(provider.flush()).rejects.toThrow('not been synchronized')
    jest.advanceTimersByTime(15000)
    await rejected
    expect((provider as any).listenerCount('unsyncedChanges')).toBe(0)
  })

  it('rejects when the provider closes with an update still pending', async () => {
    const provider = new HocuspocusCollabProvider({ parameters: { content: null } } as any)
    provider.emit('synced', { state: true })
    provider.unsyncedChanges = 1
    const rejected = expect(provider.flush()).rejects.toThrow('closed before')
    provider.destroy()
    await rejected
    expect((provider as any).listenerCount('unsyncedChanges')).toBe(0)
  })
})
